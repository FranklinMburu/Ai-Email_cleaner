import { getDatabase } from './database.js';

/**
 * Export operation logs as CSV or JSON
 * @param {string} userEmail
 * @param {string} format - 'csv' or 'json'
 * @param {number} limit - number of records to export
 * @returns {string} CSV or JSON string
 */
export function exportOperationLogs(userEmail, format = 'json', limit = 500) {
  const db = getDatabase();
  
  const operations = db
    .prepare(
      `SELECT id, operation_type, status, created_at, affected_message_ids, execution_results
       FROM operations WHERE user_email = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userEmail, limit)
    .map((op) => ({
      operationId: op.id,
      type: op.operation_type,
      status: op.status,
      timestamp: op.created_at,
      affectedCount: JSON.parse(op.affected_message_ids || '[]').length,
      results: op.execution_results ? JSON.parse(op.execution_results) : null,
    }));

  if (format === 'csv') {
    return logsToCSV(operations);
  }
  return JSON.stringify(operations, null, 2);
}

/**
 * Export recommendation/report data as CSV or JSON
 * @param {string} userEmail
 * @param {string} format - 'csv' or 'json'
 * @returns {string} CSV or JSON string
 */
export function exportReportData(userEmail, format = 'json') {
  const db = getDatabase();

  // Aggregate categories and counts
  const categories = db
    .prepare(
      `SELECT category_name, COUNT(*) as count
       FROM categorization_cache
       WHERE user_email = ?
       GROUP BY category_name
       ORDER BY count DESC`
    )
    .all(userEmail);

  // Get message counts by status
  const msgCounts = db
    .prepare(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_unread = 1 THEN 1 ELSE 0 END) as unread,
        SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END) as starred,
        SUM(CASE WHEN internal_date_ms < datetime('now', '-30 days', 'unixepoch') * 1000 THEN 1 ELSE 0 END) as older_30_days
       FROM message_metadata
       WHERE user_email = ?`
    )
    .get(userEmail);

  const report = {
    exportDate: new Date().toISOString(),
    userEmail,
    messageCounts: msgCounts,
    categories: categories.map(c => ({
      category: c.category_name,
      messageCount: c.count
    }))
  };

  if (format === 'csv') {
    return reportToCSV(report);
  }
  return JSON.stringify(report, null, 2);
}

/**
 * Convert operations logs to CSV
 */
function logsToCSV(operations) {
  const headers = ['Operation ID', 'Type', 'Status', 'Timestamp', 'Affected Count', 'Succeeded', 'Failed'];
  const rows = operations.map(op => [
    op.operationId,
    op.type,
    op.status,
    op.timestamp,
    op.affectedCount,
    op.results?.succeeded || 0,
    op.results?.failed || 0,
  ]);

  return [headers, ...rows].map(row => 
    row.map(cell => {
      const str = String(cell || '');
      // Quote cells with commas, quotes, or newlines
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  ).join('\n');
}

/**
 * Convert report data to CSV
 */
function reportToCSV(report) {
  const lines = [];
  
  // Header
  lines.push('Gmail Inbox Cleanup Report');
  lines.push(`Export Date,${report.exportDate}`);
  lines.push(`User Email,${report.userEmail}`);
  lines.push('');
  
  // Message counts
  lines.push('Message Counts');
  lines.push('Metric,Count');
  lines.push(`Total Messages,${report.messageCounts.total}`);
  lines.push(`Unread,${report.messageCounts.unread}`);
  lines.push(`Starred,${report.messageCounts.starred}`);
  lines.push(`Older than 30 days,${report.messageCounts.older_30_days}`);
  lines.push('');
  
  // Categories
  lines.push('Categories');
  lines.push('Category,Message Count');
  report.categories.forEach(cat => {
    lines.push(`"${cat.category}",${cat.messageCount}`);
  });
  
  return lines.join('\n');
}

/**
 * Get filterable audit log entries with support for advanced filtering
 * @param {string} userEmail
 * @param {object} filters - { type, status, startDate, endDate, limit, offset }
 * @returns {array} filtered audit log entries
 */
export function getFilteredOperationLog(userEmail, filters = {}) {
  const { type, status, startDate, endDate, limit = 50, offset = 0 } = filters;
  const db = getDatabase();
  
  let query = 'SELECT * FROM operations WHERE user_email = ?';
  const params = [userEmail];
  
  if (type) {
    query += ' AND operation_type = ?';
    params.push(type);
  }
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  if (startDate) {
    query += ' AND created_at >= ?';
    params.push(new Date(startDate).toISOString());
  }
  
  if (endDate) {
    query += ' AND created_at <= ?';
    params.push(new Date(endDate).toISOString());
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  const operations = db.prepare(query).all(...params);
  
  return operations.map(op => ({
    id: op.id,
    type: op.operation_type,
    status: op.status,
    timestamp: op.created_at,
    affectedCount: JSON.parse(op.affected_message_ids || '[]').length,
    results: op.execution_results ? JSON.parse(op.execution_results) : null,
  }));
}
