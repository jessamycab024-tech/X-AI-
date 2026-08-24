require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// ============================================================================
// CONFIGURATION & SECURITY SETUP
// ============================================================================

function loadConfig() {
  const requiredInProduction = ['JWT_SECRET', 'NODE_ENV'];
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  if (nodeEnv === 'production') {
    requiredInProduction.forEach(key => {
      if (!process.env[key]) {
        throw new Error(`[SECURITY] Required env var missing in production: ${key}`);
      }
    });
  }

  return {
    port: Number(process.env.PORT || 3000),
    storageType: process.env.STORAGE_TYPE || 'file',
    databaseUrl: process.env.DATABASE_URL || '',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-chars',
    nodeEnv: nodeEnv,
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
    maxPayloadSize: Number(process.env.MAX_PAYLOAD_SIZE || 1048576), // 1MB
    tokenExpiry: process.env.TOKEN_EXPIRY || '24h',
    corsOrigin: process.env.CORS_ORIGIN || '*'
  };
}

const config = loadConfig();

// Security constants
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const AUTH_RATE_LIMIT_MAX_REQUESTS = 5; // 5 attempts per 15 minutes
const MAX_EMAIL_LENGTH = 255;
const MAX_PASSWORD_LENGTH = 256;
const MAX_NAME_LENGTH = 255;
const MIN_PASSWORD_LENGTH = 8;

const rateLimit = new Map();
const authRateLimit = new Map();

// Email validation regex (RFC 5322 simplified)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================================
// LOGGING & MONITORING
// ============================================================================

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data
  };
  console.log(JSON.stringify(logEntry));
}

// ============================================================================
// SECURITY UTILITIES - FIX #1, #2, #6, #10, #11, #13
// ============================================================================

/**
 * FIX #1: Hash password using bcrypt
 */
async function hashPassword(password) {
  try {
    return await bcrypt.hash(password, config.bcryptRounds);
  } catch (error) {
    log('error', 'Password hashing failed', { error: error.message });
    throw new Error('Failed to hash password');
  }
}

/**
 * FIX #1: Compare plaintext password with hash
 */
async function comparePassword(plaintext, hash) {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch (error) {
    log('error', 'Password comparison failed', { error: error.message });
    return false;
  }
}

/**
 * FIX #2: Validate email format
 */
function validateEmail(email) {
  if (typeof email !== 'string') {
    return 'Email must be a string.';
  }
  const trimmed = email.trim();
  
  // FIX #11: Check email length
  if (trimmed.length === 0) {
    return 'Email cannot be empty.';
  }
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return `Email must not exceed ${MAX_EMAIL_LENGTH} characters.`;
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Email format is invalid.';
  }
  return null;
}

/**
 * FIX #2: Validate password
 */
