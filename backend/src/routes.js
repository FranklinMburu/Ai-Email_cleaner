import express from 'express';
import { getAuthUrl, exchangeCodeForTokens, storeTokens, revokeToken } from './oauth.js';
import { syncMetadata, clearMetadataCache } from './sync.js';
import { generateRecommendations } from './categorize.js';
import { createDryRunOperation, executeOperation, getOperationLog } from './operations.js';
import { getDatabase } from './database.js';
import {
  createSession,
  validateSessionAndGetUser,
  destroySession,
  generateApprovalToken,
  validateApprovalToken,
} from './session-manager.js';

const router = express.Router();

// Middleware: Extract and validate session from x-session-id header
function getCurrentUserEmail(req) {
  const sessionId = req.headers['x-session-id'];
  return validateSessionAndGetUser(sessionId);
}

// Middleware: Validate JSON payload structure for mutation endpoints
function validateSyncPayload(req, res, next) {
  const { mode } = req.body || {};
  if (mode && !['incremental', 'full'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode. Must be "incremental" or "full".' });
  }
  next();
}

function validateDryRunPayload(req, res, next) {
  const { operationType, categories } = req.body || {};
  if (!operationType) {
    return res.status(400).json({ error: 'operationType is required' });
  }
  if (!['LABEL', 'ARCHIVE', 'TRASH'].includes(operationType)) {
    return res.status(400).json({ error: 'Invalid operationType. Must be LABEL, ARCHIVE, or TRASH.' });
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'categories must be a non-empty array' });
  }
  if (operationType === 'LABEL' && !req.body.labelName) {
    return res.status(400).json({ error: 'labelName is required for LABEL operations' });
  }
  next();
}

// OAuth endpoints
router.get('/api/auth/init', (req, res) => {
  try {
    const authUrl = getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Handle Google OAuth redirect (GET with code in query string)
router.get('/api/auth/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      return res.send(`
        <html>
          <head><title>Auth Error</title></head>
          <body>
            <h1>Authentication Error</h1>
            <p>${error}</p>
            <script>
              setTimeout(() => {
                if (window.opener) {
                  window.opener.postMessage({ type: 'oauth_error', error: '${error}' }, '*');
                  window.close();
                }
              }, 500);
            </script>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.send(`
        <html>
          <head><title>Auth Error</title></head>
          <body>
            <h1>Authentication Error</h1>
            <p>No authorization code received</p>
            <script>
              setTimeout(() => {
                if (window.opener) {
                  window.opener.postMessage({ type: 'oauth_error', error: 'No code' }, '*');
                  window.close();
                }
              }, 500);
            </script>
          </body>
        </html>
      `);
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    const userEmail = tokens.id_token
      ? JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64')).email
      : 'unknown@gmail.com';

    await storeTokens(userEmail, tokens);

    // Create persistent database session
    const sessionId = createSession(userEmail);

    // Store success data in query string and redirect to a success page
    res.send(`
      <html>
        <head><title>Authentication Successful</title></head>
        <body>
          <h1>Authentication successful!</h1>
          <p>This window will close automatically.</p>
          <script>
            const data = {
              type: 'oauth_success',
              sessionId: '${sessionId}',
              userEmail: '${userEmail}'
            };
            
            // Try to communicate with opener
            if (window.opener) {
              window.opener.postMessage(data, '*');
              setTimeout(() => { window.close(); }, 1000);
            } else {
              // Fallback: store in localStorage (same domain)
              try {
                localStorage.setItem('oauth_success', JSON.stringify(data));
                setTimeout(() => { window.close(); }, 1000);
              } catch (e) {
                console.error('Could not store in localStorage:', e);
              }
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.send(`
      <html>
        <head><title>Auth Error</title></head>
        <body>
          <h1>Authentication Error</h1>
          <p>${error.message}</p>
          <script>
            setTimeout(() => {
              if (window.opener) {
                window.opener.postMessage({ type: 'oauth_error', error: '${error.message}' }, '*');
                window.close();
              }
            }, 500);
          </script>
        </body>
      </html>
    `);
  }
});

// Handle client-side callback (POST with code in body)
router.post('/api/auth/callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code required' });
    }

    const tokens = await exchangeCodeForTokens(code);
    const userEmail = tokens.id_token
      ? JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64')).email
      : 'unknown@gmail.com';

    await storeTokens(userEmail, tokens);

    // Create persistent database session
    const sessionId = createSession(userEmail);

    res.json({
      sessionId,
      userEmail,
      authUrl: '/api/dashboard',
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/auth/disconnect', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    revokeToken(userEmail);
    const sessionId = req.headers['x-session-id'];
    destroySession(sessionId);
    res.json({ status: 'disconnected' });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// Sync endpoints
router.post('/api/sync', validateSyncPayload, async (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const { mode = 'incremental' } = req.body;

    const result = await syncMetadata(userEmail, { mode });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/sync/clear', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    clearMetadataCache(userEmail);
    res.json({ status: 'cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Report endpoints
router.get('/api/report', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const report = generateRecommendations(userEmail);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/inbox-overview', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const db = getDatabase();

    const totalCount = db
      .prepare('SELECT COUNT(*) as count FROM message_metadata WHERE user_email = ?')
      .get(userEmail).count;

    const unreadCount = db
      .prepare('SELECT COUNT(*) as count FROM message_metadata WHERE user_email = ? AND is_unread = 1')
      .get(userEmail).count;

    const starredCount = db
      .prepare('SELECT COUNT(*) as count FROM message_metadata WHERE user_email = ? AND is_starred = 1')
      .get(userEmail).count;

    res.json({
      totalMessages: totalCount,
      unreadMessages: unreadCount,
      starredMessages: starredCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Operations endpoints
router.post('/api/operation/dryrun', validateDryRunPayload, async (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const { operationType, categories, labelName } = req.body;

    const result = await createDryRunOperation(userEmail, {
      operationType,
      categories,
      labelName,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/operation/execute', async (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const { operationId, operationType, categories, labelName, approvalToken } = req.body;

    if (!operationId || !operationType) {
      return res.status(400).json({ error: 'operationId and operationType required' });
    }

    if (!approvalToken || typeof approvalToken !== 'string') {
      return res.status(403).json({ error: 'Valid approval token required' });
    }

    // Validate approval token against operation details
    validateApprovalToken(approvalToken, operationId, operationType, userEmail);

    const result = await executeOperation(userEmail, {
      operationId,
      operationType,
      categories,
      labelName,
    });

    res.json(result);
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
});

router.get('/api/logs', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const logs = getOperationLog(userEmail);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
