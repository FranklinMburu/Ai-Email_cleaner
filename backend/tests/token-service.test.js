import { describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import {
  generateApprovalToken,
  hashToken,
  storeTokenHash,
  validateApprovalToken,
  markTokenUsed,
  getTokenStatus,
  cleanupExpiredTokens,
} from '../src/token-service.js';
import { initializeDatabase, closeDatabase, getDatabase } from '../src/database.js';

describe('Token Service', () => {
  let testCounter = 0; // For unique test data

  beforeAll(() => {
    // Use in-memory or test database
    process.env.DB_PATH = ':memory:';
    initializeDatabase();
  });

  beforeEach(() => {
    testCounter++;
    const db = getDatabase();

    // Setup unique oauth_tokens and operations for each test
    const uniqueEmail = `test_${testCounter}@example.com`;
    const operationId = `op_${testCounter}`;

    try {
      db.prepare(
        `INSERT INTO oauth_tokens (id, user_email, refresh_token, access_token, token_expiry_ms)
         VALUES (?, ?, ?, ?, ?)`
      ).run(`oauth_${testCounter}`, uniqueEmail, 'refresh', 'access', Date.now() + 1000000);
    } catch {
      // May already exist from previous test
    }

    try {
      db.prepare(
        `INSERT INTO operations (id, user_email, operation_type, status)
         VALUES (?, ?, ?, ?)`
      ).run(operationId, uniqueEmail, 'ARCHIVE', 'PENDING_APPROVAL');
    } catch {
      // May already exist
    }
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('generateApprovalToken', () => {
    test('should generate a valid EXECUTE token', () => {
      const result = generateApprovalToken('op_1', 'EXECUTE');

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('tokenId');
      expect(result).toHaveProperty('tokenType');
      expect(result.tokenType).toBe('EXECUTE');
      expect(result.token).toBeTruthy();
      expect(result.token.length).toBeGreaterThan(0); // base64 encoded
    });

    test('should generate a valid UNDO_EXECUTE token', () => {
      const result = generateApprovalToken('op_2', 'UNDO_EXECUTE');

      expect(result.tokenType).toBe('UNDO_EXECUTE');
      expect(result.token).toBeTruthy();
    });

    test('should set EXECUTE token expiry to 24 hours', () => {
      const now = Date.now();
      const result = generateApprovalToken('op_3', 'EXECUTE');
      const expiryTime = new Date(result.expiresAt).getTime();

      // Should be approximately 24 hours from now (within 1 minute)
      const expectedExpiry = now + 24 * 60 * 60 * 1000;
      expect(Math.abs(expiryTime - expectedExpiry)).toBeLessThan(60 * 1000);
    });

    test('should set UNDO_EXECUTE token expiry to 30 days', () => {
      const now = Date.now();
      const result = generateApprovalToken('op_4', 'UNDO_EXECUTE');
      const expiryTime = new Date(result.expiresAt).getTime();

      // Should be approximately 30 days from now (within 1 minute)
      const expectedExpiry = now + 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(expiryTime - expectedExpiry)).toBeLessThan(60 * 1000);
    });

    test('should reject invalid token type', () => {
      expect(() => {
        generateApprovalToken('op_5', 'INVALID_TYPE');
      }).toThrow('Invalid token type');
    });

    test('should generate unique tokens', () => {
      const token1 = generateApprovalToken('op_6', 'EXECUTE');
      const token2 = generateApprovalToken('op_6', 'EXECUTE');

      expect(token1.token).not.toBe(token2.token);
      expect(token1.tokenId).not.toBe(token2.tokenId);
    });
  });

  describe('hashToken', () => {
    test('should hash a token to SHA256', () => {
      const token = 'my_test_token_value';
      const hash = hashToken(token);

      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64); // SHA256 hex is 64 chars
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });

    test('should produce consistent hash for same token', () => {
      const token = 'consistent_token';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
    });

    test('should produce different hash for different tokens', () => {
      const hash1 = hashToken('token1');
      const hash2 = hashToken('token2');

      expect(hash1).not.toBe(hash2);
    });

    test('should throw on empty token', () => {
      expect(() => hashToken('')).toThrow();
      expect(() => hashToken(null)).toThrow();
      expect(() => hashToken(undefined)).toThrow();
    });
  });

  describe('storeTokenHash', () => {
    test('should store token hash successfully', () => {
      const operationId = `op_${testCounter}`;
      const uniqueId = `${testCounter}_${Math.random().toString(36).substr(2, 9)}`;
      const tokenId = `token_abc123_${uniqueId}`;
      const tokenHash = hashToken(`raw_token_value_unique_${uniqueId}`);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const result = storeTokenHash(operationId, tokenId, tokenHash, expiresAt, 'EXECUTE');

      expect(result).toBe(true);
    });

    test('should enforce UNIQUE constraint on hash', () => {
      const operationId = `op_${testCounter}`;
      const uniqueId = `${testCounter}_${Math.random().toString(36).substr(2, 9)}`;
      const tokenId1 = `token_def456_${uniqueId}`;
      const tokenId2 = `token_def457_${uniqueId}`;
      // Use a unique hash for this specific test
      const tokenHash = hashToken(`unique_raw_token_constraint_${uniqueId}`);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      storeTokenHash(operationId, tokenId1, tokenHash, expiresAt, 'EXECUTE');

      // Storing the same hash again should fail (UNIQUE constraint)
      expect(() => {
        storeTokenHash(operationId, tokenId2, tokenHash, expiresAt, 'EXECUTE');
      }).toThrow();
    });
  });

  describe('validateApprovalToken', () => {
    test('should validate a correct token', () => {
      const opId = `op_${testCounter}`;
      const { token, tokenId } = generateApprovalToken(opId, 'EXECUTE');
      const hash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      storeTokenHash(opId, tokenId, hash, expiresAt, 'EXECUTE');

      const result = validateApprovalToken(token, opId, 'EXECUTE');

      expect(result.valid).toBe(true);
      expect(result.tokenId).toBe(tokenId);
    });

    test('should reject invalid token', () => {
      const opId = `op_${testCounter}`;
      const result = validateApprovalToken('invalid_token_xyz', opId, 'EXECUTE');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    test('should reject token with wrong operation ID', () => {
      const opId = `op_${testCounter}`;
      const { token, tokenId } = generateApprovalToken(opId, 'EXECUTE');
      const hash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      storeTokenHash(opId, tokenId, hash, expiresAt, 'EXECUTE');

      const result = validateApprovalToken(token, 'op_wrong', 'EXECUTE');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('operation ID mismatch');
    });

    test('should reject token with wrong type', () => {
      const opId = `op_${testCounter}`;
      const { token, tokenId } = generateApprovalToken(opId, 'EXECUTE');
      const hash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      storeTokenHash(opId, tokenId, hash, expiresAt, 'EXECUTE');

      const result = validateApprovalToken(token, opId, 'UNDO_EXECUTE');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('type mismatch');
    });

    test('should reject expired token', () => {
      const opId = `op_${testCounter}`;
      const { token, tokenId } = generateApprovalToken(opId, 'EXECUTE');
      const hash = hashToken(token);
      // Set expiry to 1 second in the past
      const expiresAt = new Date(Date.now() - 1000).toISOString();

      storeTokenHash(opId, tokenId, hash, expiresAt, 'EXECUTE');

      // Small delay to ensure current time is past expiry
      const result = validateApprovalToken(token, opId, 'EXECUTE');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    test('should reject already-used token', () => {
      const opId = `op_${testCounter}`;
      const { token, tokenId } = generateApprovalToken(opId, 'EXECUTE');
      const hash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      storeTokenHash(opId, tokenId, hash, expiresAt, 'EXECUTE');
      markTokenUsed(tokenId);

      const result = validateApprovalToken(token, opId, 'EXECUTE');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already been used');
    });

    test('should reject missing token', () => {
      const opId = `op_${testCounter}`;
      const result = validateApprovalToken(null, opId, 'EXECUTE');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('required');
    });
  });

  describe('markTokenUsed', () => {
    test('should mark token as used', () => {
      const opId = `op_${testCounter}`;
      const { token, tokenId } = generateApprovalToken(opId, 'EXECUTE');
      const hash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      storeTokenHash(opId, tokenId, hash, expiresAt, 'EXECUTE');

      const marked = markTokenUsed(tokenId);
      expect(marked).toBe(true);

      const status = getTokenStatus(tokenId);
      expect(status.used_at).toBeTruthy();
    });

    test('should prevent token reuse', () => {
      const opId = `op_${testCounter}`;
      const { token, tokenId } = generateApprovalToken(opId, 'EXECUTE');
      const hash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      storeTokenHash(opId, tokenId, hash, expiresAt, 'EXECUTE');
      markTokenUsed(tokenId);

      // Try to use same token again
      const validation = validateApprovalToken(token, opId, 'EXECUTE');
      expect(validation.valid).toBe(false);
    });
  });

  describe('cleanupExpiredTokens', () => {
    test('should remove expired and used tokens', () => {
      const db = getDatabase();
      const opId = `op_${testCounter}`;
      const uniqueSuffix = `${testCounter}_${Math.random().toString(36).substr(2, 9)}`;
      const tokenId = `token_cleanup_test_${uniqueSuffix}`;

      // Manually insert an expired and used token
      // Use datetime function to guarantee expiry in the past
      db.prepare(
        `INSERT INTO approval_tokens
         (token_id, operation_id, token_type, hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, datetime('now', '-1 hour'), datetime('now', '-2 hours'), datetime('now', '-2 hours'))`
      ).run(
        tokenId,
        opId,
        'EXECUTE',
        hashToken(`cleanup_test_token_${uniqueSuffix}`)
      );

      const beforeCount = db.prepare('SELECT COUNT(*) as count FROM approval_tokens WHERE token_id = ?').get(tokenId).count;
      expect(beforeCount).toBe(1); // Token exists before cleanup

      const deleted = cleanupExpiredTokens();

      const afterCount = db.prepare('SELECT COUNT(*) as count FROM approval_tokens WHERE token_id = ?').get(tokenId).count;
      // Token should be deleted after cleanup
      expect(afterCount).toBe(0);
      expect(deleted).toBeGreaterThanOrEqual(1);
    });

    test('should not remove unexpired tokens', () => {
      const opId = `op_${testCounter}`;
      const { token, tokenId } = generateApprovalToken(opId, 'EXECUTE');
      const hash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      storeTokenHash(opId, tokenId, hash, expiresAt, 'EXECUTE');

      cleanupExpiredTokens();

      const status = getTokenStatus(tokenId);
      expect(status).toBeTruthy(); // Token should still exist
    });
  });

  describe('Full workflow: Generate → Store → Validate → Use', () => {
    test('should complete a full token lifecycle', () => {
      const opId = `op_${testCounter}`;
      
      // Step 1: Generate token
      const { token, expiresAt, tokenId, tokenType } = generateApprovalToken(opId, 'EXECUTE');

      // Step 2: Hash and store
      const hash = hashToken(token);
      storeTokenHash(opId, tokenId, hash, expiresAt, tokenType);

      // Step 3: Validate (first time)
      const validation1 = validateApprovalToken(token, opId, 'EXECUTE');
      expect(validation1.valid).toBe(true);

      // Step 4: Mark as used
      markTokenUsed(tokenId);

      // Step 5: Validate (second time - should fail)
      const validation2 = validateApprovalToken(token, opId, 'EXECUTE');
      expect(validation2.valid).toBe(false);
      expect(validation2.reason).toContain('already been used');
    });
  });
});
