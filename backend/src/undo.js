import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database.js';
import { getGmailClient } from './oauth.js';

/**
 * Undo a previously executed operation.
 * Only supports operations that are safely reversible.
 * 
 * @param {string} userEmail
 * @param {string} operationId - The operation to undo
 * @returns {object} Undo result with status, summary
 */
export async function undoOperation(userEmail, operationId) {
  const db = getDatabase();
  
  // Fetch the original operation
  const operation = db
    .prepare('SELECT * FROM operations WHERE id = ? AND user_email = ?')
    .get(operationId, userEmail);
  
  if (!operation) {
    throw new Error('Operation not found');
  }
  
  if (operation.status === 'executing') {
    throw new Error('Cannot undo operation that is currently executing');
  }

  // Only undo completed/partial_failure operations
  if (!['completed', 'partial_failure'].includes(operation.status)) {
    throw new Error(`Cannot undo operation with status: ${operation.status}`);
  }

  const operationType = operation.operation_type;
  const messageIds = JSON.parse(operation.affected_message_ids || '[]');
  
  if (messageIds.length === 0) {
    throw new Error('No messages found for this operation');
  }

  // Determine if this operation type is reversible
  if (!isOperationReversible(operationType)) {
    throw new Error(`Operation type ${operationType} cannot be undone`);
  }

  const gmail = await getGmailClient(userEmail);
  
  // Execute the undo action
  const undoResult = await executeUndo(gmail, operationType, messageIds);

  // Create undo operation record
  const undoOpId = `undo_${uuidv4()}`;
  db.prepare(
    `INSERT INTO operations (id, user_email, operation_type, status, affected_message_ids, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    undoOpId,
    userEmail,
    `UNDO_${operationType}`,
    'completed',
    JSON.stringify(messageIds)
  );

  // Log the undo in audit log
  const auditId = `audit_${uuidv4()}`;
  db.prepare(
    `INSERT INTO audit_log (id, user_email, operation_id, event_type, summary, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    auditId,
    userEmail,
    undoOpId,
    'UNDO',
    `Undid ${operationType} operation ${operationId}: ${undoResult.succeeded}/${messageIds.length} succeeded`,
    JSON.stringify({
      originalOperationId: operationId,
      undoType: operationType,
      results: undoResult
    })
  );

  return {
    undoOperationId: undoOpId,
    originalOperationId: operationId,
    operationType,
    status: undoResult.failed === 0 ? 'success' : 'partial_failure',
    summary: undoResult,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if an operation type is reversible
 */
function isOperationReversible(operationType) {
  // Only ARCHIVE and TRASH are safely reversible
  // LABEL is reversible but depends on knowing the label ID
  // For MVP, only support ARCHIVE and TRASH
  return ['ARCHIVE', 'TRASH'].includes(operationType);
}

/**
 * Execute the actual undo action in Gmail
 */
async function executeUndo(gmail, operationType, messageIds) {
  const results = { succeeded: 0, failed: 0, errors: [] };
  const batchSize = 500;

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, Math.min(i + batchSize, messageIds.length));

    try {
      if (operationType === 'ARCHIVE') {
        // Undo ARCHIVE: add INBOX label back
        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch,
            addLabelIds: ['INBOX'],
          },
        });
        results.succeeded += batch.length;
      } else if (operationType === 'TRASH') {
        // Undo TRASH: remove TRASH label and add INBOX back
        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch,
            removeLabelIds: ['TRASH'],
            addLabelIds: ['INBOX'],
          },
        });
        results.succeeded += batch.length;
      }
    } catch (error) {
      results.failed += batch.length;
      results.errors.push({
        batch: i / batchSize,
        error: error.message,
        count: batch.length,
      });
      console.error(`[Undo] Batch error for ${operationType}:`, error);
    }
  }

  return results;
}

/**
 * Get undo information for an operation
 * Returns whether it can be undone and any constraints
 */
export function getUndoInfo(operation) {
  const operationType = operation.operation_type;
  
  if (!isOperationReversible(operationType)) {
    return {
      canUndo: false,
      reason: `${operationType} operations cannot be undone`,
    };
  }

  if (!['completed', 'partial_failure'].includes(operation.status)) {
    return {
      canUndo: false,
      reason: `Cannot undo ${operation.status} operations`,
    };
  }

  let timeLimit = null;
  if (operationType === 'ARCHIVE') {
    timeLimit = '24 hours';
  } else if (operationType === 'TRASH') {
    timeLimit = '30 days';
  }

  return {
    canUndo: true,
    operationType,
    timeLimit,
    note: `This operation can be undone for up to ${timeLimit}`,
  };
}
