# Gmail Inbox Cleanup Tool — Design Document

**Version:** 1.0  
**Date:** March 2026  
**Status:** Design Phase  
**Scope:** Minimal, safe, human-controlled AI-assisted organization of Gmail inboxes with 40,000+ emails

---

## 1. Goals

### Primary Goals
- **Safe Analysis**: Fetch and categorize 40,000+ emails using metadata-first analysis without placing burden on user to understand risks.
- **Clear Recommendations**: Present actionable categorization with evidence, counts, confidence scores, and examples so users can make informed decisions.
- **Human-Controlled Execution**: Every destructive or organizational action (archive, label, trash, delete) requires explicit user approval on a per-operation basis.
- **Full Auditability**: Maintain immutable operation logs so users can trace what happened, when, and why; support reversibility where possible.
- **Incremental Safety**: Provide dry-run previews for all operations, and execute only small, reversible batches to prevent catastrophic mistakes.

### Success Criteria
1. User can connect Gmail account via OAuth with minimal permissions.
2. Metadata sync completes for 40k+ emails in reasonable time (~5–30 minutes depending on API rate limits).
3. AI categorization groups emails into understandable buckets (e.g., Newsletters, Old Transactions, Social Media, Promotions) with confidence scores.
4. User sees a recommendation report *before* any action is triggered.
5. Dry-run mode shows exact counts and sample message IDs/subjects without modifying Gmail.
6. User can approve and execute operations; each operation is logged with input state, action, result, and rollback path.
7. No email is deleted, archived, or labeled without explicit user click on a specific operation.

---

## 2. Non-Goals

- **Automatic Destructive Actions**: No auto-delete, auto-archive, or auto-label that runs in the background without user approval.
- **Default Full Content Access**: Do not read full email bodies unless user explicitly enables and confirms "deep analysis mode."
- **Unilateral Label/Category Ownership**: Do not assume ownership of user-created labels or interfere with user's manual organization.
- **Multi-Account or Team Features**: Single user, single account per session.
- **Real-Time Sync or Push Notifications**: Fetch metadata on-demand; no background polling or notifications.
- **Complex Machine Learning Models**: Metadata-first heuristics and optional light rule-based content sampling; no heavy ML training.
- **Offline Operation**: Always require authenticated Gmail API connection; no synced offline copies.
- **Third-Party Integrations**: No pluggable filters, webhooks, or external services; standalone tool.

---

## 3. System Boundaries & Data Flow

### High-Level Flow

```
┌─────────────────┐
│   User Browser  │
└────────┬────────┘
         │ (OAuth Consent)
         ▼
┌─────────────────────────────────────────┐
│   Gmail OAuth OAuth2 Flow               │
│   - User grants permission              │
│   - Receive refresh + access token      │
└────┬────────────────────────────────────┘
     │ (Encrypted Token)
     ▼
┌──────────────────────────────────────────────────┐
│   Backend Service (Node.js)                      │
│  ┌────────────────────────────────────┐          │
│  │ OAuth Token Mgmt (refresh, store)  │          │
│  └────────────────────────────────────┘          │
│  ┌────────────────────────────────────┐          │
│  │ Gmail API Client                   │          │
│  │ (fetch metadata, apply labels,     │          │
│  │  move to trash, archive)           │          │
│  └────────────────────────────────────┘          │
│  ┌────────────────────────────────────┐          │
│  │ Categorization Engine (AI)         │          │
│  │ (rules, heuristics, optional       │          │
│  │  content sampling)                 │          │
│  └────────────────────────────────────┘          │
│  ┌────────────────────────────────────┐          │
│  │ Operation Planner & Executor       │          │
│  │ (dry-run, batch execute, retry)    │          │
│  └────────────────────────────────────┘          │
│  ┌────────────────────────────────────┐          │
│  │ Audit Logger                       │          │
│  │ (immutable operation log)          │          │
│  └────────────────────────────────────┘          │
└──┬───────────────────────────────────────────────┘
   │ (JSON API)
   ▼
┌──────────────────────────────────────┐
│   SQLite Database (Local)            │
│  ┌──────────────────────────────────┐│
│  │ Cached Message Metadata          ││
│  │ (id, labels, from, subject, etc) ││
│  └──────────────────────────────────┘│
│  ┌──────────────────────────────────┐│
│  │ Encrypted Token Store            ││
│  │ (refresh_token, expiry)          ││
│  └──────────────────────────────────┘│
│  ┌──────────────────────────────────┐│
│  │ Operation Audit Log              ││
│  │ (immutable records of actions)   ││
│  └──────────────────────────────────┘│
│  ┌──────────────────────────────────┐│
│  │ Categorization Cache             ││
│  │ (message → category mapping)     ││
│  └──────────────────────────────────┘│
└──────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────┐
│   Frontend (React)          │
│  ┌──────────────────────┐   │
│  │ Inbox Overview       │   │
│  │ (category breakdown) │   │
│  └──────────────────────┘   │
│  ┌──────────────────────┐   │
│  │ Recommendation View  │   │
│  │ (what to clean)      │   │
│  └──────────────────────┘   │
│  ┌──────────────────────┐   │
│  │ Action Composer      │   │
│  │ (dry-run, confirm)   │   │
│  └──────────────────────┘   │
│  ┌──────────────────────┐   │
│  │ Execution Log        │   │
│  │ (what happened)      │   │
│  └──────────────────────┘   │
└─────────────────────────────┘
```

### Data Residency

| Data | Storage | Encryption | Lifetime |
|------|---------|-----------|----------|
| OAuth Refresh Token | Local SQLite | AES-256 at rest | Duration of user session (can be revoked) |
| OAuth Access Token | Memory (backend) | TLS in transit | Duration of token (~1 hour) |
| Message Metadata | Local SQLite | At rest (depends on DB encryption policy) | User's choice (can be cleared) |
| Full Email Body | Never stored | N/A | Transient (fetched only if deep analysis enabled) |
| Categorization Results | Local SQLite | Cached mapping | Incremental (updated on sync) |
| Audit Log | Local SQLite | Immutable records | Permanent (user can export/delete) |
| Temporary Operation Batch | Memory | TLS in transit | During operation execution only |

### Transient vs. Persistent

- **Transient**: Access tokens, operation batches in flight, HTTP request bodies
- **Persistent**: Refresh tokens (encrypted), message metadata (cache for incremental sync), operation audit log, categorization cache
- **User-Controlled**: User decides to keep or clear metadata cache; local storage is under user's control

---

## 4. Gmail Data Model & Gmail API Usage Plan

