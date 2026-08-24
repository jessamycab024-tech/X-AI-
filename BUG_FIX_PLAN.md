# X-AI Bug Fix Implementation Plan

## Overview
This document outlines all identified bugs and proposed fixes for review and approval before implementation.

---

## BUG FIXES PLANNED

### ✋ CRITICAL PRIORITY (3 bugs)

#### 1. **CRITICAL: Plaintext Password Storage**
- **File:** `server.js` (lines 184-185)
- **Severity:** CRITICAL - Security Vulnerability
- **Current Code:**
  ```javascript
  const user = {
    password: payload.password,  // Plaintext stored
  };
  ```
- **Proposed Fix:**
  - Add `bcrypt` dependency to `package.json`
  - Hash passwords using `bcrypt.hash()` before storage
  - Use `bcrypt.compare()` for login authentication
  - Update `registerUser()` and `authenticateUser()` functions

**Implementation Steps:**
1. Install bcrypt: `npm install bcrypt`
2. Modify `registerUser()` to hash password
3. Modify `authenticateUser()` to use bcrypt.compare()

---

#### 2. **CRITICAL: Missing Email Validation**
- **File:** `server.js` (lines 173-195)
- **Severity:** CRITICAL - Data Integrity
- **Current Code:**
  ```javascript
  function registerUser(payload) {
    // No email format validation
    const existing = users.find(user => user.email === payload.email);
  ```
- **Proposed Fix:**
  - Add email regex validation
  - Check for valid email format before registration
  - Reject invalid emails with clear error message

**Implementation Steps:**
1. Add email validation function
2. Call validation before `registerUser()`
3. Return 400 error for invalid emails

---

#### 3. **CRITICAL: No Token Validation on Protected Routes**
- **File:** `server.js` (entire handler function)
- **Severity:** CRITICAL - Authentication Bypass
- **Current Code:**
  ```javascript
  if (req.method === 'POST' && url.pathname === '/api/billing/checkout') {
    const body = await parseBody(req);
    // No token check - anyone can access!
  ```
- **Proposed Fix:**
  - Add middleware to verify token on all protected routes
  - Protected routes: `/api/billing/*`, `/api/projects`, `/api/generate`
  - Return 401 if token missing or invalid
  - Extract and validate Authorization header

**Implementation Steps:**
1. Create `verifyToken()` function
2. Create authentication middleware
3. Apply to protected endpoints

---

### 🔴 HIGH PRIORITY (4 bugs)

#### 4. **HIGH: Missing CORS Headers**
- **File:** `server.js` (lines 100-105)
- **Severity:** HIGH - Cross-origin Request Failure
- **Current Code:**
  ```javascript
  function applySecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Missing CORS headers
  ```
- **Proposed Fix:**
  - Add CORS headers to `applySecurityHeaders()` function
  - Support configurable origins (default: `*` for dev)
  - Support common HTTP methods and headers

**Implementation Steps:**
1. Add CORS headers in `applySecurityHeaders()`
2. Add OPTIONS request handler for preflight

---

#### 5. **HIGH: JSON Injection in User Input**
- **File:** `server.js` (lines 64-70, 145)
- **Severity:** HIGH - Data Corruption
- **Current Code:**
  ```javascript
  function parseBody(req) {
    // No sanitization before JSON.parse()
    try {
      resolve(body ? JSON.parse(body) : {});
  ```
- **Proposed Fix:**
  - Validate JSON structure before parsing
  - Sanitize object keys and values
  - Implement size limits on JSON payloads

**Implementation Steps:**
1. Add payload size limit check
2. Validate JSON structure after parsing
3. Sanitize user input fields

---

#### 6. **HIGH: Weak Token Generation**
- **File:** `server.js` (line 161)
- **Severity:** HIGH - Predictable Tokens
- **Current Code:**
  ```javascript
  function createToken(email) {
    return `token-${email}-${Date.now()}`;  // Predictable
  ```
- **Proposed Fix:**
  - Use cryptographic random bytes
  - Generate 32-byte secure tokens
  - Consider JWT for better structure

**Implementation Steps:**
1. Use `crypto.randomBytes()` for token generation
2. Convert to hex string
3. Store token hash (not plaintext)

---

#### 7. **HIGH: Missing Async Error Handling**
- **File:** `server.js` (lines 215-244)
- **Severity:** HIGH - Unhandled Exceptions
- **Current Code:**
  ```javascript
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    const body = await parseBody(req);
    // Can crash if parseBody throws
  ```
- **Proposed Fix:**
  - Wrap all async operations in try-catch
  - Add global error handler
  - Return 500 for unhandled errors

**Implementation Steps:**
1. Add try-catch blocks around all async calls
2. Add error logging
3. Return proper error responses

---

### 🟡 MEDIUM PRIORITY (4 bugs)

#### 8. **MEDIUM: SQL Injection Prevention Not Implemented**
- **File:** `server.js` + potential future DB integration
- **Severity:** MEDIUM - Database Security (Future Risk)
- **Proposed Fix:**
  - Add comments about parameterized queries
  - Prepare migration guide to use ORMs (Prisma/Sequelize)
  - Add database validation layer

**Implementation Steps:**
1. Add SQL injection protection guide in comments
2. Prepare ORM integration templates

