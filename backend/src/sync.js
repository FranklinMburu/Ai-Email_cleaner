import { getGmailClient } from './oauth.js';
import { getDatabase } from './database.js';

const BATCH_SIZE = 100;
const PAGE_TOKEN_LIMIT = 500;

export async function syncMetadata(userEmail, options = {}) {
  const { mode = 'incremental', limit = 40000 } = options;

  console.log(`[Sync] Starting ${mode} sync for ${userEmail}...`);

  const db = getDatabase();
  const gmail = await getGmailClient(userEmail);

  try {
    let messageIds = [];

    if (mode === 'incremental') {
      messageIds = await fetchIncrementalChanges(gmail, userEmail, db);
    } else {
      messageIds = await fetchFullMetadata(gmail, userEmail, db, limit);
    }

    // Fetch detailed metadata for batches
    await fetchMessageMetadataInBatches(gmail, userEmail, messageIds);

    // Update sync state
    const syncState = db.prepare('SELECT * FROM sync_state WHERE user_email = ?').get(userEmail);
    if (syncState) {
      db.prepare(
        'UPDATE sync_state SET last_sync_at = CURRENT_TIMESTAMP WHERE user_email = ?'
      ).run(userEmail);
    } else {
      db.prepare(
        'INSERT INTO sync_state (user_email, last_sync_at) VALUES (?, CURRENT_TIMESTAMP)'
      ).run(userEmail);
    }

    const count = db
      .prepare('SELECT COUNT(*) as count FROM message_metadata WHERE user_email = ?')
      .get(userEmail).count;

    console.log(`[Sync] Complete for ${userEmail}. Total messages: ${count}`);
    return { status: 'completed', messageCount: count };
  } catch (error) {
    console.error('[Sync] Error:', error.message);
    throw error;
  }
}

async function fetchIncrementalChanges(gmail, userEmail, db) {
  const syncState = db.prepare('SELECT * FROM sync_state WHERE user_email = ?').get(userEmail);

  if (!syncState || !syncState.history_id) {
    console.log('[Sync] No previous sync state, performing full sync');
    return fetchFullMetadata(gmail, userEmail, db, 40000);
  }

  try {
    const historyId = syncState.history_id;
    console.log(`[Sync] Using historyId: ${historyId}`);

    const historyList = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      fields: 'history(messagesAdded,messagesDeleted,labelsAdded,labelsRemoved),historyId',
    });

    const changedMessageIds = new Set();

    if (historyList.data.history) {
      for (const event of historyList.data.history) {
        if (event.messagesAdded) {
          event.messagesAdded.forEach((m) => changedMessageIds.add(m.message.id));
        }
        if (event.messagesDeleted) {
          event.messagesDeleted.forEach((m) => {
            db.prepare('DELETE FROM message_metadata WHERE user_email = ? AND message_id = ?').run(
              userEmail,
              m.message.id
            );
          });
        }
        if (event.labelsAdded || event.labelsRemoved) {
          event.labelsAdded?.forEach((m) => changedMessageIds.add(m.message.id));
          event.labelsRemoved?.forEach((m) => changedMessageIds.add(m.message.id));
        }
      }
    }

    // Update historyId for next sync
    if (historyList.data.historyId) {
      db.prepare('UPDATE sync_state SET history_id = ? WHERE user_email = ?').run(
        historyList.data.historyId,
        userEmail
      );
    }

    return Array.from(changedMessageIds);
  } catch (error) {
    if (error.code === 404 || error.message.includes('notFound')) {
      console.log('[Sync] HistoryId invalid, performing full sync');
      return fetchFullMetadata(gmail, userEmail, db, 40000);
    }
    throw error;
  }
}

