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
  let accessToken = tokenRecord.access_token;
  if (Date.now() >= tokenRecord.token_expiry_ms) {
    const refreshedTokens = await refreshTokens(tokenRecord.refresh_token);
    accessToken = refreshedTokens.access_token;
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

export async function storeTokens(userEmail, tokens) {
  const db = getDatabase();
  const tokenId = `token_${userEmail}`;
  const expiryMs = tokens.expiry_date || Date.now() + tokens.expires_in * 1000;

  const encryptedRefreshToken = encryptToken(tokens.refresh_token || '');
  const encryptedAccessToken = encryptToken(tokens.access_token);

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO oauth_tokens 
     (id, user_email, refresh_token, access_token, token_expiry_ms, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  );

  stmt.run(tokenId, userEmail, encryptedRefreshToken, encryptedAccessToken, expiryMs);
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
