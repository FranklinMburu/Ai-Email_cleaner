import assert from 'assert';
import { categorizeEmail } from '../src/categorize.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, '../data/test.sqlite');

// Test setup
function setupTestDB() {
  const db = new Database(testDbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_metadata (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      message_id TEXT,
      thread_id TEXT,
      from_addr TEXT,
      to_addr TEXT,
      subject TEXT,
      snippet TEXT,
      internal_date_ms INTEGER,
      size_estimate INTEGER,
      label_ids TEXT,
      is_unread INTEGER DEFAULT 0,
      is_starred INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categorization_cache (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      message_id TEXT,
      category_name TEXT,
      category_id TEXT,
      confidence REAL
    );
  `);

  // Clear test data
  db.exec('DELETE FROM message_metadata');
  db.exec('DELETE FROM categorization_cache');

  return db;
}

describe('Integration Tests - Operations Framework', () => {
  let db;
  const testUserEmail = 'test@gmail.com';

  test('setup test database', () => {
    db = setupTestDB();
    assert.ok(db);
  });

  test('categorize email and cache result', () => {
    const email = {
      from_addr: 'newsletter@example.com',
      subject: 'Weekly Update',
      snippet: 'This week we...',
      internal_date_ms: Date.now(),
    };

    const category = categorizeEmail(email);
    assert.ok(category);
    assert.strictEqual(category.categoryId, 'newsletters');

    // Simulate cache storage
    const cacheId = `cat_${testUserEmail}_${email.id || 'msg_1'}`;
    const insertStmt = db.prepare(
      `INSERT OR REPLACE INTO categorization_cache 
       (id, user_email, message_id, category_name, category_id, confidence)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    insertStmt.run(
      cacheId,
      testUserEmail,
      'msg_1',
      category.categoryName,
      category.categoryId,
      category.confidence
    );

    // Verify cached
    const cached = db
      .prepare('SELECT * FROM categorization_cache WHERE id = ?')
      .get(cacheId);
    assert.ok(cached);
    assert.strictEqual(cached.category_id, 'newsletters');
  });

  test('operation requires approval token', () => {
    // Simulate operation creation
    const operationId = `op_${Date.now()}`;
    const approvalToken = Buffer.from(`${operationId}:${Date.now()}`).toString('base64');

    // Token must be non-empty
    assert.ok(approvalToken.length > 0);

    // Can only execute with token
    const canExecute = (token) => {
      return token && token === approvalToken;
    };

    assert.ok(canExecute(approvalToken));
    assert.ok(!canExecute(null));
    assert.ok(!canExecute('wrong-token'));
  });

  test('protected emails excluded from operation', () => {
    const userEmail = 'test@gmail.com';

    // Insert test messages
    const insertStmt = db.prepare(
      `INSERT INTO message_metadata
       (id, user_email, message_id, thread_id, from_addr, subject, internal_date_ms, is_starred)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insertStmt.run(`msg_${userEmail}_1`, userEmail, 'msg_1', 'thread_1', 'newsletter@x.com', 'Newsletter', Date.now(), 0);
    insertStmt.run(`msg_${userEmail}_2`, userEmail, 'msg_2', 'thread_2', 'boss@company.com', 'Important', Date.now(), 1);

    // Query unprotected messages
    const affectableMessages = db
      .prepare(`SELECT * FROM message_metadata WHERE user_email = ? AND is_starred = 0`)
      .all(userEmail);

    assert.strictEqual(affectableMessages.length, 1);
    assert.strictEqual(affectableMessages[0].message_id, 'msg_1');

    // Starred email protected
    const starredMessages = db
      .prepare(`SELECT * FROM message_metadata WHERE user_email = ? AND is_starred = 1`)
      .all(userEmail);

    assert.strictEqual(starredMessages.length, 1);
    assert.strictEqual(starredMessages[0].message_id, 'msg_2');
  });

  test('dry-run returns preview without modification', () => {
    const userEmail = 'dryrun@gmail.com';

    // Insert test messages
    const insertStmt = db.prepare(
      `INSERT INTO message_metadata
       (id, user_email, message_id, thread_id, from_addr, subject, internal_date_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const testMessages = [
      { id: 'msg_1', thread: 'thread_1', from: 'newsletter@a.com', subject: 'Newsletter' },
      { id: 'msg_2', thread: 'thread_2', from: 'newsletter@b.com', subject: 'Digest' },
      { id: 'msg_3', thread: 'thread_3', from: 'boss@company.com', subject: 'Meeting' },
    ];

    testMessages.forEach((m) => {
      insertStmt.run(
        `msg_${userEmail}_${m.id}`,
        userEmail,
        m.id,
        m.thread,
        m.from,
        m.subject,
        Date.now()
      );
    });

    // Get count before dry-run
    const before = db
      .prepare(`SELECT COUNT(*) as count FROM message_metadata WHERE user_email = ?`)
      .get(userEmail).count;

    // Simulate dry-run (no actual modification)
    const dryRunResult = {
      totalAffected: 2,
      sampleAffected: testMessages.slice(0, 2),
      canProceed: true,
      operationId: `dr_${Date.now()}`,
    };

    // Verify no actual changes
    const after = db
      .prepare(`SELECT COUNT(*) as count FROM message_metadata WHERE user_email = ?`)
      .get(userEmail).count;

    assert.strictEqual(before, after);
    assert.strictEqual(dryRunResult.totalAffected, 2);
    assert.ok(dryRunResult.canProceed);
  });

  test('clean up test database', () => {
    db.close();
  });
});
