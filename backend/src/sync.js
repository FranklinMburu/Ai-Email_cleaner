import { getGmailClient, validateTokenValidity } from './oauth.js';
import { getDatabase } from './database.js';

const BATCH_SIZE = 100;
const PAGE_TOKEN_LIMIT = 500;

export async function syncMetadata(userEmail, options = {}) {
  const { mode = 'incremental', limit = 40000 } = options;

  console.log(`[Sync] Starting ${mode} sync for ${userEmail}...`);

  const db = getDatabase();
  
  // Validate token before attempting any sync
  const tokenValidity = validateTokenValidity(userEmail);
  if (!tokenValidity.isValid) {
    console.warn(`[Sync] Pre-sync validation: ${tokenValidity.message}`);
  }

  let gmail;
  try {
    gmail = await getGmailClient(userEmail);
    console.log(`[Sync] Gmail client ready for ${userEmail}`);
  } catch (authError) {
    console.error(`[Sync] Authentication failed for ${userEmail}:`, authError.message);
    throw authError;
  }

  try {
    let messageIds = [];

    if (mode === 'incremental') {
      console.log(`[Sync] Attempting incremental sync for ${userEmail}`);
      messageIds = await fetchIncrementalChanges(gmail, userEmail, db);
    } else {
      console.log(`[Sync] Attempting full sync for ${userEmail}`);
      messageIds = await fetchFullMetadata(gmail, userEmail, db, limit);
    }

    console.log(`[Sync] Got ${messageIds.length} message IDs to fetch for ${userEmail}`);

    // Fetch detailed metadata for batches
    console.log(`[Sync] Starting metadata fetch for ${messageIds.length} messages...`);
    const insertedCount = await fetchMessageMetadataInBatches(gmail, userEmail, messageIds);
    console.log(`[Sync] Metadata fetch completed - inserted ${insertedCount} messages`);

    // Only update sync state AFTER successful metadata persistence
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

    console.log(`[Sync] Complete for ${userEmail}. Total messages in DB after sync: ${count}`);
    return { status: 'completed', messageCount: count };
  } catch (error) {
    console.error('[Sync] Sync failed for', userEmail, ':', error.message);
    throw error;
  }
}

async function fetchIncrementalChanges(gmail, userEmail, db) {
  const syncState = db.prepare('SELECT * FROM sync_state WHERE user_email = ?').get(userEmail);

  if (!syncState || !syncState.history_id) {
    console.log(`[Sync] No previous sync state for ${userEmail}, falling back to full sync`);
    return fetchFullMetadata(gmail, userEmail, db, 40000);
  }

  try {
    const historyId = syncState.history_id;
    console.log(`[Sync.incremental] Using historyId: ${historyId} for ${userEmail}`);

    const historyList = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      fields: 'history(messagesAdded,messagesDeleted,labelsAdded,labelsRemoved),historyId',
    });

    console.log(`[Sync.incremental] History API returned ${historyList.data.history ? historyList.data.history.length : 0} history events`);

    const changedMessageIds = new Set();

    if (historyList.data.history) {
      for (const event of historyList.data.history) {
        if (event.messagesAdded) {
          console.log(`[Sync.incremental] Found ${event.messagesAdded.length} messagesAdded`);
          event.messagesAdded.forEach((m) => changedMessageIds.add(m.message.id));
        }
        if (event.messagesDeleted) {
          console.log(`[Sync.incremental] Found ${event.messagesDeleted.length} messagesDeleted`);
          event.messagesDeleted.forEach((m) => {
            db.prepare('DELETE FROM message_metadata WHERE user_email = ? AND message_id = ?').run(
              userEmail,
              m.message.id
            );
          });
        }
        if (event.labelsAdded || event.labelsRemoved) {
          const addedCount = event.labelsAdded?.length || 0;
          const removedCount = event.labelsRemoved?.length || 0;
          console.log(`[Sync.incremental] Found ${addedCount} labelsAdded, ${removedCount} labelsRemoved`);
          event.labelsAdded?.forEach((m) => changedMessageIds.add(m.message.id));
          event.labelsRemoved?.forEach((m) => changedMessageIds.add(m.message.id));
        }
      }
    } else {
      console.log(`[Sync.incremental] No history array in response`);
    }

    // Update historyId for next sync
    if (historyList.data.historyId) {
      db.prepare('UPDATE sync_state SET history_id = ? WHERE user_email = ?').run(
        historyList.data.historyId,
        userEmail
      );
      console.log(`[Sync.incremental] Updated historyId to ${historyList.data.historyId}`);
    }

    console.log(`[Sync.incremental] Returning ${changedMessageIds.size} changed message IDs`);
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
  console.log(`[Sync.full] Fetching full metadata, limit: ${limit}`);

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

    console.log(`[Sync.full] Page request returned ${listRes.data.messages ? listRes.data.messages.length : 0} message IDs`);

    if (!listRes.data.messages) {
      console.log(`[Sync.full] No messages in response, breaking`);
      break;
    }

    messageIds.push(...listRes.data.messages.map((m) => m.id));
    totalFetched += listRes.data.messages.length;

    console.log(`[Sync.full] Total fetched so far: ${totalFetched}`);

    if (!listRes.data.nextPageToken) {
      console.log(`[Sync.full] No nextPageToken, done paginating`);
      break;
    }

    pageToken = listRes.data.nextPageToken;
  }

  console.log(`[Sync.full] Total message IDs collected: ${messageIds.length}`);

  // Store latest historyId
  const profileRes = await gmail.users.getProfile({ userId: 'me', fields: 'historyId' });
  console.log(`[Sync.full] Got profile with historyId: ${profileRes.data.historyId}`);
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
  let totalInserted = 0;

  console.log(`[Sync.metadata] Starting to fetch metadata for ${messageIds.length} messages in batches of ${BATCH_SIZE}`);

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, Math.min(i + BATCH_SIZE, messageIds.length));
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[Sync.metadata] Batch ${batchNum}: fetching ${batch.length} messages`);

    const results = await gmail.users.messages.batchGet({
      userId: 'me',
      ids: batch,
      fields:
        'messages(id,threadId,labelIds,payload/headers,internalDateMs,sizeEstimate,snippet)',
    });

    console.log(`[Sync.metadata] Batch ${batchNum} response has ${results.data.messages ? results.data.messages.length : 0} messages`);

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
          let insertCount = 0;
          if (!results.data.messages) {
            console.log(`[Sync.metadata] Batch ${batchNum}: no messages to insert`);
            return 0;
          }
          for (const msg of results.data.messages) {
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
            insertCount++;
          }
          return insertCount;
        });

        const inserted = transaction();
        totalInserted += inserted;
        console.log(`[Sync.metadata] Batch ${batchNum} inserted ${inserted} messages (total so far: ${totalInserted})`);
        break;
      } catch (error) {
        if (
          error.code === 'SQLITE_BUSY' ||
          error.message.includes('database is locked')
        ) {
          retries++;
          console.log(`[Sync.metadata] Database busy, retry ${retries}/3`);
          await new Promise((resolve) => setTimeout(resolve, 100 * retries));
        } else {
          throw error;
        }
      }
    }
  }

  console.log(`[Sync.metadata] Batch insert complete - total inserted: ${totalInserted}`);
  return totalInserted;
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
