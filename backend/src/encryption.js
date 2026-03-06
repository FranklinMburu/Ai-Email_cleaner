import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;

export function encryptToken(token) {
  const key = getEncryptionKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  // Format: salt(32 chars hex) + iv(24 chars hex) + tag(32 chars hex) + ciphertext
  return `${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decryptToken(encryptedToken) {
  const key = getEncryptionKey();
  const parts = encryptedToken.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted token format');
  }

  const [, ivHex, tagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

function getEncryptionKey() {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    console.warn(
      'TOKEN_ENCRYPTION_KEY not set or invalid. Tokens stored in plaintext (development only).'
    );
    // For development: return a fixed key
    return Buffer.from('0'.repeat(64), 'hex');
  }
  return Buffer.from(keyHex, 'hex');
}

export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}
