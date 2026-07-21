const http = require('http');
const fs = require('fs');
const path = require('path');

const rateLimit = new Map();

function loadConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    storageType: process.env.STORAGE_TYPE || 'file',
    databaseUrl: process.env.DATABASE_URL || '',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret'
  };
}

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
      return fallback;
    }
  }

  function write(data) {
    fs.writeFileSync(resolvedPath, JSON.stringify(data, null, 2));
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
      return [];
    }
  }

  function writeProjects(projects) {
    fs.writeFileSync(resolvedPath, JSON.stringify(projects, null, 2));
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
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self';");
}

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

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateLimit.get(ip) || [];
  const recent = bucket.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimit.set(ip, recent);
  return recent.length <= RATE_LIMIT_MAX_REQUESTS;
}

function parseBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') {
      return Promise.resolve(JSON.parse(req.body));
    }
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function createHandler(options = {}) {
  const config = { ...loadConfig(), ...options };
  const storage = createStorage(options.storageFile, config.storageType, config.databaseUrl);
  const userStore = createJsonStore(options.userStoreFile || path.join(__dirname, 'data', 'users.json'), []);
  const billingStore = createJsonStore(options.billingStoreFile || path.join(__dirname, 'data', 'billing.json'), []);

  function createToken(email) {
    return `token-${email}-${Date.now()}`;
  }

  function getUsers() {
    const users = userStore.read();
    return Array.isArray(users) ? users : [];
  }

  function saveUsers(users) {
    userStore.write(users);
  }

  function registerUser(payload) {
    const users = getUsers();
    const existing = users.find(user => user.email === payload.email);
    if (existing) {
      throw new Error('User already exists');
    }

    const user = {
      id: `user-${Date.now()}`,
      email: payload.email,
      name: payload.name || 'User',
      password: payload.password,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    saveUsers(users);
    return user;
  }

  function authenticateUser(email, password) {
    const users = getUsers();
    return users.find(user => user.email === email && user.password === password);
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ip = req.socket?.remoteAddress || 'unknown';

    applySecurityHeaders(res);

    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'x-ai-prototype', security: 'enabled' }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const body = await parseBody(req);
      const prompt = body.prompt || '';
      const validationError = validatePrompt(prompt);

      if (validationError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: validationError }));
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
          rateLimiting: true
        }
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/projects') {
      const body = await parseBody(req);
      const title = body.title || 'Untitled project';
      const prompt = body.prompt || '';
      const projectType = body.projectType || 'app';
      const validationError = validatePrompt(prompt);

      if (validationError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: validationError }));
        return;
      }

      const project = storage.createProject({ title, prompt, projectType });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, project }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/projects') {
      const projects = storage.listProjects();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projects }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      try {
        const body = await parseBody(req);
        const user = registerUser(body);
        const token = createToken(user.email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { id: user.id, email: user.email, name: user.name }, token }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await parseBody(req);
      const user = authenticateUser(body.email, body.password);
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
        return;
      }
      const token = createToken(user.email);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, user: { id: user.id, email: user.email, name: user.name }, token }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/billing/checkout') {
      const body = await parseBody(req);
      const planName = body.planName || 'Basic';
      const planPrices = { Basic: 30, Middle: 80, Unlimited: 200 };
      const amount = planPrices[planName] || 30;
      const invoice = {
        id: `invoice-${Date.now()}`,
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
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const filePath = path.join(__dirname, 'frontend', 'index.html');
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/styles.css') {
      const filePath = path.join(__dirname, 'frontend', 'styles.css');
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(content);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/app.js') {
      const filePath = path.join(__dirname, 'frontend', 'app.js');
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(content);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}

function startServer(port = 3000) {
  const config = loadConfig();
  const handler = createHandler({ port: config.port, storageType: config.storageType, databaseUrl: config.databaseUrl });
  const server = http.createServer(handler);
  server.listen(port || config.port, () => {
    console.log(`X AI prototype running at http://localhost:${port || config.port}`);
  });
  return server;
}

if (require.main === module) {
  startServer(process.env.PORT || 3000);
}

module.exports = { createHandler, startServer };
