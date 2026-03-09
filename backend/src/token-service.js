import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database.js';

/**
 * Token Service: Cryptographic generation, hashing, validation, and expiry management
 * Spec: Approval tokens stored as hashes only (no raw tokens in DB)
 * Token format: base64(uuid + 32 random bytes)
 * Hash: SHA256(token) stored in approval_tokens table
 * Expiry: 24 hours for EXECUTE, 30 days for UNDO_EXECUTE
 */

/**
 * Generate a cryptographically secure approval token
 * Token = base64(uuid + 32 random bytes)
 * @param {string} operationId - The operation ID
 * @param {string} tokenType - 'EXECUTE' or 'UNDO_EXECUTE'
 * @returns {{token: string, expiresAt: number, tokenId: string}}
 */
export function generateApprovalToken(operationId, tokenType = 'EXECUTE') {
  if (!['EXECUTE', 'UNDO_EXECUTE'].includes(tokenType)) {
    throw new Error(`Invalid token type: ${tokenType}. Must be EXECUTE or UNDO_EXECUTE.`);
  }

  // Generate base token: uuid + 32 random bytes
  const uuidPart = Buffer.from(uuidv4().replace(/-/g, ''), 'hex');
  const randomPart = crypto.randomBytes(32);
  const tokenBuffer = Buffer.concat([uuidPart, randomPart]);
  const token = tokenBuffer.toString('base64');

  // Compute expiry: 24 hours for EXECUTE, 30 days for UNDO_EXECUTE
  const expiryMs =
    tokenType === 'EXECUTE' ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expiryMs).toISOString();

  const tokenId = `token_${uuidv4()}`;

  return {
    token, // Raw token (returned once to client, NOT stored)
    expiresAt,
    tokenId,
    tokenType,
  };
}

/**
 * Hash a token using SHA256 (no salt per spec)
 * @param {string} rawToken - The raw token (from client)
 * @returns {string} SHA256 hex digest
 */
export function hashToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Token must be a non-empty string');
  }
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Store token hash and metadata in approval_tokens table
 * Constraint: No raw token stored, only hash
 * @param {string} operationId - The operation ID
 * @param {string} tokenId - Unique token identifier
 * @param {string} tokenHash - SHA256 hash of raw token
 * @param {string} expiresAt - ISO datetime string
 * @param {string} tokenType - 'EXECUTE' or 'UNDO_EXECUTE'
 * @returns {boolean} True if stored successfully
 */
export function storeTokenHash(operationId, tokenId, tokenHash, expiresAt, tokenType) {
  const db = getDatabase();

  try {
    db.prepare(
      `INSERT INTO approval_tokens
       (token_id, operation_id, token_type, hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(tokenId, operationId, tokenType, tokenHash, expiresAt);
    return true;
  } catch (error) {
    console.error('[TokenService] Error storing token hash:', error.message);
    throw error;
  }
}

/**
 * Retrieve token hash from database
 * @param {string} tokenHash - SHA256 hash to look up
 * @returns {object|null} { token_id, operation_id, token_type, expires_at, used_at } or null
 */
function getTokenByHash(tokenHash) {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT token_id, operation_id, token_type, expires_at, used_at
       FROM approval_tokens
       WHERE hash = ?`
    )
    .get(tokenHash);
}

/**
 * Validate an approval token
 * Checks: hash match, not expired, not already used
 * @param {string} rawToken - Raw token from client
 * @param {string} operationId - Expected operation ID (for validation)
 * @param {string} tokenType - Expected token type (for validation)
 * @returns {{valid: boolean, reason?: string, tokenId?: string}}
 */
export function validateApprovalToken(rawToken, operationId, tokenType = 'EXECUTE') {
  if (!rawToken) {
    return { valid: false, reason: 'Token is required' };
  }

  const tokenHash = hashToken(rawToken);
  const storedToken = getTokenByHash(tokenHash);

  if (!storedToken) {
    return { valid: false, reason: 'Token not found or invalid' };
  }

  // Check operation ID matches
  if (storedToken.operation_id !== operationId) {
    return { valid: false, reason: 'Token operation ID mismatch' };
  }

  // Check token type matches
  if (storedToken.token_type !== tokenType) {
    return {
      valid: false,
      reason: `Token type mismatch: expected ${tokenType}, got ${storedToken.token_type}`,
    };
  }

  // Check expiry
  const expiryTime = new Date(storedToken.expires_at).getTime();
  if (Date.now() > expiryTime) {
    return { valid: false, reason: 'Token has expired' };
  }

  // Check one-time use (not already used)
  if (storedToken.used_at) {
    return { valid: false, reason: 'Token has already been used' };
  }

  return { valid: true, tokenId: storedToken.token_id };
}

/**
 * Mark token as used (one-time use enforcement)
 * Sets used_at timestamp; prevents reuse
 * @param {string} tokenId - The token ID
 * @returns {boolean} True if marked successfully
 */
export function markTokenUsed(tokenId) {
  const db = getDatabase();

  try {
    const result = db
      .prepare(`UPDATE approval_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_id = ?`)
      .run(tokenId);
    return result.changes > 0;
  } catch (error) {
    console.error('[TokenService] Error marking token used:', error.message);
    throw error;
  }
}

/**
 * Clean up expired tokens (optional maintenance task)
 * Removes tokens that have expired and been used
 * @returns {number} Count of deleted tokens
 */
export function cleanupExpiredTokens() {
  const db = getDatabase();

  try {
    const result = db
      .prepare(
        `DELETE FROM approval_tokens
         WHERE expires_at < CURRENT_TIMESTAMP AND used_at IS NOT NULL`
      )
      .run();
    return result.changes;
  } catch (error) {
    console.error('[TokenService] Error cleaning up tokens:', error.message);
    throw error;
  }
}

/**
 * Get token status (for debugging/testing)
 * @param {string} tokenId - The token ID
 * @returns {object|null} Token record or null
 */
export function getTokenStatus(tokenId) {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM approval_tokens WHERE token_id = ?`).get(tokenId);
}
