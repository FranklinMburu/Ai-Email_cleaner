# Gmail Inbox Cleanup Tool — Execution Specification

**Version:** 1.0  
**Date:** March 5, 2026  
**Status:** Ready for Implementation  
**Duration:** Single focused implementation session

---

## 1. Goal (Measurable)

**PRIMARY GOAL:**  
Deliver a **complete, safe-by-default, human-controlled Gmail inbox cleanup tool** that allows users with 40,000+ emails to:
1. Connect Gmail via OAuth (4 minimal scopes)
2. Sync message metadata in incremental mode (historyId-based)
3. Categorize emails into 5 default categories (Newsletters, Notifications, Promotions, Receipts, Old Emails) with rule-based AI
4. Preview cleanup operations via dry-run (no Gmail modifications)
5. Execute operations with explicit user approval (archive, label, trash)
6. Maintain immutable audit logs of all actions

**SUCCESS CRITERIA:**
- ✅ OAuth flow completes; tokens encrypted and stored
- ✅ Metadata sync works for 40k+ emails (tested with mock dataset; real testing optional)
- ✅ Categorization engine correctly classifies emails by 5 rules with confidence scores
- ✅ Dry-run mode shows exact scope without modifying Gmail
- ✅ Execute mode requires operationId + approvalToken (prevents replay and accidental execution)
- ✅ All operations logged immutably
- ✅ Protected emails (starred/important) excluded from operations by default
- ✅ All unit, integration, and smoke tests pass
- ✅ Code lints without errors; no security warnings

**MEASURABLE DELIVERABLES:**
- Full backend implementation (Node.js/Express/SQLite) with 8 modules
- Full frontend implementation (React) with 5-tab dashboard
- Comprehensive test suite (unit, integration, E2E smoke test)
- Complete documentation (design, implementation guide, checklist)

---

## 2. Constraints & Invariants

### Constraints (Hard Boundaries)
1. **Single Account**: One Gmail account per session (no multi-account support)
2. **Metadata-First**: Default behavior reads only message metadata; bodies optional + explicit
3. **No Permanent Deletion**: Delete endpoint exists but is disabled/blocked by default; archive/label preferred
4. **Manual Execution**: No cron, no background jobs, no scheduled cleanup; user-driven only
5. **Local Storage**: SQLite database (no cloud sync, no multi-device)
6. **Session-Based**: In-memory session map; restart clears sessions

### Invariants (Non-Negotiable Safety Requirements)

**These invariants MUST be enforced in code, verified by tests, and documented in implementation.**

#### Invariant 1: No Destructive Action Without Explicit User Click
- **Enforcement**: Backend requires `approvalToken` (generated during dry-run) for execute endpoints
- **UI Check**: "Start Cleanup" button hidden until dry-run completed AND `canProceed` flag is true
- **Test**: operations.test.js verifies approval token validation
- **Line Reference**: backend/src/operations.js (execute function)

#### Invariant 2: Dry-Run Mandatory Before Execute
- **Enforcement**: Execute endpoint validates `operationId` exists in operations table AND `operationId` matches dry-run session
- **UI Check**: Button only rendered if `dryRunResult` state exists
- **Test**: operations.test.js verifies dry-run creates operation record
- **Line Reference**: backend/src/operations.js (execute validation)

#### Invariant 3: Immutable Audit Log
- **Enforcement**: SQLite audit_log table INSERT-only (no UPDATE/DELETE); application code never modifies existing entries
- **Schema Guarantee**: No triggers, no procedures that update audit records
- **Export**: User can export audit log as JSON
- **Test**: operations.test.js verifies audit entry created after execute
- **Line Reference**: backend/src/database.js (audit_log table schema + operations.js insert)

#### Invariant 4: Protected Emails Auto-Excluded
- **Protected Labels** (default): STARRED, IMPORTANT
- **Enforcement**: SQL WHERE clause at query time: `WHERE is_starred = 0 AND label_ids NOT LIKE '%IMPORTANT%'`
- **UI Override**: Optional "Include protected emails" toggle (off by default) + confirmation dialog
- **Test**: operations.test.js verifies protected emails excluded from dry-run count
- **Line Reference**: backend/src/operations.js (createDryRunOperation filter)

#### Invariant 5: Actions Are Reversible by Default
- **Preferred Actions** (reversible):
  1. ARCHIVE: Remove INBOX label → stored in All Mail; user can re-add INBOX
  2. LABEL: Add custom label (e.g., "Promotions Archive") → user can remove label
  3. TRASH: Add TRASH label → reversible for 30 days (Gmail auto-deletes after 30)
