import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30000, // 30 second timeout for all requests
});

// Add session ID to all requests
client.interceptors.request.use((config) => {
  const sessionId = localStorage.getItem('sessionId');
  if (sessionId) {
    config.headers['x-session-id'] = sessionId;
  }
  return config;
});

// Improve error handling to distinguish between timeout and auth errors
client.interceptors.response.use(
  (response) => response,
  (error) => {
    let enhancedError = error;
    if (error.code === 'ECONNABORTED') {
      enhancedError.message = 'Request timed out - server took too long to respond';
    }
    if (error.response?.status === 401) {
      enhancedError.message = 'Authentication failed - please reconnect your Gmail account';
    }
    return Promise.reject(enhancedError);
  }
);

export const api = {
  auth: {
    initOAuth: () => client.get('/api/auth/init'),
    callback: (code) => client.post('/api/auth/callback', { code }),
    disconnect: () => client.post('/api/auth/disconnect'),
    tokenStatus: () => client.get('/api/auth/token-status'),
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
    getLogs: (filters = {}) => {
      const params = new URLSearchParams();
      if (filters.type) params.append('type', filters.type);
      if (filters.status) params.append('status', filters.status);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.limit) params.append('limit', filters.limit);
      if (filters.offset) params.append('offset', filters.offset);
      
      const url = `/api/logs${params.toString() ? '?' + params.toString() : ''}`;
      return client.get(url);
    },
    undo: (operationId) =>
      client.post('/api/operation/undo', { operationId }),
  },

  export: {
    logs: (format = 'json', limit = 500) => 
      client.get(`/api/export/logs?format=${format}&limit=${limit}`),
    report: (format = 'json') => 
      client.get(`/api/export/report?format=${format}`),
  },

  presets: {
    filters: {
      save: (name, description, filters) =>
        client.post('/api/presets/filters', { name, description, filters }),
      list: () =>
        client.get('/api/presets/filters'),
      get: (presetId) =>
        client.get(`/api/presets/filters/${presetId}`),
      delete: (presetId) =>
        client.delete(`/api/presets/filters/${presetId}`),
    },
    operations: {
      save: (name, description, operationType, config) =>
        client.post('/api/presets/operations', { name, description, operationType, config }),
      list: (operationType = null) =>
        client.get(`/api/presets/operations${operationType ? `?type=${operationType}` : ''}`),
      get: (presetId) =>
        client.get(`/api/presets/operations/${presetId}`),
      delete: (presetId) =>
        client.delete(`/api/presets/operations/${presetId}`),
    },
  },

  senders: {
    setControl: (senderEmail, controlType, reason = null) =>
      client.post('/api/senders/control', { senderEmail, controlType, reason }),
    getControl: (senderEmail) =>
      client.get(`/api/senders/control/${senderEmail}`),
    removeControl: (senderEmail) =>
      client.delete(`/api/senders/control/${senderEmail}`),
    listControls: (controlType = null) =>
      client.get(`/api/senders/controls${controlType ? `?type=${controlType}` : ''}`),
    getStats: (limit = 50) =>
      client.get(`/api/senders/stats?limit=${limit}`),
  },
};

export default api;