### Message Metadata Fields (Fetched)
Per message, we fetch and cache:
- `id` (unique message identifier)
- `threadId` (to group conversations)
- `labelIds` (system labels: INBOX, SENT, DRAFT, TRASH, STARRED, IMPORTANT, etc., plus user-created labels)
- `from` (sender address — parsed domain for heuristics)
- `to` (recipient address)
- `subject` (subject line for keyword analysis)
- `snippet` (first ~100 characters of body, provided by Gmail API, not full body)
- `internalDate` (milliseconds since epoch — age-based heuristics)
- `sizeEstimate` (size in bytes — ignore if zero)
- `headers` (List-Unsubscribe, X-Mailer, Received, etc., for detecting newsletters and automation)

**Full body fetched only if**:
- User explicitly enables "Deep Analysis Mode" (opt-in)
- Only a sample subset of emails (user-configurable; default 10–20 emails per category)
- Results logged and reasons documented

### Pagination & Incremental Sync

**Initial Sync**:
1. Call `users/me/messages/list` with `maxResults=500` (Gmail default), iterate with `pageToken` until all messages fetched.
2. For each page, store messageIds and fetch full metadata in batches of 100 using `users/me/messages/get`.
3. Cache all metadata in SQLite with sync timestamp.

**Incremental Sync**:
1. Store `latest_history_id` from previous sync.
2. Use `users/me/history/list` with `startHistoryId` to fetch *only* changed messages (new, deleted labels, moved to trash, etc.).
3. Update cache: delete removed messages, update changed messages, add new messages.
4. Fall back to full sync if history ID is invalid (stale date or corrupted).

**Estimated Load**:
- 40,000 messages, 5 bytes per message ID, ~200 KB initial ID list
- 40,000 metadata calls at ~500 bytes each = ~20 MB storage (uncompressed)
- With incremental deltas: most syncs ~1–5 MB

### Rate Limit & Backoff Strategy

Gmail API quotas:
- Per user: 15 billion requests per day (per API console project quota)
- Per second: ~1 QPS for list/search, ~10 QPS for batch get (theoretical limits vary)

**Strategy**:
1. Batch `get` requests: up to 100 message IDs per batch request.
2. Implement exponential backoff: start with 1s, double up to max 64s, then fail.
3. Respect `X-RateLimit-*` headers in responses.
4. Log rate limit events; if user hits limits, inform them and recommend waiting.
5. Never retry destructive operations (delete, trash) without explicit user approval.

### Threads vs. Single Messages

**Philosophy**: Organize at the *message* level, but provide *thread* context.

- Cache both message and thread metadata.
- When presenting recommendations, group by thread (conversation) for readability.
- When executing batch operations, user sees "Archive this thread (5 messages)" vs. individual message actions.
- Dry-run shows thread summary + affected message count.

### Label/Archive/Trash Semantics in Gmail

| Action | Gmail Mechanism | Reversible | Notes |
|--------|-----------------|-----------|-------|
| Archive | Remove INBOX label | Yes | Move to All Mail; no special label. User can search and restore. |
| Create/Apply Label | Add labelId | Yes | Multiple labels per message allowed. |
| Move to Trash | Add TRASH label | Yes | Trash retained for 30 days; can restore. |
| Permanent Delete | `messages/delete` REST API | No | Cannot recover after 30s or so. Logs required. |
| Mark as Read | Modify `UNREAD` label | Yes | Standard workflow. |

**Tool Policy**:
- Prefer **Archive** over Delete for bulk operations.
- Prefer **Create + Label** over Delete for unimportant categories (e.g., "Promotions Archive", "Old Receipts").
- **Trash** available but requires secondary confirmation.
- **Permanent Delete** disabled by default; only available if user explicitly checks "Allow Permanent Delete" and approves a second time.

---

## 5. Safety Rails (Invariants)

### Invariant 1: No Destructive Action Without Explicit User Click
- Every operation must map to a button or explicit checkbox on the frontend.
- No automatic actions triggered by cron, timer, or background job.
- Even if user configures a rule (e.g., "Always archive emails from X"), each execution requires a "Start Cleanup" button click.

### Invariant 2: Dry-Run Mode for All Operations
- Before executing, user sees a preview:
  - Count of affected emails
  - Sample message IDs and subjects (first 5–10)
  - Target action (Archive, Label, Trash, Delete)
  - Risk assessment (e.g., "5% of sampled emails are starred; do not archive starred emails")
- Dry run is non-destructive; user can cancel without side effects.

### Invariant 3: Immutable Audit Log
- Every operation (successful or failed) is recorded:
  - Timestamp
  - User ID (local session identifier)
  - Operation type (Archive, Label, Trash, Delete)
  - Target category/filter
  - Dry-run results (counts, samples)
  - Execution result (success, partial failure, total failure)
  - Message IDs affected
  - Rollback steps (if applicable)
- Logs stored in SQLite, never modified after creation.
- User can export logs as JSON for external audit.

### Invariant 4: Protected Categories Never Touched Without Override
**Protected Labels** (default):
- `STARRED`
- `IMPORTANT`
- User-defined labels tagged as "Protected" by user

**Rule**:
- Never apply Archive, Trash, or Delete to messages in protected labels.
- If an operation would affect protected emails, exclude them and warn user.
- User can override: "Include protected emails" checkbox; second confirmation required.

### Invariant 5: Reversibility Plan

**Prefer Reversible Actions**:
1. **Archive** (remove INBOX label, move to All Mail) — fully reversible by applying INBOX label
2. **Create Library Label** (e.g., "Promotions Archive") — fully reversible by removing label
3. **Move to Trash** (apply TRASH label) — reversible for 30 days
4. **Permanent Delete** (`messages/delete` API) — **NOT reversible**; disabled by default

**Rollback Support**:
- Archive operations: record the set of message IDs and label state; user can click "Undo" within 24 hours to restore to INBOX.
- Label operations: reverse by removing applied label.
- Trash: reverse by removing TRASH label.
- Delete: no rollback; log it clearly and require secondary confirmation.

### Invariant 6: AI Recommendations Are Non-Binding and Explainable
- AI produces a structured recommendation report, not an order.
- Each category includes:
  - Name (e.g., "Old Promotional Emails")
  - Count
  - Confidence score (0–100%)
  - Sample emails (3–5 subject lines)
  - Rules applied (e.g., "From domain: promo@\*, subject contains 'Sale'")
  - Risk level (Low, Medium, High) based on recency, starred/important ratio, etc.
- User can:
  - Adjust category membership (add/remove rules before executing)
  - Decline a category entirely
  - Create custom categories via the UI
- Explanation is logged for each applied recommendation.

---

## 6. AI Categorization Approach (Metadata-First)

### Phase 1: Metadata-Only Heuristics (Default)