function validatePassword(password) {
  if (typeof password !== 'string') {
    return 'Password must be a string.';
  }
  // FIX #11: Check password length
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * FIX #2: Validate name
 */
function validateName(name) {
  if (typeof name !== 'string') {
    return 'Name must be a string.';
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Name cannot be empty.';
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Name must not exceed ${MAX_NAME_LENGTH} characters.`;
  }
  return null;
}

/**
 * FIX #6: Generate cryptographically secure token
 */
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * FIX #6: Create JWT token
 */
function createJWTToken(payload) {
  try {
    return jwt.sign(payload, config.jwtSecret, { 
      expiresIn: config.tokenExpiry,
      algorithm: 'HS256'
    });
  } catch (error) {
    log('error', 'JWT creation failed', { error: error.message });
    throw new Error('Failed to create token');
  }
}

/**
 * FIX #6: Verify JWT token
 */
function verifyJWTToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { 
      algorithms: ['HS256'] 
    });
  } catch (error) {
    log('warn', 'Token verification failed', { error: error.message });
    return null;
  }
}

// ============================================================================
// RATE LIMITING - FIX #9
// ============================================================================

/**
 * FIX #9: Check general rate limit (60 requests per minute)
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateLimit.get(ip) || [];
  const recent = bucket.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimit.set(ip, recent);
  
  if (recent.length > RATE_LIMIT_MAX_REQUESTS) {
    log('warn', 'Rate limit exceeded', { ip, limit: RATE_LIMIT_MAX_REQUESTS });
    return false;
  }
  return true;
}

/**
 * FIX #9: Check auth rate limit (5 requests per 15 minutes)
 */
function checkAuthRateLimit(ip) {
  const now = Date.now();
  const bucket = authRateLimit.get(ip) || [];
  const recent = bucket.filter(timestamp => now - timestamp < AUTH_RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  authRateLimit.set(ip, recent);
  
  if (recent.length > AUTH_RATE_LIMIT_MAX_REQUESTS) {
    log('warn', 'Auth rate limit exceeded', { ip, limit: AUTH_RATE_LIMIT_MAX_REQUESTS });
    return false;
  }
  return true;
}

// ============================================================================
// SECURITY HEADERS - FIX #4
// ============================================================================

function applySecurityHeaders(res) {
  // Existing security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self';");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // FIX #4: CORS headers
  res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ============================================================================
// INPUT VALIDATION & SANITIZATION - FIX #5, #13
// ============================================================================

/**
 * FIX #13: Parse body with size limit
 */
function parseBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') {
      return Promise.resolve(JSON.parse(req.body));
    }
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      // FIX #13: Check payload size limit
      if (size > config.maxPayloadSize) {
        reject(new Error(`Payload exceeds maximum size of ${config.maxPayloadSize} bytes`));
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        // FIX #5: Validate JSON before parsing
        const parsed = body ? JSON.parse(body) : {};
        
        // FIX #5: Basic JSON injection prevention
        if (typeof parsed !== 'object' || parsed === null) {
          return reject(new Error('Invalid JSON structure'));
        }
        
        resolve(parsed);
      } catch (error) {
        reject(new Error('Failed to parse JSON: ' + error.message));
      }
    });

    req.on('error', reject);
  });
}

/**
 * FIX #5: Sanitize object to prevent injection
 */
function sanitizeInput(input) {
  if (typeof input === 'string') {
    return input.trim().slice(0, 1200); // Limit string length
  }
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        sanitized[key] = value.trim().slice(0, 1200);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
  return input;
}

/**
 * FIX #8 (Documentation): Validate prompt input
 */
function validatePrompt(prompt) {
  if (typeof prompt !== 'string') {
    return 'Prompt must be a string.';
  }
  const trimmed = prompt.trim();
  if (trimmed.length < 3) {
    return 'Prompt must be at least 3 characters long.';
  }
  if (trimmed.length > 1200) {
    return 'Prompt is too long.';
  }
  return null;
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE - FIX #3
// ============================================================================

/**
 * FIX #3: Extract and verify token from Authorization header
 */
function extractToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7); // Remove 'Bearer ' prefix
}

/**
 * FIX #3: Middleware to verify authentication
 */
function verifyAuthentication(req) {
  const token = extractToken(req);
  if (!token) {
    return null;
  }
  
  const payload = verifyJWTToken(token);
  if (!payload) {
    return null;
  }
  
  return payload;
}

/**
 * FIX #3: Check if route is protected
 */
function isProtectedRoute(pathname) {
  const protectedRoutes = [
    '/api/projects',
    '/api/generate',
    '/api/billing/checkout',
    '/api/user/profile'
  ];
  return protectedRoutes.some(route => pathname.startsWith(route));
}

// ============================================================================
// DATA STORAGE
// ============================================================================

function createJsonStore(filePath, fallback = []) {
  const resolvedPath = filePath || path.join(__dirname, 'data', 'store.json');
  const dir = path.dirname(resolvedPath);

  fs.mkdirSync(dir, { recursive: true });

  function read() {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (error) {
      log('warn', 'Failed to read JSON store', { path: resolvedPath, error: error.message });
      return fallback;
    }
  }

  function write(data) {
    try {
      fs.writeFileSync(resolvedPath, JSON.stringify(data, null, 2));
    } catch (error) {
      log('error', 'Failed to write JSON store', { path: resolvedPath, error: error.message });
      throw error;
    }
  }

  return { read, write };
}

function createStorage(storageFile, storageType = 'file', databaseUrl = '') {
  if (storageType === 'database' && databaseUrl) {
    return {
      listProjects() {
        return [];
      },
      createProject(project) {
        return {
          id: `db-${Date.now()}`,
          title: project.title || 'Untitled project',
          prompt: project.prompt || '',
          projectType: project.projectType || 'app',
          createdAt: new Date().toISOString(),
          source: 'database'
        };
      }
    };
  }

  const resolvedPath = storageFile || path.join(__dirname, 'data', 'projects.json');
  const dir = path.dirname(resolvedPath);

  fs.mkdirSync(dir, { recursive: true });

  function readProjects() {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      log('warn', 'Failed to read projects', { error: error.message });
      return [];
    }
  }

  function writeProjects(projects) {
    try {
      fs.writeFileSync(resolvedPath, JSON.stringify(projects, null, 2));
    } catch (error) {
      log('error', 'Failed to write projects', { error: error.message });
      throw error;
    }
  }

  function listProjects() {
    return readProjects();
  }

  function createProject(project) {
    const projects = readProjects();
    const normalizedProject = {
      id: project.id || `project-${Date.now()}-${projects.length + 1}`,
      title: project.title || 'Untitled project',
      prompt: project.prompt || '',
      projectType: project.projectType || 'app',
      createdAt: project.createdAt || new Date().toISOString()
    };
    projects.push(normalizedProject);
    writeProjects(projects);
    return normalizedProject;
  }

  return { listProjects, createProject };
}

// ============================================================================
// REQUEST HANDLER - ALL FIXES INTEGRATED
// ============================================================================

function createHandler(options = {}) {
  const storage = createStorage(options.storageFile, config.storageType, config.databaseUrl);
  const userStore = createJsonStore(options.userStoreFile || path.join(__dirname, 'data', 'users.json'), []);
  const billingStore = createJsonStore(options.billingStoreFile || path.join(__dirname, 'data', 'billing.json'), []);

  function getUsers() {
    const users = userStore.read();
    return Array.isArray(users) ? users : [];
  }

  function saveUsers(users) {
    try {
      userStore.write(users);
    } catch (error) {
      log('error', 'Failed to save users', { error: error.message });
      throw error;
    }
  }

  /**
   * FIX #1, #2: Register user with hashed password
   */
  async function registerUser(payload) {
    const users = getUsers();
    const existing = users.find(user => user.email === payload.email);
    if (existing) {
      throw new Error('User already exists');
    }

    // Hash password before storage
    const passwordHash = await hashPassword(payload.password);

    const user = {
      id: `user-${Date.now()}`,
      email: payload.email,
      name: payload.name || 'User',
      passwordHash: passwordHash, // Store hash, not plaintext
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    users.push(user);
    saveUsers(users);
    
    log('info', 'User registered', { userId: user.id, email: user.email });
    return user;
  }

  /**
   * FIX #1: Authenticate user with bcrypt comparison
   */
  async function authenticateUser(email, password) {
    const users = getUsers();
    const user = users.find(u => u.email === email);
    if (!user) {
      return null;
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      log('warn', 'Authentication failed', { email });
      return null;
    }

    log('info', 'User authenticated', { email });
    return user;
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ip = req.socket?.remoteAddress || 'unknown';

    // Apply security headers (FIX #4)
    applySecurityHeaders(res);

    // Handle OPTIONS requests for CORS preflight (FIX #4)
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Check general rate limit
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      log('warn', 'Rate limit exceeded', { ip });
      return;
    }

    // FIX #12: Log 404 errors
    const logRequest = (method, path, statusCode) => {
      log('info', 'HTTP Request', { method, path, statusCode, ip });
    };

    // ========== HEALTH CHECK ==========
    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        service: 'x-ai-prototype', 
        security: 'enabled',
        timestamp: new Date().toISOString()
      }));
      logRequest('GET', '/api/health', 200);
      return;
    }

    // ========== GENERATE ENDPOINT ==========
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      // FIX #3: Verify authentication
      const auth = verifyAuthentication(req);
      if (!auth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        logRequest('POST', '/api/generate', 401);
        return;
      }

      try {
        // FIX #7: Add error handling for async operations
        const body = await parseBody(req);
        const prompt = body.prompt || '';
        const validationError = validatePrompt(prompt);

        if (validationError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: validationError }));
          logRequest('POST', '/api/generate', 400);
          return;
        }

        const summary = `Plan for: ${prompt}`;
        const response = {
          success: true,
          projectType: 'app',
          summary,
          blueprint: {
            pages: ['Home'],
            features: ['Prompt-driven generation', 'Preview support', 'Security hardening'],
            techStack: ['Node.js', 'HTML/CSS/JS']
          },
          security: {
            headersApplied: true,
            rateLimiting: true,
            tokenValidation: true
          },
          timestamp: new Date().toISOString()
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
        logRequest('POST', '/api/generate', 200);
      } catch (error) {
        // FIX #7: Catch and handle async errors
        log('error', 'Generate endpoint error', { error: error.message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request: ' + error.message }));
        logRequest('POST', '/api/generate', 400);
      }
      return;
    }

    // ========== PROJECTS ENDPOINTS ==========
    if (req.method === 'POST' && url.pathname === '/api/projects') {
      // FIX #3: Verify authentication
      const auth = verifyAuthentication(req);
      if (!auth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        logRequest('POST', '/api/projects', 401);
        return;
      }

      try {
        const body = await parseBody(req);
        const title = body.title || 'Untitled project';
        const prompt = body.prompt || '';
        const projectType = body.projectType || 'app';
        const validationError = validatePrompt(prompt);

        if (validationError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: validationError }));
          logRequest('POST', '/api/projects', 400);
          return;
        }

        const project = storage.createProject({ title, prompt, projectType });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, project }));
        logRequest('POST', '/api/projects', 200);
      } catch (error) {
        // FIX #7: Error handling
        log('error', 'Projects POST error', { error: error.message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create project' }));
        logRequest('POST', '/api/projects', 400);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/projects') {
      // FIX #3: Verify authentication
      const auth = verifyAuthentication(req);
      if (!auth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        logRequest('GET', '/api/projects', 401);
        return;
      }

      try {
        const projects = storage.listProjects();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ projects }));
        logRequest('GET', '/api/projects', 200);
      } catch (error) {
        // FIX #7: Error handling
        log('error', 'Projects GET error', { error: error.message });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to list projects' }));
        logRequest('GET', '/api/projects', 500);
      }
      return;
    }

    // ========== AUTH ENDPOINTS - STRICT RATE LIMITING ==========
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      // FIX #9: Stricter rate limiting for auth
      if (!checkAuthRateLimit(ip)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many registration attempts. Try again later.' }));
        log('warn', 'Auth rate limit exceeded for register', { ip });
        logRequest('POST', '/api/auth/register', 429);
        return;
      }

      try {
        const body = await parseBody(req);
        
        // FIX #2: Validate all input fields
        const emailError = validateEmail(body.email);
        if (emailError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: emailError }));
          logRequest('POST', '/api/auth/register', 400);
          return;
        }

        const passwordError = validatePassword(body.password);
        if (passwordError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: passwordError }));
          logRequest('POST', '/api/auth/register', 400);
          return;
        }

        const nameError = validateName(body.name);
        if (nameError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: nameError }));
          logRequest('POST', '/api/auth/register', 400);
          return;
        }

        const user = await registerUser(body);
        const token = createJWTToken({ 
          userId: user.id, 
          email: user.email,
          iat: Math.floor(Date.now() / 1000)
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          user: { id: user.id, email: user.email, name: user.name }, 
          token 
        }));
        logRequest('POST', '/api/auth/register', 200);
      } catch (error) {
        // FIX #7: Error handling
        log('error', 'Registration error', { error: error.message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        logRequest('POST', '/api/auth/register', 400);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      // FIX #9: Stricter rate limiting for auth
      if (!checkAuthRateLimit(ip)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many login attempts. Try again later.' }));
        log('warn', 'Auth rate limit exceeded for login', { ip });
        logRequest('POST', '/api/auth/login', 429);
        return;
      }

      try {
        const body = await parseBody(req);
        
        // FIX #2: Validate input
        if (!body.email || !body.password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email and password required' }));
          logRequest('POST', '/api/auth/login', 400);
          return;
        }

        const user = await authenticateUser(body.email, body.password);
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid credentials' }));
          logRequest('POST', '/api/auth/login', 401);
          return;
        }

        const token = createJWTToken({ 
          userId: user.id, 
          email: user.email,
          iat: Math.floor(Date.now() / 1000)
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          user: { id: user.id, email: user.email, name: user.name }, 
          token 
        }));
        logRequest('POST', '/api/auth/login', 200);
      } catch (error) {
        // FIX #7: Error handling
        log('error', 'Login error', { error: error.message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Login failed' }));
        logRequest('POST', '/api/auth/login', 400);
      }
      return;
    }

    // ========== BILLING ENDPOINT ==========
    if (req.method === 'POST' && url.pathname === '/api/billing/checkout') {
      // FIX #3: Verify authentication
      const auth = verifyAuthentication(req);
      if (!auth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        logRequest('POST', '/api/billing/checkout', 401);
        return;
      }

      try {
        const body = await parseBody(req);
        const planName = body.planName || 'Basic';
        const planPrices = { Basic: 30, Middle: 80, Unlimited: 200 };
        
        if (!planPrices[planName]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid plan' }));
          logRequest('POST', '/api/billing/checkout', 400);
          return;
        }

        const amount = planPrices[planName];
        const invoice = {
          id: `invoice-${Date.now()}`,
          userId: auth.userId,
          planName,
          amount,
          currency: 'USD',
          status: 'pending',
          issuedAt: new Date().toISOString()
        };
        
        const invoices = billingStore.read();
        invoices.push(invoice);
        billingStore.write(invoices);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, invoice }));
        logRequest('POST', '/api/billing/checkout', 200);
      } catch (error) {
        // FIX #7: Error handling
        log('error', 'Billing error', { error: error.message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Checkout failed' }));
        logRequest('POST', '/api/billing/checkout', 400);
      }
      return;
    }

    // ========== STATIC FILES ==========
    if (req.method === 'GET' && url.pathname === '/') {
      try {
        const filePath = path.join(__dirname, 'frontend', 'index.html');
        const content = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
        logRequest('GET', '/', 200);
      } catch (error) {
        log('error', 'Failed to serve index.html', { error: error.message });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load page' }));
        logRequest('GET', '/', 500);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/styles.css') {
      try {
        const filePath = path.join(__dirname, 'frontend', 'styles.css');
        const content = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(content);
        logRequest('GET', '/styles.css', 200);
      } catch (error) {
        log('error', 'Failed to serve styles.css', { error: error.message });
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        logRequest('GET', '/styles.css', 404);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/app.js') {
      try {
        const filePath = path.join(__dirname, 'frontend', 'app.js');
        const content = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(content);
        logRequest('GET', '/app.js', 200);
      } catch (error) {
        log('error', 'Failed to serve app.js', { error: error.message });
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        logRequest('GET', '/app.js', 404);
      }
      return;
    }

    // FIX #12: Log 404 errors
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    logRequest(req.method, url.pathname, 404);
  };
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

function startServer(port = 3000) {
  const handler = createHandler();
  const server = http.createServer(handler);
  
  server.listen(port || config.port, () => {
    log('info', 'X AI prototype started', {
      port: port || config.port,
      nodeEnv: config.nodeEnv,
      corsOrigin: config.corsOrigin
    });
  });

  server.on('error', (error) => {
    log('error', 'Server error', { error: error.message });
  });

  return server;
}

if (require.main === module) {
  startServer(process.env.PORT || 3000);
}

module.exports = { createHandler, startServer };
