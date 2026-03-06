import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const client = axios.create({
  baseURL: API_BASE,
});

// Add session ID to all requests
client.interceptors.request.use((config) => {
  const sessionId = localStorage.getItem('sessionId');
  if (sessionId) {
    config.headers['x-session-id'] = sessionId;
  }
  return config;
});

export const api = {
  auth: {
    initOAuth: () => client.get('/api/auth/init'),
    callback: (code) => client.post('/api/auth/callback', { code }),
    disconnect: () => client.post('/api/auth/disconnect'),
  },

  inbox: {
    getOverview: () => client.get('/api/inbox-overview'),
  },

  sync: {
    start: (mode = 'incremental') => client.post('/api/sync', { mode }),
    clear: () => client.post('/api/sync/clear'),
  },

  report: {
    generate: () => client.get('/api/report'),
  },

  operations: {
    dryRun: (operationType, categories, labelName) =>
      client.post('/api/operation/dryrun', {
        operationType,
        categories,
        labelName,
      }),
    execute: (operationId, operationType, categories, labelName, approvalToken) =>
      client.post('/api/operation/execute', {
        operationId,
        operationType,
        categories,
        labelName,
        approvalToken,
      }),
    getLogs: () => client.get('/api/logs'),
  },
};

export default api;
