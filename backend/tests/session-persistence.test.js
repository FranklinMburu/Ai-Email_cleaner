/**
 * Tests for session persistence, expiry, and approval token validation
 * Using Node.js built-in test runner
 */

import test from 'node:test';
import assert from 'node:assert';
import { initializeDatabase, getDatabase, closeDatabase } from '../src/database.js';
import {
  createSession,
  validateSessionAndGetUser,
  destroySession,
  cleanupExpiredSessions,
  generateApprovalToken,
  validateApprovalToken,
} from '../src/session-manager.js';
import { encryptToken, decryptToken } from '../src/encryption.js';
import { v4 as uuidv4 } from 'uuid';

// Set up a test environment variable
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function setupTestDB(userEmail = 'test@example.com') {
  process.env.DB_PATH = ':memory:';
  initializeDatabase();
  const db = getDatabase();
  db.prepare(
    'INSERT OR IGNORE INTO oauth_tokens (id, user_email, refresh_token, access_token, token_expiry_ms) VALUES (?, ?, ?, ?, ?)'
  ).run(`token_${userEmail}`, userEmail, 'refresh', 'access', Date.now() + 3600000);
  return db;
}

// Session Manager - Persistence and TTL

test('Session Persistence: should create a session and store it in database', () => {
  const db = setupTestDB('user1@example.com');
  const sessionId = createSession('user1@example.com');
  
  assert.ok(sessionId.startsWith('sess_'), 'Session ID should start with sess_');
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  assert.ok(session, 'Session should be stored in database');
  assert.equal(session.user_email, 'user1@example.com', 'User email should match');

  closeDatabase();
});

test('Session Persistence: should validate and retrieve user email from valid session', () => {
  setupTestDB('user2@example.com');
  const sessionId = createSession('user2@example.com');
  const userEmail = validateSessionAndGetUser(sessionId);
  assert.equal(userEmail, 'user2@example.com', 'Should return correct user email');

  closeDatabase();
});

test('Session Persistence: should reject invalid session ID', () => {
  setupTestDB();

  assert.throws(() => {
    validateSessionAndGetUser('invalid_session_id');
  }, /Session not found/);

  closeDatabase();
});

test('Session Persistence: should reject expired session', () => {
  const db = setupTestDB('user3@example.com');
  const sessionId = `sess_${uuidv4()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() - 1000); // Already expired

  db.prepare(
    'INSERT INTO sessions (id, user_email, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(sessionId, 'user3@example.com', now.toISOString(), expiresAt.toISOString());

  assert.throws(() => {
    validateSessionAndGetUser(sessionId);
  }, /Session expired/);

  // Verify expired session was deleted on access
  const deletedSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  assert.equal(deletedSession, undefined, 'Expired session should be deleted');

  closeDatabase();
});

test('Session Persistence: should destroy a session', () => {
  const db = setupTestDB('user4@example.com');
  const sessionId = createSession('user4@example.com');
  destroySession(sessionId);

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  assert.equal(session, undefined, 'Session should be deleted');

  closeDatabase();
});

test('Session Persistence: should clean up expired sessions', () => {
  const db = setupTestDB('user5@example.com');
  const now = new Date();

  // Create valid session
  const validSessionId = `sess_${uuidv4()}`;
  const validExpires = new Date(now.getTime() + 3600000);
  db.prepare(
    'INSERT INTO sessions (id, user_email, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(validSessionId, 'user5@example.com', now.toISOString(), validExpires.toISOString());

  // Create expired session
  const expiredSessionId = `sess_${uuidv4()}`;
  const expiredExpires = new Date(now.getTime() - 1000);
  db.prepare(
    'INSERT INTO sessions (id, user_email, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(expiredSessionId, 'user5@example.com', now.toISOString(), expiredExpires.toISOString());

  const cleanedUp = cleanupExpiredSessions();
  assert.equal(cleanedUp, 1, 'Should clean up 1 expired session');

  // Verify expired session is gone
  const expiredSession = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(expiredSessionId);
  assert.equal(expiredSession, undefined, 'Expired session should be deleted');

  // Verify valid session still exists
  const validSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(validSessionId);
  assert.ok(validSession, 'Valid session should still exist');

  closeDatabase();
});

// Approval Token Generation and Validation

test('Approval Token: should generate deterministic approval token', () => {
  const operationId = 'op_12345';
  const operationType = 'ARCHIVE';
  const userEmail = 'test@example.com';

  const token1 = generateApprovalToken(operationId, operationType, userEmail);
  const token2 = generateApprovalToken(operationId, operationType, userEmail);

  assert.equal(token1, token2, 'Same inputs should generate same token');
  assert.equal(token1.length, 64, 'Token should be 64 characters (SHA256 hex)');
});

test('Approval Token: should generate different tokens for different inputs', () => {
  const token1 = generateApprovalToken('op_1', 'ARCHIVE', 'user1@example.com');
  const token2 = generateApprovalToken('op_2', 'ARCHIVE', 'user1@example.com');
  const token3 = generateApprovalToken('op_1', 'LABEL', 'user1@example.com');

  assert.notEqual(token1, token2, 'Different operation IDs should generate different tokens');
  assert.notEqual(token1, token3, 'Different operation types should generate different tokens');
});

test('Approval Token: should validate a correct approval token', () => {
  const operationId = 'op_12345';
  const operationType = 'ARCHIVE';
  const userEmail = 'test@example.com';

  const token = generateApprovalToken(operationId, operationType, userEmail);
  assert.doesNotThrow(() => {
    validateApprovalToken(token, operationId, operationType, userEmail);
  });
});

test('Approval Token: should reject invalid approval token', () => {
  const operationId = 'op_12345';
  const operationType = 'ARCHIVE';
  const userEmail = 'test@example.com';

  assert.throws(() => {
    validateApprovalToken('0000000000000000000000000000000000000000000000000000000000000000', operationId, operationType, userEmail);
  }, /Invalid approval token/);
});

test('Approval Token: should reject when operationId does not match', () => {
  const token = generateApprovalToken('op_12345', 'ARCHIVE', 'test@example.com');

  assert.throws(() => {
    validateApprovalToken(token, 'op_99999', 'ARCHIVE', 'test@example.com');
  }, /Invalid approval token/);
});

test('Approval Token: should reject when operationType does not match', () => {
  const token = generateApprovalToken('op_12345', 'ARCHIVE', 'test@example.com');

  assert.throws(() => {
    validateApprovalToken(token, 'op_12345', 'LABEL', 'test@example.com');
  }, /Invalid approval token/);
});

test('Approval Token: should reject when userEmail does not match', () => {
  const token = generateApprovalToken('op_12345', 'ARCHIVE', 'test@example.com');

  assert.throws(() => {
    validateApprovalToken(token, 'op_12345', 'ARCHIVE', 'attacker@example.com');
  }, /Invalid approval token/);
});

test('Encryption: should encrypt and decrypt tokens correctly', () => {
  process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const originalToken = 'refresh_token_xyz_123';

  const encrypted = encryptToken(originalToken);
  const decrypted = decryptToken(encrypted);

  assert.equal(decrypted, originalToken, 'Decrypted token should match original');
});

test('Encryption: should fail when encryption key is invalid format', () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'invalid_key_too_short';

  assert.throws(() => {
    encryptToken('test');
  }, /Invalid|invalid/i);
});

test('Encryption: should fail when encryption key is missing', () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  delete process.env.TOKEN_ENCRYPTION_KEY;

  assert.throws(() => {
    encryptToken('test');
  }, /Invalid|invalid|missing/i);

  process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});