---

#### 9. **MEDIUM: No Rate Limiting on Auth Endpoints**
- **File:** `server.js` (lines 121-128, 272-298)
- **Severity:** MEDIUM - Brute Force Attack Risk
- **Current Code:**
  ```javascript
  function checkRateLimit(ip) {
    // 60 requests/min for ALL endpoints
    // Auth endpoints need stricter limits
  ```
- **Proposed Fix:**
  - Implement stricter rate limiting for `/api/auth/*`
  - 5 requests per 15 minutes for login/register
  - Keep 60/min for other endpoints

**Implementation Steps:**
1. Create endpoint-specific rate limit buckets
2. Apply stricter limits to auth endpoints
3. Log rate limit violations

---

#### 10. **MEDIUM: Hardcoded Secret Key**
- **File:** `server.js` (line 12)
- **Severity:** MEDIUM - Production Risk
- **Current Code:**
  ```javascript
  jwtSecret: process.env.JWT_SECRET || 'dev-secret'
  ```
- **Proposed Fix:**
  - Require JWT_SECRET in production
  - Add NODE_ENV check
  - Throw error if missing in production

**Implementation Steps:**
1. Add production environment check
2. Require JWT_SECRET for production
3. Add documentation

---

#### 11. **MEDIUM: Missing Input Length Validation**
- **File:** `server.js` (lines 76-78)
- **Severity:** MEDIUM - Memory Exhaustion Risk
- **Current Code:**
  ```javascript
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  // No length limits before transmission
  ```
- **Proposed Fix:**
  - Add max length validation for email (255 chars)
  - Add max length validation for password (256 chars)
  - Validate on server side

**Implementation Steps:**
1. Add validation function for email/password length
2. Apply to registerUser() and authenticateUser()
3. Return 400 for oversized inputs

---

### 💡 LOW PRIORITY (2 bugs)

#### 12. **LOW: Missing 404 Logging**
- **File:** `server.js` (lines 345-346)
- **Severity:** LOW - Monitoring Gap
- **Proposed Fix:**
  - Add console logging for 404 errors
  - Include IP and path in logs
  - Useful for debugging

**Implementation Steps:**
1. Add logging to 404 handler
2. Include request metadata

---

#### 13. **LOW: No Input Length Validation on Payload**
- **File:** `server.js` (lines 138-151)
- **Severity:** LOW - Resource Abuse
- **Proposed Fix:**
  - Limit request body size (e.g., 1MB)
  - Return 413 Payload Too Large if exceeded

**Implementation Steps:**
1. Add payload size check in parseBody()
2. Return 413 error for oversized payloads

---

## IMPLEMENTATION STRATEGY

### Phase 1: Critical Security Fixes (Recommended First)
- [ ] Fix #1: Plaintext Password Storage (bcrypt)
- [ ] Fix #2: Email Validation
- [ ] Fix #3: Token Validation on Protected Routes

### Phase 2: High Priority Fixes
- [ ] Fix #4: CORS Headers
- [ ] Fix #5: JSON Injection Prevention
- [ ] Fix #6: Weak Token Generation
- [ ] Fix #7: Async Error Handling

### Phase 3: Medium Priority Fixes
- [ ] Fix #8: SQL Injection Prevention Guide
- [ ] Fix #9: Rate Limiting on Auth Endpoints
- [ ] Fix #10: Hardcoded Secret Key
- [ ] Fix #11: Input Length Validation

### Phase 4: Low Priority Fixes
- [ ] Fix #12: 404 Logging
- [ ] Fix #13: Payload Size Validation

---

## FILES TO BE MODIFIED

1. **package.json** - Add bcrypt dependency
2. **server.js** - All security fixes
3. **.env.example** - Document new required env vars
4. **README.md** - Update with security requirements

---

## TESTING REQUIREMENTS

After implementation, please test:
- [ ] Password hashing works (registration creates hash)
- [ ] Invalid emails are rejected
- [ ] Token validation blocks unauthorized requests
- [ ] CORS headers allow frontend requests
- [ ] Rate limiting blocks auth brute force
- [ ] Large payloads are rejected
- [ ] Async errors are caught and handled

---

## APPROVAL CHECKLIST

**Please review and confirm:**

- [ ] Do you want to implement ALL bugs?
- [ ] Do you want to use **bcrypt** for password hashing?
- [ ] Should I use **JWT tokens** or keep simple tokens with crypto.randomBytes()?
- [ ] What should be the **CORS origin** policy? (`*`, specific domain, or configurable?)
- [ ] Auth rate limit: **5 requests per 15 minutes** - is this appropriate?
- [ ] Payload size limit: **1MB** - is this acceptable?
- [ ] Do you want **logging** for security events?
- [ ] Should I implement all phases at once or in stages?

---

## Next Steps

1. **Review this plan** - Confirm bugs and proposed fixes
2. **Approve implementation** - Select which bugs to fix
3. **Confirm preferences** - Provide answers to approval checklist
4. **Execute fixes** - I'll create pull request with all changes
5. **Test thoroughly** - Run verification tests

---

**Created:** 2026-08-24  
**Status:** ⏳ AWAITING YOUR CONFIRMATION
