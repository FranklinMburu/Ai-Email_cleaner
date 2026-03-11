/**
 * Utility functions for formatting data display
 */

export const formatDate = (timestamp) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
};

export const formatEmail = (email) => {
  if (!email) return '';
  return email.length > 40 ? email.substring(0, 37) + '...' : email;
};

export const formatNumber = (num) => {
  if (!num) return '0';
  return num.toLocaleString();
};

export const formatConfidence = (confidence) => {
  if (confidence === undefined || confidence === null) return '0%';
  return `${Math.round(confidence * 100)}%`;
};

export const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

export const truncateText = (text, maxLength = 80) => {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
};