**Rules Engine** (evaluated in order, first match wins or combines):

1. **Sender/Domain Rules**
   - Newsletter detection: `From` domain in known newsletter list (e.g., substack.com, mailchimp.com); OR `List-Unsubscribe` header present
   - Social media notifications: sender domain matches social platform list (e.g., notification@twitter.com, no-reply@facebook.com)
   - Marketing/Promotions: sender domain contains marketing keywords or known promo senders; subject contains sale/discount/offer keywords
   - System notifications: automated senders (e.g., noreply@, support+ticket@); detection via absence of human name in "From"

2. **Age-Based Rules**
   - Old (>2 years): category for archival
   - Very old (>5 years): category for potential deletion (with flagging)
   - Recent (< 1 week): protected from aggressive cleanup

3. **Label-Based Rules**
   - Already labeled by Gmail (e.g., Promotions, Marketing) — group by system label
   - User-created labels — group and ask user which to archive

4. **Content Pattern Rules** (from snippet + subject, no full body access):
   - Transaction receipts: subject contains "order", "receipt", "invoice", "confirmation"; sender from retail domain
   - Newsletters: subject contains "digest", "newsletter", "issue", "edition"; sender domain analysis
   - Social notifications: subject contains "comments", "likes", "followers", "messages"; sender domain
   - System/Admin: subject contains "failed delivery", "bounced", "undeliverable", "verify"; sender is mailer-daemon, postmaster, etc.
   - Bulk promotions: subject contains ALL CAPS text, multiple exclamation marks, or URL-heavy snippets

5. **Thread Metadata**
   - Single-message threads (not in conversation) — more likely promotional or automation
   - Multi-message threads — more likely human conversation; conservative categorization

**Output (Per Category)**:
```json
{
  "category_id": "old_promotions",
  "name": "Old Promotional Emails",
  "count": 2543,
  "confidence": 0.87,
  "risk_level": "low",
  "sample_emails": [
    { "id": "msg_123", "subject": "50% OFF - Don't Miss Out!", "from": "noreply@store.com", "date": "2023-05-15" },
    { "id": "msg_124", "subject": "Weekly Digest - May", "from": "newsletter@example.com", "date": "2023-05-16" }
  ],
  "rules_applied": [
    "sender_domain: 'noreply@store.com' (known promo domain)",
    "subject_keywords: ['OFF', 'discount']",
    "age: >18 months",
    "no_reply_received: true"
  ],
  "suggested_action": "archive",
  "rollback_steps": ["re-apply INBOX label"]
}
```

### Phase 2: Optional Content Sampling (Opt-In)

**User Action**: Click "Enable Deep Analysis" → Confirm privacy modal.

**Process**:
1. For each category (from Phase 1), sample up to 20 emails.
2. Fetch full body for sample only.
3. Apply NLP heuristics (not ML models):
   - Keyword frequency analysis
   - Templatized email detection (repeated structure = likely automation)
   - Personal name/relationship detection (Dear [Name] → likely important; generic greeting → likely bulk)
   - Sentiment/urgency scoring
   - Link extraction (mailto, payment, unsubscribe links)
4. Log all content access with timestamp, sample size, and result.
5. Display results with disclaimer: "These emails were analyzed to refine recommendations; content is not stored."
6. User can drill down on samples to review before approving operation.

**Privacy Control**:
- Deep analysis is per-session and optional.
- Raw email bodies are NOT logged or cached.
- Only aggregated signals (keyword counts, template match) stored.
- User can disable anytime; cached content sampling results discarded on next sync.

---

## 7. UI/UX Minimal Dashboard

### Layout & Navigation

```
┌──────────────────────────────────────────────────┐
│  Gmail Cleanup Tool                 [Disconnect] │
├──────────────────────────────────────────────────┤
│  Tabs:                                            │
│  [Overview] [Recommendations] [Actions] [Logs]   │
├──────────────────────────────────────────────────┤
│                                                  │
│  Content Area (tab-specific)                     │
│                                                  │
│                                                  │
└──────────────────────────────────────────────────┘
```

### View 1: Inbox Overview

**Purpose**: Show user current state and categorization breakdown.

**Content**:
- **Sync Status**: "Last synced: 2 hours ago" + "Sync Now" button
- **Message Count**: Total (40,000), By category breakdown (pie chart or table)
  - Inbox (2,000)
  - Promotions (5,000)
  - Old Newsletters (8,000)
  - Receipts & Transactions (3,000)
  - Social Media Notifications (2,000)
  - Other (20,000)
- **Quick Stats**:
  - Unread: 150
  - Starred: 25
  - Protected Labels: [Show count]
- **Actions**: 
  - "Sync Now" button (refresh metadata)
  - "Clear Local Cache" button (with confirmation)

**No destructive actions on this tab** — read-only overview.

### View 2: Recommendation Report

**Purpose**: Present AI categorization and allow user to tune before action.

**Content per Category Card**:
```
┌─────────────────────────────────────┐
│ [Category Name]                     │
│ Count: 2,543 emails                 │
│ Confidence: 87%                     │
│ Risk Level: [Low/Medium/High]       │
├─────────────────────────────────────┤
│ Suggested Action: Archive           │
├─────────────────────────────────────┤
│ Rules Applied:                      │
│ • Sender domain: noreply@*          │
│ • Subject keywords: ['OFF', ...]    │
│ • Age > 18 months                   │
├─────────────────────────────────────┤
│ Samples:                            │
│ 1. "50% OFF Sale" (noreply@...)     │
│ 2. "Weekly Digest" (news@...)       │
│ 3. ...                              │
├─────────────────────────────────────┤
│ [Edit Rules] [Exclude] [Approve]    │
└─────────────────────────────────────┘
```

**User Interactions**:
- **Edit Rules**: Open modal; add/remove conditions (simple AND/OR logic)
- **Exclude**: Remove category from cleanup; reason logged
- **Approve**: Mark ready for action composition
- **Deep Dive**: "Show more samples" → fetch and display additional topics + confidence

**Summary Footer**:
- "Total emails selected for action: 12,543 (31% of inbox)"
- "Estimated safe to archive: 12,000 (estimated risk: 0.5%)"
- "⚠ 135 protected emails will be skipped"

### View 3: Action Composer

**Purpose**: Build and dry-run an operation before execution.

**Workflow**:
1. **Select Categories**: Checkboxes for each approved category
2. **Choose Action**: Radio buttons
   - Archive (move to All Mail, remove INBOX)
   - Apply Label: Dropdown + create new label
   - Move to Trash
   - Permanent Delete (disabled unless user checks override + confirms)
3. **Batch Size**: Slider (default 500, max 5000 per batch)
   - Explanation: "Smaller batches reduce risk of rate limiting and allow easier rollback"