- **Prohibited Actions** (blocked):
  1. DELETE: Permanently delete with no recovery; disabled/blocked OR requires 2x confirmation
- **Test**: operations.test.js verifies only ARCHIVE/LABEL/TRASH allowed
- **Line Reference**: backend/src/operations.js (action type validation)

#### Invariant 6: All Operations Logged with Full Context
- **Log Fields**: timestamp, user_email, operation_id, operation_type, message_ids, affected_count, status, errors
- **No Body Storage**: Audit logs never contain full email bodies or raw sender addresses (redacted if logged)
- **Immutability**: Once inserted, entries are read-only via application layer
- **Test**: operations.test.js verifies log entry exists after execute
- **Line Reference**: backend/src/operations.js + database.js (audit_log table)

---

## 3. Required Changes (Minimal Implementation)

### A. Backend Core (Node.js/Express/SQLite)

**Module: database.js** (130 lines)
- SQLite schema initialization
- 6 tables: oauth_tokens, message_metadata, sync_state, categorization_cache, operations, audit_log
- Indexes on: user_email, message_id, operation_id, created_at
- Encryption support for token storage

**Module: encryption.js** (55 lines)
- AES-256-GCM encryption/decryption for refresh tokens
- Key derived from TOKEN_ENCRYPTION_KEY environment variable

**Module: oauth.js** (93 lines)
- Google OAuth2 client initialization with 4 scopes: gmail.metadata, gmail.modify, userinfo.profile, userinfo.email
- getAuthUrl() → OAuth consent URL
- exchangeCodeForTokens(code) → exchange code for tokens
- getGmailClient(userEmail) → authenticated Gmail API client
- Token refresh logic (auto-refresh if expired)
- Token revocation on disconnect

**Module: sync.js** (244 lines)
- syncMetadata(userEmail, mode) → fetch metadata (incremental or full)
- incrementalSync via historyId from previous sync; fallback to full if invalid
- Fetch full metadata in pages (500 per page); batch-get message details (100 per batch)
- Cache message metadata: id, threadId, from, to, subject, snippet, date, labels, size, is_unread, is_starred
- clearMetadataCache(userEmail) → reset sync state

**Module: categorize.js** (225 lines)
- 5 categories with rule-based matching:
  1. NEWSLETTERS: "newsletter"/"digest" in sender/subject → 85% confidence
  2. NOTIFICATIONS: "notification" in sender; "comment"/"like"/"follow" in subject → 80%
  3. PROMOTIONS: "sale"/"discount" in subject OR "promo" in sender → 75%
  4. RECEIPTS: "order"/"receipt" in subject OR amazon/ebay in sender → 90%
  5. OLD_EMAILS: internal_date > 2 years → 95%
- categorizeEmail(email) → {categoryId, confidence, riskLevel}
- generateRecommendations(userEmail) → structured report with counts, samples, top senders, risk assessment
- saveCategorizationCache(userEmail, categoryMap) → cache results in DB

**Module: operations.js** (261 lines)
- createDryRunOperation(userEmail, operationType, categories) → preview WITHOUT Gmail API calls
  - Returns: operationId, approvalToken, totalAffected, sampleAffected, riskAssessment, canProceed
  - Excludes protected emails (starred, important)
- executeOperation(userEmail, operationId, approvalToken, operationType, categories) → execute with approval
  - Validates operationId + approvalToken
  - Calls gmail.users.messages.batchModify() in batches (500 default)
  - Creates audit_log entry
  - Returns: operationId, status, summary {succeeded, failed}
- getOperationLog(userEmail, limit) → retrieve audit trail

**Module: routes.js** (182 lines)
- 9 API endpoints:
  - POST /api/auth/init → {authUrl}
  - POST /api/auth/callback → {sessionId, userEmail}
  - POST /api/auth/disconnect → {status: 'disconnected'}
  - POST /api/sync → {mode} → {status, messageCount}
  - POST /api/sync/clear → {status}
  - GET /api/report → recommendations
  - GET /api/inbox-overview → {totalMessages, unreadMessages, starredMessages}
  - POST /api/operation/dryrun → {operationId, approvalToken, ...}
  - POST /api/operation/execute → {operationId, status, ...}
  - GET /api/logs → {logs[]}
- Session management via x-session-id header (in-memory map)

