/**
 * Session management with database persistence and TTL support.
 * Sessions are stored in SQLite and expire based on created_at + TTL window.
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDatabase } from './database.js';

// Session TTL: 24 hours in milliseconds
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Create a new session for a user.
 * Returns sessionId that should be used in x-session-id header.
 */
export function createSession(userEmail) {
  const db = getDatabase();
  const sessionId = `sess_${uuidv4()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  db.prepare(
    'INSERT INTO sessions (id, user_email, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(sessionId, userEmail, now.toISOString(), expiresAt.toISOString());

  return sessionId;
}

/**
 * Validate and retrieve user email from a session ID.
 * Throws error if session doesn't exist, is expired, or user_email is invalid.
 */
export function validateSessionAndGetUser(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid session ID');
  }

  const db = getDatabase();
  const session = db
    .prepare(
      'SELECT user_email, expires_at FROM sessions WHERE id = ?'
    )
    .get(sessionId);

  if (!session) {
    throw new Error('Session not found');
  }

  // Check expiry
  const expiresAt = new Date(session.expires_at);
  if (expiresAt < new Date()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    throw new Error('Session expired');
  }

  if (!session.user_email) {
    throw new Error('Invalid session: no user email');
  }

  return session.user_email;
}

/**
 * Delete a session (for logout).
 */
export function destroySession(sessionId) {
  const db = getDatabase();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/**
 * Clean up expired sessions.
 * Call this periodically (e.g., once per hour) to remove old sessions.
 */
export function cleanupExpiredSessions() {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  if (result.changes > 0) {
    console.log(`Cleaned up ${result.changes} expired sessions`);
  }
  return result.changes;
}

/**
 * Generate an approval token for an operation (dry-run).
 * This is a cryptographic hash that must be validated on execute.
 * Format: HMAC-SHA256 hash of (operationId + timestamp + operationType + userEmail)
 */
export function generateApprovalToken(operationId, operationType, userEmail) {
  const secret = process.env.TOKEN_ENCRYPTION_KEY; // Reuse encryption key as HMAC secret
  const payload = `${operationId}::${operationType}::${userEmail}`;
  
  const hmac = crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(payload)
    .digest('hex');

  return hmac;
}

/**
 * Validate an approval token against expected values.
 * Returns true if token is valid, throws error if invalid.
 */
export function validateApprovalToken(approvalToken, operationId, operationType, userEmail) {
  if (!approvalToken || typeof approvalToken !== 'string') {
    throw new Error('Approval token required');
  }

  const expectedToken = generateApprovalToken(operationId, operationType, userEmail);

  // Constant-time comparison to prevent timing attacks
  const tokenBuffer = Buffer.from(approvalToken);
  const expectedBuffer = Buffer.from(expectedToken);

  // Check lengths first
  if (tokenBuffer.length !== expectedBuffer.length) {
    throw new Error('Invalid approval token');
  }

  if (!crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
    throw new Error('Invalid approval token');
  }

  return true;
}