4. **Dry Run**: "Preview" button
   - Queries backend; shows:
     - Exact count
     - Sample message IDs/subjects (5–10)
     - Affected threads (count)
     - Risk checks (protected labels, recent emails, threads with unread messages)
     - Estimated time to execute
   - User can cancel or proceed
5. **Execute**: "Start Cleanup" button (only appears after dry run)
   - Requires explicit click
   - Backend begins batched execution
   - Progress bar shown; user can cancel (stops at current batch)
   - Results displayed when complete

**Safety Checks Displayed During Composition**:
- "⚠ This will affect 2,543 emails"
- "ℹ Protected emails will be excluded (135 starred emails, 10 custom labels)"
- "✓ All actions are reversible via Undo or Logs"

### View 4: Execution Log

**Purpose**: Show what was done, when, and prove immutability.

**Columns**:
| Time | Category | Action | Count | Status | Affected IDs | Rollback | View Details |
|------|----------|--------|-------|--------|--------------|----------|---|
| 2024-03-05 14:23 | Old Promotions | Archive | 2,543 | Success | [Sample Modal] | [Undo Available] | [JSON] |
| 2024-03-05 14:15 | Receipts | Label | 1,200 | Success | — | [Remove Label] | [JSON] |
| 2024-03-05 13:50 | Newsletters | Archive | 500 | Partial (Rate limited) | [Details] | [Retry] | [JSON] |

**Actions per Row**:
- **View Details**: JSON export of operation (input, output, errors)
- **Undo**: Reverse-apply previous operation (if reversible); requires 24-hour window for archive
- **Rollback**: Revert to pre-operation Gmail state (if backup available)

**Export**:
- "Export All Logs" → JSON file with complete audit trail
- Each log entry immutable; export signed hash (SHA-256) for trust

---

## 8. Operations API Contracts (Backend)

All endpoints return JSON. Errors include `error`, `message`, `request_id`.

### 1. OAuth Connect & Disconnect

#### POST /api/auth/connect
**Purpose**: Initiate OAuth flow.

**Request**:
```json
{
  "redirectUrl": "http://localhost:3000/auth/callback"
}
```

