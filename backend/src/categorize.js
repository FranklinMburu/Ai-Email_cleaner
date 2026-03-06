import { getDatabase } from './database.js';

// Rule-based categorizer
const RULES = [
  {
    id: 'newsletters',
    name: 'Newsletters & Subscriptions',
    rules: [
      (email) => email.from_addr?.includes('newsletter') || email.from_addr?.includes('digest'),
      (email) =>
        email.subject?.toLowerCase().includes('newsletter') ||
        email.subject?.toLowerCase().includes('digest'),
      (email) => email.from_addr?.includes('noreply') && email.snippet?.length < 150,
    ],
    confidence: 0.85,
    suggestedAction: 'archive',
  },
  {
    id: 'notifications',
    name: 'Social & App Notifications',
    rules: [
      (email) =>
        email.from_addr?.includes('notification') ||
        email.from_addr?.includes('noreply+') ||
        email.from_addr?.includes('notifications@'),
      (email) =>
        email.subject?.toLowerCase().includes('comment') ||
        email.subject?.toLowerCase().includes('like') ||
        email.subject?.toLowerCase().includes('follow'),
    ],
    confidence: 0.80,
    suggestedAction: 'archive',
  },
  {
    id: 'promotions',
    name: 'Promotional Emails',
    rules: [
      (email) =>
        email.subject?.toLowerCase().includes('sale') ||
        email.subject?.toLowerCase().includes('discount') ||
        email.subject?.toLowerCase().includes('offer'),
      (email) => email.from_addr?.includes('promo') || email.from_addr?.includes('marketing'),
      (email) => email.subject?.includes('OFF') || email.subject?.includes('LIMITED'),
    ],
    confidence: 0.75,
    suggestedAction: 'archive',
  },
  {
    id: 'receipts',
    name: 'Receipts & Transactions',
    rules: [
      (email) =>
        email.subject?.toLowerCase().includes('receipt') ||
        email.subject?.toLowerCase().includes('order') ||
        email.subject?.toLowerCase().includes('confirmation') ||
        email.subject?.toLowerCase().includes('invoice'),
      (email) =>
        email.from_addr?.includes('amazon') ||
        email.from_addr?.includes('ebay') ||
        email.from_addr?.includes('order@') ||
        email.from_addr?.includes('no-reply@'),
    ],
    confidence: 0.85,
    suggestedAction: 'label',
    label: 'Receipts Archive',
  },
  {
    id: 'old_emails',
    name: 'Old Emails (>2 years)',
    rules: [
      (email) => {
        const twoYearsAgo = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
        return email.internal_date_ms && email.internal_date_ms < twoYearsAgo;
      },
    ],
    confidence: 0.90,
    suggestedAction: 'archive',
  },
];

export function categorizeEmail(email) {
  const results = [];

  for (const rule of RULES) {
    const matchCount = rule.rules.filter((r) => {
      try {
        return r(email);
      } catch {
        return false;
      }
    }).length;

    if (matchCount > 0) {
      const confidence = Math.min(0.95, rule.confidence * (matchCount / rule.rules.length));
      results.push({
        categoryId: rule.id,
        categoryName: rule.name,
        confidence: Math.round(confidence * 100) / 100,
        suggestedAction: rule.suggestedAction,
        label: rule.label,
      });
    }
  }

  // Return highest confidence match or null
  return results.length > 0
    ? results.reduce((best, curr) => (curr.confidence > best.confidence ? curr : best))
    : null;
}

export function generateRecommendations(userEmail) {
  const db = getDatabase();

  // Get all message metadata
  const messages = db
    .prepare('SELECT * FROM message_metadata WHERE user_email = ?')
    .all(userEmail);

  console.log(`[Categorize] Processing ${messages.length} messages for ${userEmail}`);

  const recommendations = new Map();

  const results = [];
  for (const msg of messages) {
    const cat = categorizeEmail(msg);
    if (cat) {
      results.push({
        messageId: msg.message_id,
        category: cat,
      });
    }
  }

  // Group by category
  for (const result of results) {
    const catId = result.category.categoryId;
    if (!recommendations.has(catId)) {
      recommendations.set(catId, {
        categoryId: catId,
        name: result.category.categoryName,
        count: 0,
        confidence: result.category.confidence,
        suggestedAction: result.category.suggestedAction,
        label: result.category.label,
        samples: [],
        senders: new Map(),
      });
    }

    const rec = recommendations.get(catId);
    rec.count++;

    // Track sample emails and sender domains (first 5)
    const msg = messages.find((m) => m.message_id === result.messageId);
    if (msg) {
      if (rec.samples.length < 5) {
        rec.samples.push({
          id: msg.message_id,
          subject: msg.subject || '(no subject)',
          from: msg.from_addr || '(unknown)',
          date: msg.internal_date_ms,
        });
      }

      // Track sender domains
      const senderDomain = new URL(`http://${msg.from_addr.split('@')[1] || 'unknown'}`).hostname;
      rec.senders.set(
        senderDomain,
        (rec.senders.get(senderDomain) || 0) + 1
      );
    }
  }

  // Convert to array and calculate risk
  const recs = Array.from(recommendations.values()).map((rec) => ({
    categoryId: rec.categoryId,
    name: rec.name,
    count: rec.count,
    confidence: rec.confidence,
    suggestedAction: rec.suggestedAction,
    label: rec.label,
    samples: rec.samples,
    topSenders: Array.from(rec.senders.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count })),
    riskLevel: rec.confidence > 0.85 ? 'low' : rec.confidence > 0.75 ? 'medium' : 'high',
  }));

  // Check for protected emails
  const protectedCount = db
    .prepare(
      `SELECT COUNT(*) as count FROM message_metadata 
       WHERE user_email = ? AND (is_starred = 1 OR label_ids LIKE '%IMPORTANT%')`
    )
    .get(userEmail).count;

  const recommendationReport = {
    timestamp: new Date().toISOString(),
    recommendationId: `rec_${Date.now()}`,
    totalMessages: messages.length,
    protectedMessages: protectedCount,
    categories: recs.sort((a, b) => b.count - a.count),
    totalRecommendedForAction: recs.reduce((sum, r) => sum + r.count, 0),
  };

  return recommendationReport;
}

export function saveCategorizationCache(userEmail, messageId, category) {
  const db = getDatabase();
  const cacheId = `cat_${userEmail}_${messageId}`;

  db.prepare(
    `INSERT OR REPLACE INTO categorization_cache 
     (id, user_email, message_id, category_name, category_id, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    cacheId,
    userEmail,
    messageId,
    category.categoryName,
    category.categoryId,
    category.confidence
  );
}
