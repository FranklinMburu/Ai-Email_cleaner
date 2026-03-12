import { google } from 'googleapis';
import { getDatabase } from './database.js';
import { encryptToken, decryptToken } from './encryption.js';

let oauth2Client;

function getOAuth2Client() {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    console.log('OAuth credentials loaded:', {
      clientId: process.env.GOOGLE_CLIENT_ID ? '✓ Loaded' : 'MISSING',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ? '✓ Loaded' : 'MISSING',
      redirectUri: process.env.GOOGLE_REDIRECT_URI ? '✓ Loaded' : 'MISSING',
    });
  }
  return oauth2Client;
}

export function getAuthUrl() {
  const oauth2Client = getOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/gmail.metadata',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
}

export async function exchangeCodeForTokens(code) {
  const { tokens } = await getOAuth2Client().getToken(code);
  return tokens;
}

export async function getGmailClient(userEmail) {
  const db = getDatabase();
  const tokenRecord = db.prepare('SELECT * FROM oauth_tokens WHERE user_email = ?').get(userEmail);

  if (!tokenRecord) {
    throw new Error(`No tokens found for user ${userEmail}`);
  }

  // Check if token is expired and refresh if needed
  let accessToken = decryptToken(tokenRecord.access_token);
  const refreshToken = decryptToken(tokenRecord.refresh_token);
  
  if (Date.now() >= tokenRecord.token_expiry_ms) {
    console.log(`[OAuth] Token expired for ${userEmail}, attempting refresh...`);
    try {
      const refreshedTokens = await refreshTokensWithTimeout(refreshToken, 10000); // 10s timeout
      // Save the refreshed tokens back to database
      await storeTokens(userEmail, refreshedTokens);
      accessToken = refreshedTokens.access_token;
      console.log(`[OAuth] Token refreshed and saved for ${userEmail}`);
    } catch (error) {
      const errorMsg = error.code === 'ENOTFOUND' 
        ? 'Network error - cannot reach Google authentication servers'
        : error.message?.includes('invalid_grant')
        ? 'Authentication failed - refresh token is invalid or revoked. Please reconnect your Gmail account.'
        : error.message?.includes('timeout')
        ? 'Authentication took too long. Please reconnect your Gmail account.'
        : error.message || 'Unknown authentication error';
      console.error(`[OAuth] Token refresh failed for ${userEmail}: ${errorMsg}`, error);
      throw new Error(errorMsg);
    }
  }

  getOAuth2Client().setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth: getOAuth2Client() });
}

export async function refreshTokens(refreshToken) {
  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials;
}

/**
 * Refresh tokens with timeout protection
 * @param {string} refreshToken - The refresh token to use
 * @param {number} timeoutMs - Timeout in milliseconds (default 10000ms)
 * @returns {Promise<object>} Credential object with new tokens
 * @throws {Error} If refresh fails or times out
 */
export async function refreshTokensWithTimeout(refreshToken, timeoutMs = 10000) {
  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  
  const refreshPromise = client.refreshAccessToken();
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Token refresh timeout - Google API did not respond within 10 seconds')), timeoutMs);
  });
  
  const { credentials } = await Promise.race([refreshPromise, timeoutPromise]);
  return credentials;
}

/**
 * Check if a token is valid without attempting to refresh
 * @param {string} userEmail - User email to check
 * @returns {object} Validation result: { isValid, expiresIn, message }
 */
export function validateTokenValidity(userEmail) {
  const db = getDatabase();
  const tokenRecord = db.prepare('SELECT * FROM oauth_tokens WHERE user_email = ?').get(userEmail);
  
  if (!tokenRecord) {
    return { isValid: false, expiresIn: 0, message: 'No authentication token found. Please connect your Gmail account.' };
  }
  
  if (tokenRecord.revoked_at) {
    return { isValid: false, expiresIn: 0, message: 'Gmail authentication was revoked. Please reconnect your account.' };
  }
  
  const expiresInMs = tokenRecord.token_expiry_ms - Date.now();
  const expiresInMinutes = Math.round(expiresInMs / 60000);
  
  if (expiresInMs <= 0) {
    return { isValid: false, expiresIn: 0, message: 'Authentication token expired. Refresh will be attempted on next sync.' };
  }
  
  if (expiresInMs < 300000) { // Less than 5 minutes
    return { isValid: true, expiresIn: expiresInMinutes, message: `Token expires in ${expiresInMinutes} minutes` };
  }
  
  return { isValid: true, expiresIn: expiresInMinutes, message: 'Token is valid' };
}

export async function storeTokens(userEmail, tokens) {
  const db = getDatabase();
  const tokenId = `token_${userEmail}`;
  
  // Calculate expiry: use expiry_date if available, otherwise use expires_in
  let expiryMs = tokens.expiry_date;
  if (!expiryMs && tokens.expires_in) {
    expiryMs = Date.now() + tokens.expires_in * 1000;
  }
  if (!expiryMs) {
    // Default to 1 hour from now if no expiry info
    expiryMs = Date.now() + 3600 * 1000;
  }

  const encryptedRefreshToken = encryptToken(tokens.refresh_token || '');
  const encryptedAccessToken = encryptToken(tokens.access_token);

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO oauth_tokens 
     (id, user_email, refresh_token, access_token, token_expiry_ms, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  );

  stmt.run(tokenId, userEmail, encryptedRefreshToken, encryptedAccessToken, expiryMs);
  console.log(`[OAuth] Stored tokens for ${userEmail}, expiry: ${new Date(expiryMs).toISOString()}`);
}

export async function getStoredTokens(userEmail) {
  const db = getDatabase();
  const record = db.prepare('SELECT * FROM oauth_tokens WHERE user_email = ?').get(userEmail);

  if (!record) {
    return null;
  }

  return {
    refresh_token: decryptToken(record.refresh_token),
    access_token: decryptToken(record.access_token),
    expiry_date: record.token_expiry_ms,
  };
}

export function revokeToken(userEmail) {
  const db = getDatabase();
  db.prepare('UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_email = ?').run(
    userEmail
  );
}