**Response** (200 OK):
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=..."
}
```

**Response** (error):
```json
{
  "error": "invalid_redirect_url",
  "message": "Redirect URL must be https or localhost"
}
```

#### POST /api/auth/callback
**Purpose**: Exchange OAuth code for tokens.

**Request**:
```json
{
  "code": "4/0AY0e-g...",
  "state": "optional_state_param"
}
```

**Response** (200 OK):
```json
{
  "sessionId": "sess_abc123",
  "user": {
    "email": "user@gmail.com",
    "displayName": "John Doe"
  },
  "tokenExpiry": "2024-03-05T15:30:00Z"
}
```

#### POST /api/auth/disconnect
**Purpose**: Revoke token and clear session.

**Request** (no body):
```json
{}
```

**Response** (200 OK):
```json
{
  "status": "disconnected",
  "message": "Session cleared; Gmail API access revoked"
}
```

---

### 2. Sync Metadata

#### POST /api/sync/metadata
**Purpose**: Fetch and cache message metadata (initial or incremental).

**Request**:
```json
{
  "mode": "incremental|full",
  "limit": 40000,
  "progressCallback": "optional_websocket_url"
}
```

**Response** (200 OK, streamed):
```json
{
  "status": "in_progress",
  "synced": 500,
  "total": 40000,
  "syncId": "sync_xyz123",
  "historyId": "1234567890"
}
```

**Response** (202 Accepted, if async):
```json
{
  "status": "accepted",
  "syncId": "sync_xyz123",
  "checkUrl": "/api/sync/status/sync_xyz123"
}
```

#### GET /api/sync/status/:syncId
**Purpose**: Check ongoing sync progress.

**Response** (200 OK):
```json
{
  "syncId": "sync_xyz123",
  "status": "in_progress|completed|failed",
  "synced": 10000,
  "total": 40000,
  "percentComplete": 25,
  "eta": "2024-03-05T15:15:00Z",
  "error": null
}
```

**Response** (200 OK, completion):
```json
{
  "syncId": "sync_xyz123",
  "status": "completed",
  "messagesAdded": 12,
  "messagesUpdated": 540,
  "messagesDeleted": 3,
  "newHistoryId": "1234567891",
  "timestamp": "2024-03-05T15:10:00Z"
}
```

---

### 3. Generate Recommendations

#### POST /api/recommend
**Purpose**: Analyze cached metadata and produce categorization.

**Request**:
```json
{
  "enableDeepAnalysis": false,
  "deepAnalysisSampleSize": 20,
  "includeProtectedLabels": false,
  "customRules": [
    {
      "name": "My Custom Rule",
      "conditions": [
        { "field": "from", "operator": "contains", "value": "@example.com" }
      ],
      "action": "archive",
      "confidence": 0.95
    }
  ]
}
```

**Response** (200 OK):
```json
{
  "recommendationId": "rec_abc123",
  "timestamp": "2024-03-05T15:10:00Z",
  "categories": [
    {
      "categoryId": "old_promotions",
      "name": "Old Promotional Emails",
      "count": 2543,
      "confidence": 0.87,
      "riskLevel": "low",
      "suggestedAction": "archive",
      "rulesApplied": [
        "sender_domain: noreply@*",
        "subject_keywords: ['OFF', 'discount']",
        "age: >18months"
      ],
      "samples": [
        {
          "id": "msg_123",
          "subject": "50% OFF - Don't Miss Out!",
          "from": "noreply@store.com",
          "date": "2023-05-15"
        }
      ],
      "rollbackSteps": ["re-apply INBOX label"]
    }
  ],
  "totalEmailsRecommended": 12543,
  "totalEmailsProtected": 135,
  "notes": "Deep analysis disabled; enable to refine categories"
}
```

---

### 4. Dry-Run Operation

#### POST /api/operation/dryrun
**Purpose**: Preview operation without modifying Gmail.

**Request**:
```json
{
  "operation": {
    "type": "archive|label|trash|delete",
    "categories": ["old_promotions", "receipts"],
    "batchSize": 500,
    "labelId": "Label_123", 
    "includeProtected": false
  }
}
```

**Response** (200 OK):
```json
{
  "dryRunId": "dr_xyz123",
  "operation": {
    "type": "archive",
    "categories": ["old_promotions"],
    "batchSize": 500
  },
  "preview": {
    "totalAffected": 2543,
    "batches": 6,
    "estimatedTimeSeconds": 180,
    "affectedThreads": 2100,
    "sampleAffectedMessages": [
      {
        "id": "msg_123",
        "subject": "50% OFF",
        "from": "noreply@store.com",
        "labels": ["INBOX", "PROMOTIONS"]
      }
    ],
    "riskAssessment": {
      "starredConflict": 0,
      "protectedLabelConflict": 0,
      "recentEmailConflict": 5,
      "unreadConflict": 50,
      "overallRisk": "low"
    },
    "reversibilityNotes": "All messages will be removed from INBOX but preserved in All Mail. Undo available for 24 hours."
  },
  "canProceed": true,
  "warnings": [
    "50 unread emails will be archived; confirm you've reviewed them"
  ]
}
```

---

### 5. Execute Operation

#### POST /api/operation/execute
**Purpose**: Apply approved operation to Gmail.

**Request**:
```json
{
  "dryRunId": "dr_xyz123",
  "approvalToken": "apptoken_abc123",
  "categories": ["old_promotions"],
  "operation": {
    "type": "archive",
    "batchSize": 500
  },
  "userConfirmation": {
    "acknowledged": true,
    "timestamp": "2024-03-05T15:20:00Z"
  }
}
```

**Response** (202 Accepted, async execution):
```json
{
  "executionId": "exec_abc123",
  "status": "in_progress",
  "statusUrl": "/api/operation/status/exec_abc123"
}
```

#### GET /api/operation/status/:executionId
**Purpose**: Poll execution progress.

**Response** (200 OK, in progress):
```json
{
  "executionId": "exec_abc123",
  "status": "in_progress",
  "batchesCompleted": 3,
  "batchesTotal": 6,
  "messagesProcessed": 1500,
  "messagesTotal": 2543,
  "percentComplete": 59,
  "currentBatchStatus": "executing"
}
```

**Response** (200 OK, completed):
```json
{
  "executionId": "exec_abc123",
  "status": "completed",
  "startedAt": "2024-03-05T15:20:30Z",
  "completedAt": "2024-03-05T15:23:45Z",
  "operation": "archive",
  "categoriesAffected": ["old_promotions"],
  "summary": {
    "messagesSucceeded": 2540,
    "messagesFailed": 3,
    "messagesSkipped": 0
  },
  "failureDetails": [
    {
      "messageId": "msg_999",
      "reason": "Not found (may have been deleted)",
      "response": "404"
    }
  ],
  "logId": "log_xyz123",
  "reversibilityInfo": {
    "canUndo": true,
    "undoAvailableUntil": "2024-03-06T15:23:45Z",
    "undoUrl": "/api/operation/undo/exec_abc123"
  }
}
```

**Response** (200 OK, partial failure / rate limited):
```json
{
  "executionId": "exec_abc123",
  "status": "partial_failure",
  "reason": "Rate limit exceeded",
  "messagesProcessed": 1200,
  "messagesTotal": 2543,
  "retryUrl": "/api/operation/retry/exec_abc123",
  "retryAfterSeconds": 300
}
```

---

### 6. Undo Operation

#### POST /api/operation/undo/:executionId
**Purpose**: Reverse a completed operation.

**Request**:
```json
{
  "reason": "user_requested"
}
```

**Response** (202 Accepted):
```json
{
  "undoId": "undo_abc123",
  "executionId": "exec_abc123",
  "status": "in_progress",
  "statusUrl": "/api/operation/status/undo_abc123"
}
```

---

### 7. Retrieve Logs

#### GET /api/logs
**Purpose**: Fetch audit log entries.

**Request** (query params):
```
?limit=50&offset=0&filter=all|success|failure&startDate=2024-03-01&endDate=2024-03-05
```

**Response** (200 OK):
```json
{
  "logs": [
    {
      "logId": "log_xyz123",
      "timestamp": "2024-03-05T15:23:45Z",
      "operation": "archive",
      "categories": ["old_promotions"],
      "status": "success",
      "summary": {
        "attempted": 2543,
        "succeeded": 2540,
        "failed": 3
      },
      "affectedMessageIds": ["msg_1", "msg_2", "msg_3", "..."],
      "reversible": true,
      "rollbackUrl": "/api/operation/undo/exec_abc123"
    }
  ],
  "total": 127,
  "limit": 50,
  "offset": 0
}
```

#### GET /api/logs/:logId
**Purpose**: Export detailed log as JSON.

**Response** (200 OK, JSON file):
```json
{
  "logId": "log_xyz123",
  "timestamp": "2024-03-05T15:23:45Z",
  "user": "user@gmail.com",
  "operation": {
    "type": "archive",
    "categories": ["old_promotions"],
    "batchSize": 500
  },
  "dryRunResults": {
    "expectedCount": 2543,
    "risks": []
  },
  "executionResults": {
    "startedAt": "2024-03-05T15:20:30Z",
    "completedAt": "2024-03-05T15:23:45Z",
    "succeeded": 2540,
    "failed": 3,
    "skipped": 0
  },
  "details": {
    "batchResults": [
      {
        "batchNumber": 1,
        "messageCount": 500,
        "status": "success",
        "affectedIds": ["msg_1", "msg_2", "..."],
        "timestamp": "2024-03-05T15:20:35Z"
      }
    ]
  },
  "reversibilityInfo": {
    "type": "archive_undo",
    "undoSteps": ["re-apply label INBOX to affected messages"]
  },
  "checksum": "sha256:abcdef..."
}
```

---

### Error Responses (All Endpoints)

**400 Bad Request**:
```json
{
  "error": "invalid_request",
  "message": "Field 'operation' is required",
  "field": "operation"
}
```

**401 Unauthorized**:
```json
{
  "error": "unauthorized",
  "message": "Token expired; reconnect to Gmail"
}
```

**429 Too Many Requests**:
```json
{
  "error": "rate_limited",
  "message": "Gmail API rate limit exceeded",
  "retryAfterSeconds": 60
}
```

**500 Internal Server Error**:
```json
{
  "error": "internal_error",
  "message": "Failed to process request",
  "requestId": "req_abc123"
}
```

---

## 9. Permissions & Security

### OAuth Scopes (Minimal-First)

| Scope | Gmail Permission | Reason | Required |
|-------|------------------|--------|----------|
| `https://www.googleapis.com/auth/gmail.metadata` | Read message metadata (no body) | Fetch sender, subject, labels, dates | **Yes** |
| `https://www.googleapis.com/auth/gmail.modify` | Modify labels, move to trash, archive | Apply operations (archive, label, trash) | **Yes** |
| `https://www.googleapis.com/auth/gmail.readonly` | Read full message body | Optional deep analysis (snippets only by default) | No (opt-in gate) |
| `https://www.googleapis.com/auth/userinfo.profile` | Read user profile | Session management, logging | **Yes** |

