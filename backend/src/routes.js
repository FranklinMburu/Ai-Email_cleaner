import express from 'express';
import { getAuthUrl, exchangeCodeForTokens, storeTokens, revokeToken, validateTokenValidity } from './oauth.js';
import { syncMetadata, clearMetadataCache } from './sync.js';
import { generateRecommendations } from './categorize.js';
import { createDryRunOperation, executeOperation, getOperationLog } from './operations.js';
import { exportOperationLogs, exportReportData, getFilteredOperationLog } from './export.js';
import { undoOperation, getUndoInfo } from './undo.js';
import {
  saveFilterPreset,
  getFilterPresets,
  getFilterPreset,
  deleteFilterPreset,
  saveOperationPreset,
  getOperationPresets,
  getOperationPreset,
  deleteOperationPreset,
} from './presets.js';
import {
  setSenderControl,
  getSenderControl,
  removeSenderControl,
  getAllSenderControls,
  getSenderControlsByType,
  getSenderStats,
} from './sender-controls.js';
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

// Validate token without attempting sync
router.get('/api/auth/token-status', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const tokenValidity = validateTokenValidity(userEmail);
    res.json(tokenValidity);
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
    
    // Support filtering by type, status, date range
    const filters = {
      type: req.query.type,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: parseInt(req.query.limit || '50'),
      offset: parseInt(req.query.offset || '0'),
    };
    
    // Remove undefined filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined) delete filters[key];
    });
    
    const logs = getFilteredOperationLog(userEmail, filters);
    
    // Enrich logs with undo info
    const db = getDatabase();
    const enrichedLogs = logs.map(log => {
      const operation = db.prepare('SELECT * FROM operations WHERE id = ?').get(log.id);
      const undoInfo = operation ? getUndoInfo(operation) : { canUndo: false };
      return {
        ...log,
        undoInfo,
      };
    });
    
    res.json({ logs: enrichedLogs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export endpoints
router.get('/api/export/logs', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const format = req.query.format || 'json'; // 'csv' or 'json'
    const limit = parseInt(req.query.limit || '500');
    
    if (!['csv', 'json'].includes(format)) {
      return res.status(400).json({ error: "Format must be 'csv' or 'json'" });
    }
    
    const data = exportOperationLogs(userEmail, format, limit);
    
    const filename = `logs_${new Date().toISOString().slice(0, 10)}.${format}`;
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/export/report', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const format = req.query.format || 'json'; // 'csv' or 'json'
    
    if (!['csv', 'json'].includes(format)) {
      return res.status(400).json({ error: "Format must be 'csv' or 'json'" });
    }
    
    const data = exportReportData(userEmail, format);
    
    const filename = `report_${new Date().toISOString().slice(0, 10)}.${format}`;
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Undo endpoint
router.post('/api/operation/undo', async (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const { operationId } = req.body;
    
    if (!operationId) {
      return res.status(400).json({ error: 'operationId is required' });
    }
    
    const result = await undoOperation(userEmail, operationId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Filter Preset endpoints
router.post('/api/presets/filters', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const { name, description, filters } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    
    const preset = saveFilterPreset(userEmail, name, description, filters);
    res.json(preset);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/api/presets/filters', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const presets = getFilterPresets(userEmail);
    res.json({ presets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/presets/filters/:presetId', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const preset = getFilterPreset(userEmail, req.params.presetId);
    
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    
    res.json(preset);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/presets/filters/:presetId', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    deleteFilterPreset(userEmail, req.params.presetId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Operation Preset endpoints
router.post('/api/presets/operations', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const { name, description, operationType, config } = req.body;
    
    if (!name || !operationType || !config) {
      return res.status(400).json({ error: 'name, operationType, and config are required' });
    }
    
    const preset = saveOperationPreset(userEmail, name, description, operationType, config);
    res.json(preset);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/api/presets/operations', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const operationType = req.query.type || null;
    const presets = getOperationPresets(userEmail, operationType);
    res.json({ presets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/presets/operations/:presetId', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const preset = getOperationPreset(userEmail, req.params.presetId);
    
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    
    res.json(preset);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/presets/operations/:presetId', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    deleteOperationPreset(userEmail, req.params.presetId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Sender Controls endpoints
router.post('/api/senders/control', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const { senderEmail, controlType, reason } = req.body;
    
    if (!senderEmail || !controlType) {
      return res.status(400).json({ error: 'senderEmail and controlType are required' });
    }
    
    const control = setSenderControl(userEmail, senderEmail, controlType, reason);
    res.json(control);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/api/senders/control/:senderEmail', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const control = getSenderControl(userEmail, req.params.senderEmail);
    res.json(control || { senderEmail: req.params.senderEmail, control: null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/senders/control/:senderEmail', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    removeSenderControl(userEmail, req.params.senderEmail);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/api/senders/controls', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const controlType = req.query.type || null;
    
    const controls = controlType 
      ? getSenderControlsByType(userEmail, controlType)
      : getAllSenderControls(userEmail);
    
    res.json({ controls });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/senders/stats', (req, res) => {
  try {
    const userEmail = getCurrentUserEmail(req);
    const limit = parseInt(req.query.limit || '50');
    const stats = getSenderStats(userEmail, limit);
    res.json({ senders: stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
