import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database.js';
import { getGmailClient } from './oauth.js';

export async function createDryRunOperation(userEmail, operationConfig) {
  const { operationType, categories, batchSize = 500, includeProtected = false } = operationConfig;

  if (!['LABEL', 'ARCHIVE', 'TRASH'].includes(operationType)) {
    throw new Error('Invalid operation type');
  }

  const db = getDatabase();

  // Query messages in selected categories
  const messages = db
    .prepare(
      `SELECT m.* FROM message_metadata m
       JOIN categorization_cache c ON m.message_id = c.message_id
       WHERE m.user_email = ? AND c.category_id IN (${categories.map(() => '?').join(',')})
       AND m.message_id NOT IN (
         SELECT message_id FROM message_metadata WHERE user_email = ? AND is_starred = 1
       )`
    )
    .all(userEmail, ...categories, userEmail);

  // Check for protected (starred or important)
  const protectedMessages = [];
  if (!includeProtected) {
    protectedMessages.push(
      ...db
        .prepare(
          `SELECT message_id FROM message_metadata WHERE user_email = ? AND is_starred = 1`
        )
        .all(userEmail)
        .map((m) => m.message_id)
    );
  }

  // Prepare preview
  const affectedMessages = messages
    .filter((m) => !protectedMessages.includes(m.message_id))
    .slice(0, 10); // Sample

  const dryRunResult = {
    operationId: `op_${uuidv4()}`,
    operationType,
    categories,
    totalAffected: messages.filter((m) => !protectedMessages.includes(m.message_id)).length,
    batchCount: Math.ceil(
      messages.filter((m) => !protectedMessages.includes(m.message_id)).length / batchSize
    ),
    estimatedTimeSeconds: Math.ceil(
      (messages.filter((m) => !protectedMessages.includes(m.message_id)).length / batchSize) * 30
    ),
    sampleAffected: affectedMessages.map((m) => ({
      id: m.message_id,
      subject: m.subject,
      from: m.from_addr,
      date: new Date(m.internal_date_ms).toISOString(),
    })),
    riskAssessment: {
      protectedEmailConflict: protectedMessages.length,
      recentEmailConflict: messages.filter(
        (m) =>
          Date.now() - m.internal_date_ms < 7 * 24 * 60 * 60 * 1000 &&
          !protectedMessages.includes(m.message_id)
      ).length,
      unreadEmailConflict: messages.filter(
        (m) => m.is_unread && !protectedMessages.includes(m.message_id)
      ).length,
      overallRisk: messages.length > 0 ? 'low' : 'high',
    },
    reversibilityNotes:
      operationType === 'ARCHIVE'
        ? 'All messages will be removed from INBOX. Undo available for 24 hours.'
        : operationType === 'LABEL'
          ? 'All messages will be labeled. Undo available by removing the label.'
          : 'All messages will be moved to Trash. Undo available for 30 days.',
    canProceed: messages.filter((m) => !protectedMessages.includes(m.message_id)).length > 0,
    warnings:
      protectedMessages.length > 0
        ? [`${protectedMessages.length} starred/important emails will be excluded`]
        : [],
  };

  return {
    ...dryRunResult,
    approvalToken: generateApprovalToken(dryRunResult.operationId),
  };
}

export async function executeOperation(userEmail, operationConfig) {
  const {
    operationId,
    operationType,
    categories,
    batchSize = 500,
    includeProtected = false,
    labelName,
  } = operationConfig;

  const db = getDatabase();
  const gmail = await getGmailClient(userEmail);

  // Fetch messages to operate on
  const messages = db
    .prepare(
      `SELECT m.* FROM message_metadata m
       JOIN categorization_cache c ON m.message_id = c.message_id
       WHERE m.user_email = ? AND c.category_id IN (${categories.map(() => '?').join(',')})
       ${!includeProtected ? "AND m.is_starred = 0 AND m.label_ids NOT LIKE '%IMPORTANT%'" : ''}`
    )
    .all(userEmail, ...categories);

  const messageIds = messages.map((m) => m.message_id);

  // Create operation record
  const opRecord = {
    id: operationId,
    user_email: userEmail,
    operation_type: operationType,
    status: 'executing',
    categories: JSON.stringify(categories),
    affected_message_ids: JSON.stringify(messageIds),
  };

  const stmt = db.prepare(
    `INSERT INTO operations (id, user_email, operation_type, status, categories, affected_message_ids)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    opRecord.id,
    opRecord.user_email,
    opRecord.operation_type,
    opRecord.status,
    opRecord.categories,
    opRecord.affected_message_ids
  );

  // Execute in batches
  const results = { succeeded: 0, failed: 0, errors: [] };
  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, Math.min(i + batchSize, messageIds.length));

    try {
      switch (operationType) {
        case 'ARCHIVE':
          await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: {
              ids: batch,
              removeLabelIds: ['INBOX'],
            },
          });
          results.succeeded += batch.length;
          break;

        case 'LABEL': {
          // Get or create label
          const labels = await gmail.users.labels.list({ userId: 'me' });
          let labelId = labels.data.labels.find((l) => l.name === labelName)?.id;

          if (!labelId) {
            const createRes = await gmail.users.labels.create({
              userId: 'me',
              requestBody: { name: labelName, labelListVisibility: 'labelShow' },
            });
            labelId = createRes.data.id;
          }

          await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: {
              ids: batch,
              addLabelIds: [labelId],
            },
          });
          results.succeeded += batch.length;
          break;
        }

        case 'TRASH':
          // Remove from INBOX and add TRASH
          await gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: {
              ids: batch,
              addLabelIds: ['TRASH'],
              removeLabelIds: ['INBOX'],
            },
          });
          results.succeeded += batch.length;
          break;

        default:
          throw new Error(`Unknown operation type: ${operationType}`);
      }
    } catch (error) {
      results.failed += batch.length;
      results.errors.push({
        batch: i / batchSize,
        error: error.message,
        count: batch.length,
      });
      console.error(`[Operation] Batch error:`, error);
    }
  }

  // Update operation record
  db.prepare(
    `UPDATE operations SET status = ?, execution_results = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    results.failed === 0 ? 'completed' : 'partial_failure',
    JSON.stringify(results),
    operationId
  );

  // Create audit log
  const auditId = `audit_${uuidv4()}`;
  db.prepare(
    `INSERT INTO audit_log (id, user_email, operation_id, event_type, summary, message_ids)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    auditId,
    userEmail,
    operationId,
    operationType,
    `${operationType} on ${categories.join(',')} - ${results.succeeded}/${messageIds.length} succeeded`,
    JSON.stringify(messageIds.slice(0, 100))
  );

  return {
    operationId,
    status: results.failed === 0 ? 'success' : 'partial_failure',
    summary: results,
    timestamp: new Date().toISOString(),
  };
}

export function getOperationLog(userEmail, limit = 50) {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, operation_type, status, created_at, affected_message_ids, execution_results
       FROM operations WHERE user_email = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userEmail, limit)
    .map((op) => ({
      id: op.id,
      type: op.operation_type,
      status: op.status,
      timestamp: op.created_at,
      affectedCount: JSON.parse(op.affected_message_ids || '[]').length,
      results: op.execution_results ? JSON.parse(op.execution_results) : null,
    }));
}

function generateApprovalToken(operationId) {
  // Simple token: operation_id + timestamp
  return Buffer.from(`${operationId}:${Date.now()}`).toString('base64');
}