**Rationale**:
- `gmail.metadata` sufficient for most use cases (senders, subjects, dates, labels, snippet).
- `gmail.modify` required for archive, label, trash (not read-only).
- `gmail.readonly` only requested if user enables "Deep Analysis Mode."
- No calendar, contacts, or other Google services accessed.

### Token Storage Encryption

**At Rest**:
- Refresh tokens stored in SQLite with AES-256 encryption (key derived from local environment secret or OS keystore).
- Access tokens kept in memory; written to disk only if explicitly configured (not default).
- SQLite database file encrypted if OS supports (e.g., BitLocker, FileVault).

**In Transit**:
- All API calls to Gmail via HTTPS/TLS 1.2+.
- All frontend-to-backend communication via HTTPS.
- No HTTP fallback.

**Revocation**:
- User can disconnect anytime → access token invalidated, refresh token deleted from local store.
- Revocation request sent to Google OAuth endpoint to clear token server-side.

### Email Content Security

**Policy**:
- Full email bodies **never** stored locally (except transient deep analysis samples).
- Snippets (first ~100 chars) cached as part of message metadata.
- Deep analysis (if enabled) fetches full body, analyzes in memory, and discards after aggregating signals.
- No email content logged in audit trails; only metadata (from, subject, messageId) logged.

**PII Handling**:
- Email addresses (from, to) cached as necessary for categorization.
- User email address visible in UI and logs (session identifier).
- Recipient addresses not logged unless explicitly part of operation details.
- No phone numbers, credit card numbers, or internal identifiers extracted and cached.

### Logging & Audit Policy

**Logged**:
- User email, IP address (if available), session timestamp
- Operation type, category, approval time
- Message metadata (ID, sender domain, subject, date)
- Result (success/failure, counts)

**Not Logged**:
- Full email body (transient only)
- OAuth access tokens
- User passwords or recovery codes
- Raw HTTP request/response bodies (summary only)

**Retention**:
- Audit logs kept indefinitely on local user device.
- User can export and delete logs anytime.
- No central log aggregation (privacy-first local-only model).

---

## 10. Failure Modes & Mitigations

### Failure Mode 1: Token Expiry During Batch Operation

**Scenario**: User executes operation (archive 2,543 emails); token expires at batch 3 of 6.

**Mitigation**:
1. Backend detects 401 error from Gmail API.
2. Attempts automatic refresh-token flow.
3. If refresh succeeds → resume from batch 3 (idempotent, see below).
4. If refresh fails → pause operation, alert user "Session expired"; user reconnects OAuth.
5. Resume-from-checkpoint available via `/api/operation/retry/:executionId`.

**Idempotency**:
- Each batch operation includes batch ID and message list.
- Gmail API is idempotent for label application (applying same label twice = no change).
- Archive (remove INBOX label) and trash idempotent.
- Retry logic checks result of each batch before proceeding.

### Failure Mode 2: Gmail API Rate Limit (429)

**Scenario**: Batch archive hits 15 million requests/day quota or per-second rate.

**Mitigation**:
1. Backend receives `X-RateLimit-Reset` header.
2. Pause all operations; log retry time.
3. Alert user: "Rate limit hit; Gmail is allowing X requests/minute; resume in 60 seconds?"
4. User can wait or cancel.
5. Exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 64s, then fail with clear message.

**Batch Size Tuning**:
- Default 500 messages per batch.
- If rate limit hit, automatically reduce to 250 for next retry.
- User can manually adjust via UI.

### Failure Mode 3: Message Not Found During Execution

**Scenario**: Message deleted by user or another device between sync and execution.

**Mitigation**:
1. Backend detects 404 or "Message not found" error for specific message ID.
2. Log the failure with message ID and reason.
3. Continue with remaining messages (non-blocking).
4. After batch completes, report summary: "2,540 of 2,543 archived; 3 not found (likely deleted)."
5. User sees detailed failures in log and can retry if needed.

### Failure Mode 4: Partial Batch Failure (Network, Server Error)

**Scenario**: Batch 3 partially fails (500 internal server error); 300 of 500 labels applied.

**Mitigation**:
1. Backend logs partial result with exact count.
2. For next batch, query Gmail to confirm state before retrying (idempotency check).
3. If 300 messages already have label → skip them.
4. Return "Partial success" with breakdown.
5. User can view detailed log and manually verify or retry.

### Failure Mode 5: Database Corruption or Loss

**Scenario**: SQLite database file corrupted; sync cache unreadable.

**Mitigation**:
1. On startup, database integrity check (`PRAGMA integrity_check`).
2. If corruption detected → alert user "Cache corrupted; forcing full resync."
3. Full resync from scratch (fetches all message metadata again).
4. Previous audit logs exported to JSON before clearing (backup available).
5. User can manually restore logs from export if needed.

### Failure Mode 6: User Revokes OAuth Permission

**Scenario**: User revokes Gmail access in their Google Account settings mid-operation.

**Mitigation**:
1. Backend detects `invalid_grant` or similar error.
2. Stop operation immediately.
3. Alert user: "Gmail access revoked; reconnect to continue."
4. Clear cached refresh token.
5. UI offers "Connect Again" button.
6. No data loss; cache preserved; user can retry after reconnecting.

### Failure Mode 7: "Stop the World" Safety Switch

**User Action**: Mid-operation, user clicks "Cancel" or closes browser.

**Mitigation**:
1. Frontend or backend receives cancel signal.
2. Stop queuing new batches; complete current batch in flight.
3. Log cancellation event with context "user_requested" + timestamp.
4. Inform user: "Paused after batch X of Y. You can resume, undo, or view what was done."
5. Operation marked as "partial_completed" or "paused" in log.
6. Full audit trail of what succeeded before pause.

---

## 11. Testing Strategy

### 11.1 Unit Tests

**Scope**: Categorization engine, query builders, JWT validation.

**Test Cases** (using Jest + mock Gmail API):

```javascript
describe('Categorization Engine', () => {
  test('identifies old promotional emails', () => {
    const email = {
      from: 'noreply@store.com',
      subject: '50% OFF Sale',
      internalDate: '2022-01-01',
      snippet: 'Limited time offer'
    };
    const category = categorize(email);
    expect(category.category).toBe('old_promotions');
    expect(category.confidence).toBeGreaterThan(0.8);
  });

  test('protects starred emails from categorization', () => {
    const email = {
      from: 'boss@company.com',
      labelIds: ['STARRED'],
      subject: 'Important Policy Update'
    };
    const result = categorize(email, { includeProtected: false });
    expect(result).toBeNull();
  });

  test('handles deep analysis sampling', async () => {
    const sample = [email1, email2, email3];
    const signals = await analyzeContentSignals(sample, maxSize=20);
    expect(signals).toHaveProperty('templateMatch');
    expect(signals).toHaveProperty('keywordFrequency');
    expect(signals).not.toHaveProperty('rawBody');
  });
});

describe('Batch Operation Builder', () => {
  test('generates correct Gmail API batch request', () => {
    const batch = buildBatchLabelsRequest(
      messageIds=['msg1', 'msg2'],
      labelId='Label_123'
    );
    expect(batch.requests.length).toBe(2);
    expect(batch.requests[0]).toEqual({
      updateLabelsRequest: {
        addLabelIds: ['Label_123'],
        removeIds: /* none if archive not specified */
      }
    });
  });
});
```

