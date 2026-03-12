import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database.js';

/**
 * Sender Controls - Whitelist, blacklist, and ignore specific senders
 * 
 * Control types:
 * - WHITELIST: Always keep (exclude from cleanup)
 * - BLACKLIST: Always clean (prioritize for cleanup)
 * - IGNORE: Skip recommendations for this sender
 */

export function setSenderControl(userEmail, senderEmail, controlType, reason = null) {
  if (!['WHITELIST', 'BLACKLIST', 'IGNORE'].includes(controlType)) {
    throw new Error('Invalid control type. Must be WHITELIST, BLACKLIST, or IGNORE.');
  }
  
  const db = getDatabase();
  const id = `sender_${uuidv4()}`;
  
  db.prepare(
    `INSERT OR REPLACE INTO sender_controls (id, user_email, sender_email, control_type, reason, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    id,
    userEmail,
    senderEmail.toLowerCase(),
    controlType,
    reason || null
  );
  
  return {
    id,
    senderEmail: senderEmail.toLowerCase(),
    controlType,
    reason,
  };
}

export function getSenderControl(userEmail, senderEmail) {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM sender_controls WHERE user_email = ? AND sender_email = ?')
    .get(userEmail, senderEmail.toLowerCase());
  
  return row ? {
    id: row.id,
    senderEmail: row.sender_email,
    controlType: row.control_type,
    reason: row.reason,
    createdAt: row.created_at,
  } : null;
}

export function removeSenderControl(userEmail, senderEmail) {
  const db = getDatabase();
  db.prepare('DELETE FROM sender_controls WHERE user_email = ? AND sender_email = ?')
    .run(userEmail, senderEmail.toLowerCase());
}

export function getAllSenderControls(userEmail) {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM sender_controls WHERE user_email = ? ORDER BY created_at DESC')
    .all(userEmail)
    .map(row => ({
      id: row.id,
      senderEmail: row.sender_email,
      controlType: row.control_type,
      reason: row.reason,
      createdAt: row.created_at,
    }));
}

export function getSenderControlsByType(userEmail, controlType) {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM sender_controls WHERE user_email = ? AND control_type = ? ORDER BY created_at DESC')
    .all(userEmail, controlType)
    .map(row => ({
      id: row.id,
      senderEmail: row.sender_email,
      controlType: row.control_type,
      reason: row.reason,
      createdAt: row.created_at,
    }));
}

/**
 * Get sender statistics for the user
 * Returns top senders by email volume with their control status
 */
export function getSenderStats(userEmail, limit = 50) {
  const db = getDatabase();
  
  // Get top senders by count
  const senders = db
    .prepare(
      `SELECT from_addr, COUNT(*) as count
       FROM message_metadata
       WHERE user_email = ?
       GROUP BY from_addr
       ORDER BY count DESC
       LIMIT ?`
    )
    .all(userEmail, limit)
    .map(row => ({
      senderEmail: row.from_addr,
      messageCount: row.count,
      control: getSenderControl(userEmail, row.from_addr),
    }));
  
  return senders;
}

/**
 * Check if a sender should be excluded from cleanup
 * Returns true if sender is whitelisted
 */
export function isSenderWhitelisted(userEmail, senderEmail) {
  const control = getSenderControl(userEmail, senderEmail);
  return control && control.controlType === 'WHITELIST';
}

/**
 * Check if a sender should be prioritized for cleanup
 * Returns true if sender is blacklisted
 */
export function isSenderBlacklisted(userEmail, senderEmail) {
  const control = getSenderControl(userEmail, senderEmail);
  return control && control.controlType === 'BLACKLIST';
}

/**
 * Check if a sender should be ignored in recommendations
 * Returns true if sender is ignored
 */
export function isSenderIgnored(userEmail, senderEmail) {
  const control = getSenderControl(userEmail, senderEmail);
  return control && control.controlType === 'IGNORE';
}
