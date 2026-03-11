/**
 * Configuration validation and startup checks.
 * Fails fast if required environment variables are missing or invalid.
 */

export function validateEnvironment() {
  const requiredVars = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'TOKEN_ENCRYPTION_KEY',
  ];

  const missingVars = requiredVars.filter(variable => !process.env[variable]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}. ` +
      `Ensure these are set in your .env file.`
    );
  }

  // Validate encryption key format: must be 64 hex characters (32 bytes)
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error(
      `Invalid TOKEN_ENCRYPTION_KEY format. Must be 64 hexadecimal characters (32 bytes). ` +
      `Current length: ${encryptionKey.length}. ` +
      `Example: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`
    );
  }

  console.log('✓ Environment validation passed');
  return true;
}
