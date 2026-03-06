import assert from 'assert';
import { categorizeEmail } from '../src/categorize.js';

describe('Categorization Engine', () => {
  test('identifies newsletters', () => {
    const email = {
      from_addr: 'newsletter@example.com',
      subject: 'Weekly Newsletter',
      snippet: 'This week...',
      internal_date_ms: Date.now(),
    };

    const result = categorizeEmail(email);
    assert.strictEqual(result.categoryId, 'newsletters');
    assert(result.confidence > 0.5);
  });

  test('identifies notifications', () => {
    const email = {
      from_addr: 'notification@social.com',
      subject: 'You have a new comment',
      snippet: 'Someone commented on your post',
      internal_date_ms: Date.now(),
    };

    const result = categorizeEmail(email);
    assert.strictEqual(result.categoryId, 'notifications');
  });

  test('identifies promotions', () => {
    const email = {
      from_addr: 'noreply@store.com',
      subject: '50% OFF SALE',
      snippet: 'Limited time offer',
      internal_date_ms: Date.now(),
    };

    const result = categorizeEmail(email);
    assert.strictEqual(result.categoryId, 'promotions');
  });

  test('identifies receipts', () => {
    const email = {
      from_addr: 'order@amazon.com',
      subject: 'Your order confirmation',
      snippet: 'Order #12345',
      internal_date_ms: Date.now(),
    };

    const result = categorizeEmail(email);
    assert.strictEqual(result.categoryId, 'receipts');
  });

  test('identifies old emails', () => {
    const threeYearsAgo = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;
    const email = {
      from_addr: 'anyone@example.com',
      subject: 'Old email',
      snippet: 'content',
      internal_date_ms: threeYearsAgo,
    };

    const result = categorizeEmail(email);
    assert.strictEqual(result.categoryId, 'old_emails');
    assert(result.confidence > 0.8);
  });

  test('returns null for uncategorized email', () => {
    const email = {
      from_addr: 'boss@company.com',
      subject: 'Re: Important Project',
      snippet: 'Let me know what you think',
      internal_date_ms: Date.now(),
    };

    const result = categorizeEmail(email);
    assert.strictEqual(result, null);
  });

  test('handles missing fields gracefully', () => {
    const email = {
      from_addr: undefined,
      subject: undefined,
      snippet: undefined,
      internal_date_ms: Date.now(),
    };

    // Should not crash
    const result = categorizeEmail(email);
    assert(result === null || result.categoryId);
  });
});