**Coverage Target**: 80%+ (core logic, not UI).

### 11.2 Integration Tests

**Scope**: API endpoints with mocked Gmail client.

**Setup**: Use `nock` or similar to mock Gmail API responses.

```javascript
describe('POST /api/operation/dryrun', () => {
  beforeEach(() => {
    mockGmailList([/* 2543 message IDs */]);
    mockGmailBatchGet([/* metadata for sample */]);
  });

  test('returns dry-run preview without modifying Gmail', async () => {
    const response = await request(app)
      .post('/api/operation/dryrun')
      .send({
        operation: { type: 'archive', categories: ['old_promotions'] }
      });
    
    expect(response.status).toBe(200);
    expect(response.body.totalAffected).toBe(2543);
    expect(response.body.canProceed).toBe(true);
    
    // Verify Gmail unmodified
    const inboxLabels = await gmailClient.getLabels();
    expect(inboxLabels.INBOX.messages).toBe(/* original count */);
  });

  test('handles rate limit in dry-run gracefully', async () => {
    mockGmailRateLimit(429, 60);
    
    const response = await request(app)
      .post('/api/operation/dryrun')
      .send(/* ... */);
    
    expect(response.status).toBe(429);
    expect(response.body.retryAfterSeconds).toBe(60);
  });
});

describe('POST /api/operation/execute', () => {
  test('executes batch archive operation idempotently', async () => {
    mockGmailBatchModify([
      { status: 200 },
      { status: 200 }
    ]);

    const exec1 = await executeOperation({
      dryRunId: 'dr_abc',
      operation: { type: 'archive' }
    });

    // Retry same operation
    const exec2 = await executeOperation({
      dryRunId: 'dr_abc',
      operation: { type: 'archive' }
    });

    expect(exec1.status).toBe('success');
    expect(exec2.status).toBe('success');
    // Both should result in same final state
  });

  test('handles partial failure and resumes', async () => {
    // First call: 3 of 6 batches succeed before timeout
    mockGmailTimeoutAfterBatch(3);
    
    const exec = await executeOperation(/* ... */);
    expect(exec.status).toBe('partial_failure');
    expect(exec.batchesCompleted).toBe(3);

    // Resume
    const resume = await retryOperation(exec.executionId);
    expect(resume.status).toBe('success');
  });
});
```

### 11.3 End-to-End Tests

**Scope**: Full user journey: connect → sync → recommend → dry-run → execute → log.

**Test Scenario** (Smoke Test):
```gherkin
Scenario: User safely archives old promotions
  Given: User browser at http://localhost:3000
  When: User clicks "Connect Gmail"
  Then: OAuth consent screen shown
  
  When: User grants permission
  Then: Inbox overview shown with "Syncing..." message
  
  When: Sync completes (mocked 40k emails)
  Then: Category breakdown displayed (Promotions: 5000, etc.)
  
  When: User clicks [Recommendations] tab
  Then: AI categories listed with samples and confidence scores
  
  When: User clicks "Approve" on "Old Promotions" (2,543 emails)
  Then: Category marked ready in [Actions] tab
  
  When: User selects archive action and clicks "Preview"
  Then: Dry-run shows 2,543 emails, samples, and risks
  
  When: User clicks "Start Cleanup"
  Then: Progress bar shown; operation executes in batches
  
  When: Operation completes
  Then: [Logs] tab shows successful operation with timestamp and undo option
  
  When: User clicks "View Details"
  Then: Full JSON log exported with checksum
```

**Implementation** (Cypress or Playwright):
```javascript
describe('E2E: Safe Cleanup Workflow', () => {
  it('completes full workflow without destructive action', async () => {
    await page.goto('http://localhost:3000');
    await page.click('button:has-text("Connect Gmail")');
    
    // OAuth flow mocked
    await mockOauthFlow(page);
    
    // Sync
    await page.waitForSelector('[data-test="sync-progress"]');
    await mockGmailSync(40000);
    await page.waitForText('Sync complete');
    
    // Recommendations
    await page.click('[data-test="tab-recommendations"]');
    const categories = await page.locator('[data-test="category-card"]').count();
    expect(categories).toBeGreaterThan(0);
    
    // Approve and dry-run
    await page.click('[data-test="category-old-promo"] button:has-text("Approve")');
    await page.click('[data-test="tab-actions"]');
    await page.click('button:has-text("Preview")');
    await expect(page).toHaveText(/2543 emails/);
    
    // Execute
    await page.click('button:has-text("Start Cleanup")');
    await page.waitForText(/Completed/);
    
    // Verify log
    await page.click('[data-test="tab-logs"]');
    const logRow = page.locator('tr:has-text("archive")');
    await logRow.click();
    // Verify immutable log JSON
  });
});
```

### 11.4 Performance Tests

**Scope**: Sync/categorization speed, batch execution latency.

**Benchmarks**:
- Fetch 40k message IDs: <30s (Gmail API batch calls)
- Fetch 40k message metadata: <5 minutes (rate-limited batches of 100)
- Categorize 40k emails: <10s (in-memory, no I/O)
- Execute 2500-email archive batch (5 batches): <2 minutes (including rate limits, retries)

**Test**:
```javascript
describe('Performance', () => {
  test('fetches and syncs 40k messages in <5 minutes', async () => {
    const startTime = Date.now();
    await syncMetadata({ limit: 40000, mockCount: 40000 });
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(5 * 60 * 1000);
  });

  test('categorizes 40k emails in <10 seconds', async () => {
    const emails = generateMockEmails(40000);
    const startTime = Date.now();
    const categories = emails.map(categorize);
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(10000);
  });
});
```

### 11.5 Security Tests

**Scope**: Token handling, PII in logs, access control.

