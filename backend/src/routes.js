import express from 'express';
import { getAuthUrl, exchangeCodeForTokens, storeTokens, revokeToken } from './oauth.js';
import { syncMetadata, clearMetadataCache } from './sync.js';
import { generateRecommendations } from './categorize.js';
import { createDryRunOperation, executeOperation, getOperationLog } from './operations.js';
import { getDatabase } from './database.js';

const router = express.Router();

// Session middleware (simple in-memory for demo)
const sessions = new Map();

function getCurrentUserEmail(req) {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId || !sessions.has(sessionId)) {
    throw new Error('No active session');
  }
  return sessions.get(sessionId);
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

    // Create session
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessions.set(sessionId, userEmail);

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
    sessions.delete(req.headers['x-session-id']);
    res.json({ status: 'disconnected' });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// Sync endpoints
router.post('/api/sync', async (req, res) => {
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
router.post('/api/operation/dryrun', async (req, res) => {
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

    if (!approvalToken) {
      return res.status(403).json({ error: 'Approval required' });
    }

    const result = await executeOperation(userEmail, {
      operationId,
      operationType,
      categories,
      labelName,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