**Module: server.js** (38 lines)
- Express app initialization
- CORS config (origin from FRONTEND_URL env)
- Body parser JSON
- Error handler middleware

### B. Frontend (React Dashboard)

**Component: Dashboard.js** (485 lines)
- Main React component with 5 tabs + login page
- Tab 1 (Overview): Inbox stats (total, unread, starred), sync trigger, report generator
- Tab 2 (Recommendations): Category cards with count, confidence, samples, top senders, risk badge
- Tab 3 (Actions): Category selector, action type selector, dry-run button, preview pane, "Start Cleanup" button (conditional)
- Tab 4 (Logs): Operation history table with status and results
- Tab 5 (Settings): Disconnect, clear cache
- LoginPage: "Connect Gmail" button, features list
- Error handling: banners, disabled button states, confirmation dialogs

**Styling: Dashboard.css** (380 lines)
- Responsive grid layout
- Card-based design
- Color scheme: Google Blue (#1a73e8) primary
- Risk badges: red (high), yellow (medium), green (low)

**Service: api.js** (57 lines)
- Axios HTTP client wrapper
- Methods: auth.*, inbox.*, sync.*, report.*, operations.*
- Request interceptor: adds x-session-id from localStorage

**Entry: App.js + index.js** (22 lines)
- Standard React setup

### C. Tests

**categorize.test.js** (92 lines)
- 7 unit tests: all 5 categories, uncategorized, missing fields

**operations.test.js** (195 lines)
- 5 integration tests: cache storage, approval token validation, protected exclusion, dry-run safety

**smoke.js** (350 lines)
- 1 end-to-end demo: 6 mock emails → categorize → dry-run → execute → audit log → verify invariants

### D. Configuration & Documentation

**package.json** (backend + frontend)
- Dependencies: express, better-sqlite3, googleapis, react, axios
- Scripts: start, dev, test, lint, format

**.env.example**
- Google OAuth credentials
- Database path
- Token encryption key template

**eslintrc.json, prettierrc.json**
- Code quality rules

**README.md**
- Setup, usage, API overview, troubleshooting

**IMPLEMENTATION.md**
- Detailed module breakdown, incremental sync strategy, safety enforcement, example payloads

**CHECKLIST.md**
- Verification checklist for all invariants

---

## 4. Checks to Run (Testing & Validation)

### Unit Tests
```bash
cd backend
npm test  # Runs node --test tests/**/*.test.js
# Expected: 7 unit tests pass (categorize.test.js)
```

### Integration Tests
```bash
cd backend
npm test  # Runs node --test (includes operations.test.js)
# Expected: 5 integration tests pass (operations.test.js with in-memory SQLite)
```

### Linting
```bash
cd backend
npm run lint           # eslint src tests --fix
cd ../frontend
npm run lint           # (handled by react-scripts)
# Expected: no errors, no warnings
```

### End-to-End Smoke Test
```bash
cd backend
node tests/smoke.js
# Expected output:
# ✅ Sync complete: 6 messages cached
# ✅ Categorization: 5 categories populated
# ✅ Dry-run: operationId + approvalToken generated
# ✅ Execute: 2 messages archived (4 protected)
# ✅ Audit log: 1 entry created
# ✅ All invariants verified
```

### Frontend Manual Smoke Test (Optional with Real OAuth)
1. Start backend: `npm run dev` (port 3001)
2. Start frontend: `npm start` (port 3000)
3. Click "Connect Gmail" → authorize OAuth
4. Sync → Generate Report → Dry-Run Archive → Start Cleanup → Verify Logs

---

## 5. Stop Condition (Definition of Done)

**STOP and declare COMPLETE when ALL of the following are true:**

- ✅ All 12 unit/integration/smoke tests pass without errors
- ✅ Linting passes (npm run lint has no warnings)
- ✅ Code formatted consistently (npm run format applied)
- ✅ All 6 invariants are enforced in code (verified via code review + tests)
- ✅ Example API payloads in documentation match actual responses
- ✅ No destructive operations can occur without explicit approval token
- ✅ Protected emails (starred/important) are auto-excluded from operations
- ✅ Audit log is immutable (verified in database schema)
- ✅ Encryption module encrypts tokens correctly
- ✅ OAuth flow completes with minimal scopes
- ✅ Synchronization works incremental mode (historyId)
- ✅ Categorization engine processes all 5 categories correctly
- ✅ Dry-run non-destructive (no Gmail API calls)
- ✅ Execute requires operationId + approvalToken
- ✅ Session management works (x-session-id header)
- ✅ CORS configured correctly (FRONTEND_URL respected)
- ✅ Error handling graceful (no crashes on API failures)
- ✅ All repo files created (backend/src/*, frontend/src/*, tests/*)
- ✅ Configuration files present (.env.example, eslintrc, prettier)
- ✅ Documentation complete (README, IMPLEMENTATION, CHECKLIST, SUMMARY)

**NO further features or changes until ALL stop conditions pass.**

---

## 6. Expected Output Summary Requirements

### Upon Completion, Provide:

#### A. What Was Built
- List all 8 backend modules (brief description of each)
- List all 5 frontend components
- List all 3 test suites with pass/fail count
- Total lines of code (backend, frontend, tests)

#### B. OAuth Scopes Used + Justification
```
Scope 1: gmail.metadata    → Read message metadata (ID, subject, sender, date, labels, snippet)
Scope 2: gmail.modify      → Apply labels, archive (remove INBOX), move to trash
Scope 3: userinfo.profile  → Read display name for logging
Scope 4: userinfo.email    → Read email for session identification
```

#### C. Incremental Sync Strategy
- Explain how historyId cursor works
- Show fallback logic if historyId invalid (>6 months)
- Confirm pagination (500 per page) + batch-get (100 per batch)

#### D. How Dry-Run vs. Execute Enforced
- Show approvalToken generation during dry-run
- Show validation in execute endpoint
- Confirm execute checks operationId exists + approvalToken matches

#### E. How Protected Emails Excluded + Override
- Show SQL WHERE clause that excludes starred + IMPORTANT
- Show UI toggle for override (off by default)
- Confirm second confirmation dialog on override

#### F. Summary of Checks Run
```
✅ 7 unit tests passed
✅ 5 integration tests passed
✅ 1 smoke test passed
✅ Linting: 0 errors
✅ Format: consistent
✅ All invariants verified
```

#### G. Files Changed / Created
- List all created/modified files with line counts
- Confirm no files deleted unexpectedly

#### H. Example Report Payload (Redacted, Metadata-Only)
```json
{
  "timestamp": "2024-03-05T15:10:00Z",
  "recommendationId": "rec_123",
  "totalMessages": 40000,
  "protectedMessages": 135,
  "categories": [
    {
      "categoryId": "promotions",
      "name": "Promotional Emails",
      "count": 12000,
      "confidence": 0.75,
      "riskLevel": "low",
      "samples": [{"id": "msg_xyz", "subject": "50% OFF", "from": "promo@store.com"}]
    }
  ]
}
```

#### I. Known Limitations (Only Unavoidable)
- Single account per session (design constraint)
- No multi-device sync (SQLite local storage)
- Incremental sync requires historyId validity (>6 months; fallback to full sync)
- rate limiting on Gmail API (backoff handled)

---

## 7. Out of Scope

**Explicitly NOT included in this implementation:**

- ❌ Multi-account support
- ❌ Real-time sync or push notifications
- ❌ Custom ML models for categorization (metadata heuristics only)
- ❌ Sharing recommendations with other users
- ❌ Mobile app (web only)
- ❌ Team/organizational features
- ❌ Third-party integrations (Slack, webhooks, etc.)
- ❌ Scheduled cleanup runs
- ❌ Full email body reading by default (opt-in only)
- ❌ Auto-delete (permanently disabled)
- ❌ Permanent rollback after 24 hours
- ❌ Encryption at rest for message metadata (depends on OS)

---

## 8. Approval Gates (Hard Stops)

**These gates MUST be satisfied before implementation proceeds:**

1. ✅ **Design Doc Complete**: All 12 sections + 6 invariants documented
2. ✅ **Spec Ready**: This document complete with measurable criteria
3. ⏳ **Implementation Start**: Code changes only after this spec is approved
4. ⏳ **All Tests Pass**: No partial implementations; all checks must pass
5. ⏳ **Security Review**: Token encryption, scopes, PII handling verified
6. ⏳ **Final Verification**: Stop condition checklist signed off

---

## 9. Version & Revision History

| Version | Date | Status | Notes |
|---------|------|--------|-------|
| 1.0 | March 5, 2026 | Ready for Implementation | Initial spec; all gates passed |

---

**Spec Owner**: Execution Agent  
**Linked Design Doc**: [docs/design/gmail-inbox-cleanup.md](../docs/design/gmail-inbox-cleanup.md)  
**Next Step**: STEP 3 Implementation (after approval)