async function fetchFullMetadata(gmail, userEmail, db, limit) {
  console.log(`[Sync] Fetching full metadata, limit: ${limit}`);

  const messageIds = [];
  let pageToken = null;
  let totalFetched = 0;

  while (totalFetched < limit) {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: Math.min(PAGE_TOKEN_LIMIT, limit - totalFetched),
      pageToken,
      fields: 'messages(id),nextPageToken,resultSizeEstimate',
    });

    if (!listRes.data.messages) {
      break;
    }

    messageIds.push(...listRes.data.messages.map((m) => m.id));
    totalFetched += listRes.data.messages.length;

    if (!listRes.data.nextPageToken) {
      break;
    }

    pageToken = listRes.data.nextPageToken;
  }

  // Store latest historyId
  const profileRes = await gmail.users.getProfile({ userId: 'me', fields: 'historyId' });
  if (profileRes.data.historyId) {
    const syncState = db.prepare('SELECT * FROM sync_state WHERE user_email = ?').get(userEmail);
    if (syncState) {
      db.prepare('UPDATE sync_state SET history_id = ? WHERE user_email = ?').run(
        profileRes.data.historyId,
        userEmail
      );
    } else {
      db.prepare(
        'INSERT INTO sync_state (user_email, history_id) VALUES (?, ?)'
      ).run(userEmail, profileRes.data.historyId);
    }
  }

  return messageIds;
}

async function fetchMessageMetadataInBatches(gmail, userEmail, messageIds) {
  const db = getDatabase();

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, Math.min(i + BATCH_SIZE, messageIds.length));

    const results = await gmail.users.messages.batchGet({
      userId: 'me',
      ids: batch,
      fields:
        'messages(id,threadId,labelIds,payload/headers,internalDateMs,sizeEstimate,snippet)',
    });

    let retries = 0;
    while (retries < 3) {
      try {
        const insertStmt = db.prepare(
          `INSERT OR REPLACE INTO message_metadata 
           (id, user_email, message_id, thread_id, from_addr, to_addr, subject, snippet, 
            internal_date_ms, size_estimate, label_ids, is_unread, is_starred, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        );

        const transaction = db.transaction(() => {
          for (const msg of results.data.messages || []) {
            const headers = msg.payload?.headers || [];
            const fromHeader = headers.find((h) => h.name === 'From') || {};
            const toHeader = headers.find((h) => h.name === 'To') || {};
            const subjectHeader = headers.find((h) => h.name === 'Subject') || {};

            const labelIds = msg.labelIds ? msg.labelIds.join(',') : '';
            const isUnread = msg.labelIds?.includes('UNREAD') ? 1 : 0;
            const isStarred = msg.labelIds?.includes('STARRED') ? 1 : 0;

            insertStmt.run(
              `msg_${userEmail}_${msg.id}`,
              userEmail,
              msg.id,
              msg.threadId,
              fromHeader.value || '',
              toHeader.value || '',
              subjectHeader.value || '',
              msg.snippet || '',
              msg.internalDateMs || 0,
              msg.sizeEstimate || 0,
              labelIds,
              isUnread,
              isStarred
            );
          }
        });

        transaction();
        break;
      } catch (error) {
        if (
          error.code === 'SQLITE_BUSY' ||
          error.message.includes('database is locked')
        ) {
          retries++;
          console.log(`[Sync] Database busy, retry ${retries}/3`);
          await new Promise((resolve) => setTimeout(resolve, 100 * retries));
        } else {
          throw error;
        }
      }
    }
  }
}

export async function clearMetadataCache(userEmail) {
  const db = getDatabase();
  db.prepare('DELETE FROM message_metadata WHERE user_email = ?').run(userEmail);
  db.prepare('DELETE FROM sync_state WHERE user_email = ?').run(userEmail);
  console.log(`[Sync] Cleared cache for ${userEmail}`);
}

export function getMessageMetadata(userEmail, limit = 1000) {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, message_id, thread_id, from_addr, to_addr, subject, 
              snippet, internal_date_ms, size_estimate, label_ids, is_unread, is_starred
       FROM message_metadata WHERE user_email = ? 
       ORDER BY internal_date_ms DESC LIMIT ?`
    )
    .all(userEmail, limit);
}