```javascript
describe('Security', () => {
  test('does not log full email bodies', async () => {
    await executeOperation({ /* ... */ });
    const logs = fs.readFileSync('./logs/audit.log', 'utf8');
    expect(logs).not.toMatch(/Dear Customer.*Thank you.*Order/s);
  });

  test('encrypts refresh tokens at rest', async () => {
    const token = 'refresh_token_abc123';
    await storeRefreshToken(token, password='user_password');
    
    const db = sqlite3.open('./db/app.sqlite');
    const stored = db.prepare('SELECT token FROM oauth_tokens LIMIT 1').get();
    expect(stored.token).not.toBe(token);
    expect(stored.token).toMatch(/^[A-Za-z0-9+/=/]+$/); // Base64-like
  });

  test('revokes token on disconnect', async () => {
    const mockRevokeWasCalled = false;
    sinon.stub(googleOAuth, 'revokeToken').callsFake(async () => {
      mockRevokeWasCalled = true;
    });

    await disconnectOAuth();
    expect(mockRevokeWasCalled).toBe(true);
  });
});
```

---

## 12. Definition of Done

A user journey is complete when:

### Functional Completeness
1. ✅ User clicks "Connect Gmail" and completes OAuth consent flow.
2. ✅ Backend fetches metadata for 40k+ messages (initial sync in <5 minutes or resumed incrementally).
3. ✅ Metadata cached in SQLite with timestamp and historyId for idempotent sync.
4. ✅ AI categorization produces structured report (5+ categories) with confidence scores and samples.
5. ✅ User reviews recommendation report and can approve/reject/edit categories.
6. ✅ Dry-run generates preview: exact counts, sample message IDs, risks, and reversibility notes (no Gmail modifications).
7. ✅ Dry-run blocks execution if risk assessment flags protected labels or recent/unread emails (user can override).
8. ✅ User clicks "Start Cleanup"; operation executes in configurable batches (default 500 messages).
9. ✅ Each batch applied via Gmail API (archive = remove INBOX label; label = add label; trash = add TRASH label).
10. ✅ Operation produces immutable audit log entry with timestamp, counts, affected message IDs, result, and rollback steps.
11. ✅ User can view log, export JSON, and undo/retry operation (if reversible and within time window).
12. ✅ UI displays clear messages at each step; no ambiguity about what will happen or what happened.

### Safety Completeness
1. ✅ No destroy operation (archive, label, trash) executes without explicit user click on a specific operation.
2. ✅ Dry-run mode exists for every operation; user must review preview before proceeding.
3. ✅ All operations produce immutable audit trail; user can export logs.
4. ✅ Protected labels (STARRED, IMPORTANT, user-defined protected) never affected without explicit override + second confirmation.
5. ✅ Reversibility ensured: prefer archive/label over delete; trash is reversible; permanent delete disabled by default.
6. ✅ AI recommendations non-binding; user views evidence (rules, samples, confidence) before approving.
7. ✅ Full email bodies not stored or logged; only metadata and optional aggregated signals from deep analysis (if enabled).

### Non-Functional Completeness
1. ✅ Rate limit handling: exponential backoff, user-friendly error messages, resume capability.
2. ✅ Token management: refresh tokens encrypted at rest, access tokens cleared on disconnect, revocation request sent to Google.
3. ✅ Error resilience: partial failures logged, idempotent retries, database integrity checks.
4. ✅ Performance: 40k metadata fetch <5 min, categorization <10s, batch archive <2 min (with rate limits).
5. ✅ Logging: every operation logged with metadata-only (no raw email bodies), user can access/export logs.

### Testing Completeness
1. ✅ Unit tests cover categorization, batch building, token refresh (80%+ coverage of logic).
2. ✅ Integration tests mock Gmail API and verify endpoints, error handling, retries.
3. ✅ E2E smoke test: full workflow (connect → sync → recommend → dry-run → execute → log) without manual intervention.
4. ✅ Performance benchmarks meet targets; no regressions.
5. ✅ Security tests verify token encryption, PII handling, revocation.

### Documentation Completeness
1. ✅ This design doc covers all 12 sections: goals, non-goals, architecture, Gmail API plan, safety rails, AI approach, UI, API contracts, permissions, failure modes, testing, and definition of done.
2. ✅ API endpoints documented with request/response examples.
3. ✅ Safety invariants clearly stated and testable.
4. ✅ Architectural decisions justified; no arbitrary complexity.

---

## Appendix A: Threat Model & Mitigations

| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|-----------|
| User accidentally approves wrong operation | Medium | High (data loss) | Dry-run preview mandatory; sample IDs shown; risk flags prominently displayed |
| Gmail API token leaked | Low | Critical (account compromise) | Refresh tokens encrypted AES-256; access tokens short-lived (1h); revocation on disconnect |
| Unintended emails archived/deleted | Medium | High | Dry-run shows exact counts + samples; protected labels exempt; age-based filters; undo available 24h |
| Database corruption loses audit log | Low | Medium (non-repudiation) | Integrity check on startup; backup audit logs to JSON before ops; user can export anytime |
| Attacker gains local device access | Low | Critical (email compromise) | OAuth tokens encrypted; no plaintext credentials stored; depends on OS security (BitLocker, FileVault) |
| Rate limit prevents cleanup | Low | Low (inconvenience) | Exponential backoff, user-friendly retry, batch size auto-tune |
| Service reads full email bodies without consent | Medium | High (privacy) | Deep analysis is opt-in; requires explicit user click + warning modal; no bodies stored or logged |

---

## Appendix B: Glossary

- **Archive**: Remove INBOX label; message remains in All Mail/Gmail system; fully reversible.
- **Categorization**: Grouping emails by heuristic rules (sender, age, keywords, labels).
- **Dry-Run**: Preview operation without modifying Gmail; shows expected results, sample data, risks.
- **Immutable Log**: Record that cannot be edited after creation; ensures audit trail integrity.
- **Idempotent**: Operation produces same result if executed multiple times; safe for retries.
- **Incremental Sync**: Fetch only changed messages (via historyId) instead of full resync.
- **Label**: Gmail mechanism to tag/organize messages; multiple per message; custom or system-provided.
- **Reversible**: Action that can be undone; archive, label, trash are reversible; delete is not.
- **Thread**: Conversation; group of related messages on same topic; may contain multiple messages.
- **Trash**: Move to Trash label; reversible within 30 days; automatic permanent delete after 30 days.

---

## Appendix C: Future Considerations (Out of Scope)

- Multi-account support (one account per session for now)
- Scheduled cleanup runs (manual execution only)
- Custom machine learning models for categorization (metadata heuristics sufficient)
- Sharing cleanup recommendations with other users
- Mobile app (web-based for now)
- Team/organizational features
- Integration with Slack, email forwarding, external services

---

**Document Version**: 1.0  
**Last Updated**: March 2026  
**Next Review**: Post-implementation, after first 10 users complete initial cleanup cycle
