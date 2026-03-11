# Gmail Inbox Cleanup - System State Report

**Last Updated:** March 11, 2026  
**Status:** Operational (Demo v0.1)  
**Git Commit:** 85f627d (OAuth fixes and encryption key corrections)

---

## System Overview

A Node.js/React application for bulk Gmail inbox management with rule-based email categorization, dry-run preview, and reversible operations (archive, label, trash).

**Tech Stack:**
- Backend: Node.js 18+ with Express.js, SQLite (better-sqlite3), Google APIs
- Frontend: React 18 with Axios
- Authentication: Google OAuth2
- Database: SQLite with WAL mode, 5 tables, proper indexing
- Security: AES-256-GCM token encryption

---

## Running Application

**Backend:** Port 3001  
**Frontend:** Port 3000  
**Both servers:** Currently running and stable

### Database
- Location: `./data/app.sqlite`
- Schema: Complete with oauth_tokens, message_metadata, sync_state, categorization_cache, operations, audit_log tables
- Initialization: Automatic on first run

### Environment Variables
- Location: `backend/.env` (correctly in .gitignore)
- Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, TOKEN_ENCRYPTION_KEY, BACKEND_PORT, FRONTEND_URL, DB_PATH
- Status: Populated with real OAuth credentials

---

## Completed Features

### Authentication
- ✅ Google OAuth2 flow (authenticate → get code → exchange for tokens)
- ✅ Token encryption and storage in SQLite
- ✅ Session management via postMessage callback (popup → parent window)
- ✅ Session-based request authentication (x-session-id header)

### Email Sync
- ✅ Incremental sync via Gmail history API with historyId tracking
- ✅ Full sync fallback (40,000+ email limit)
- ✅ Batch fetching in increments of 100
- ✅ Stores: message_id, thread_id, from, subject, snippet, internal_date_ms, labels, unread, starred

### Categorization
- ✅ Rule-based classification (NOT AI)
- ✅ 6 categories: Newsletters (0.85), Notifications (0.80), Promotions (0.75), Receipts (0.80), Important (0.70), Old Emails (0.60)
- ✅ Confidence scoring
- ✅ Top senders analysis
- ✅ Sample messages per category

### Operations
- ✅ Dry-run preview: shows affected emails, risk assessment, batch estimate
- ✅ Execute archive: remove from INBOX (reversible via history)
- ✅ Execute label: add label to messages (reversible)
- ✅ Execute trash: move to trash (reversible for 30 days)
- ✅ Operation batching (500 per batch, prevents timeout)
- ✅ Protected emails: starred messages excluded by default
- ✅ Risk flagging: unread and recent (<7 days) emails flagged in preview

### Logging & Audit
- ✅ Immutable operation audit log stored in database
- ✅ View logs UI tab with operation history
- ✅ Tracks: operation type, timestamp, user, email_count, affected_labels, status, error_details

### Frontend UI
- ✅ Login page with OAuth initiate button
- ✅ Overview tab: message counts by category, sync button, report button
- ✅ Recommendations tab: category cards with confidence badges, top senders, samples
- ✅ Actions tab: category selector, action type picker, dry-run preview, execute button
- ✅ Logs tab: operation history table
- ✅ Session check: redirects to login if not authenticated

---

## Known Critical Issues

### 1. Approval Token Not Validated
**File:** `backend/src/routes.js` (POST /api/operation/execute)  
**Issue:** approvalToken parameter checked for presence but value never verified  
**Risk:** Any string passes as valid approval token; attackers could execute operations without legitimate user approval  
**Impact:** Approval workflow defeated  
**Status:** Exploitable in current form

### 2. Sessions Stored In-Memory Only
**File:** `backend/src/routes.js`  
**Issue:** Sessions stored in `Map()` object in Node process memory  
**Risk:** All user sessions lost on server restart  
**Impact:** Users must re-authenticate after any deployment  
**Status:** Confirmed limitation

### 3. Encryption Fallback Key
**File:** `backend/src/encryption.js`  
**Issue:** TOKEN_ENCRYPTION_KEY malformed → uses all-zeros fallback key `'0'.repeat(64)`  
**Risk:** Stored tokens not actually encrypted (zero key means predictable encryption)  
**Impact:** Tokens vulnerable if database breached  
**Status:** Currently working with proper 64-char hex key in .env, but fallback exists

---

## Known High-Priority Issues

### Missing Features
- ❌ Email deletion (Gmail API delete scope not requested)
- ❌ Undo/reversal capability (state machine scaffolded but not implemented)
- ❌ Data export (CSV/JSON)
- ❌ Frontend pagination (will hang on large result sets)
- ❌ Frontend search/filter
- ❌ Frontend responsive design

### Code Quality
- 🟡 Frontend monolithic: 510 lines in single Dashboard.js component
- 🟡 State management: React hooks only, no Redux/Zustand for complex state
- 🟡 Test coverage: <30%, critical paths untested
- 🟡 Documentation: 8+ overlapping summary files, no single source of truth

### Deployment Readiness
- ❌ No rate limiting on Gmail API calls
- ❌ No multi-user session handling
- ❌ No request validation middleware
- ❌ No startup environment validation
- ❌ Dialog/error UX: Uses native `alert()` (non-dismissible, ugly)

---

## API Endpoints (13 Total)

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| GET | /api/auth/init | Get OAuth URL | ✅ |
| GET | /api/auth/callback | Handle OAuth redirect | ✅ |
| POST | /api/auth/callback | Legacy callback handler | ✅ |
| POST | /api/auth/disconnect | Logout | ✅ |
| POST | /api/sync | Start email sync | ✅ |
| GET | /api/report | Generate category report | ✅ |
| POST | /api/operation/dryrun | Preview bulk operation | ✅ |
| POST | /api/operation/execute | Execute bulk operation | ⚠️ (No token validation) |
| GET | /api/logs | Fetch operation history | ✅ |
| GET | /health | Health check | ✅ |
| GET | /api/inbox/overview | Message counts | ✅ |
| POST | /api/sync/clear | Reset sync state | ✅ |

---

## File Structure

```
backend/
  src/
    server.js              Entry point (dotenv.config() at top)
    oauth.js               OAuth2 lazy-init, token exchange
    routes.js              13 API endpoints
    database.js            SQLite schema init
    encryption.js          AES-256-GCM token encryption
    sync.js                Email metadata fetch and store
    categorize.js          Rule-based categorization
    operations.js          Dry-run and execute handlers
    state-machine.js       UNUSED: 15-state FSM (dead code)
    token-service.js       Token refresh and validation
  tests/
    categorize.test.js     Categorization rule tests
    operations.test.js     Dry-run/execute tests
    state-machine.test.js  FSM transition tests
    token-service.test.js  Token refresh tests
    smoke.js               Basic integration test
  package.json
  jest.config.js

frontend/
  src/
    App.js                 Root component (minimal wrapper)
    index.js               React entry point
    components/
      Dashboard.js         ALL UI: 510 lines, 5 tabs, monolithic
      Dashboard.css        Basic styling
    services/
      api.js               Axios HTTP client, session header injection
  public/
    index.html             HTML template
  package.json

docs/
  design/
    gmail-inbox-cleanup.md
    gmail-inbox-cleanup-enterprise-v1.md

specs/
  gmail-inbox-cleanup.md
  gmail-inbox-cleanup-enterprise-v1.md

Root summaries: (REPLACE WITH THIS FILE)
  CHECKLIST.md
  CONSISTENCY_CLEANUP_APPLIED.md
  FINAL_IMPLEMENTATION_SUMMARY.md
  FINAL_SUMMARY.md
  IMPLEMENTATION_PLAN_V1.md
  IMPLEMENTATION_STATUS.md
  IMPLEMENTATION_VERIFIED.md
  IMPLEMENTATION.md
  SUMMARY.md
  STEP3_FINAL_SUMMARY.md
```

---

## Recent Changes (This Session)

**Issue:** OAuth2Client undefined on startup, causing "Cannot GET /api/auth/callback"

**Root Cause:** 
- `dotenv.config()` called in server.js AFTER route imports
- oauth.js tried to create OAuth2Client during import, before env vars loaded
- Routes didn't exist for POST /api/auth/callback

**Fixes Applied:**
1. Moved `dotenv.config()` to very first line of server.js (before all imports)
2. Refactored oauth.js to use lazy-initialization: `getOAuth2Client()` function creates client only when first called
3. Added GET /api/auth/callback handler that exchanges code, creates session, sends postMessage to popup
4. Updated frontend Dashboard.js to listen for postMessage from OAuth callback popup
5. Created backend/.env with real Google OAuth credentials and proper encryption key

**Verification:** 
- OAuth flow tested end-to-end in browser
- Tokens encrypt/decrypt correctly
- Email sync works after authentication
- All changes committed to git (hash: 85f627d)

---

## Testing Status

**Test Files Present:**
- backend/tests/categorize.test.js
- backend/tests/operations.test.js
- backend/tests/state-machine.test.js
- backend/tests/token-service.test.js
- backend/tests/smoke.js

**Coverage:** <30%  
**Critical Gaps:**
- OAuth callback flow
- Approval token validation
- Session creation and retrieval
- Token encryption/decryption
- Database schema constraints

**Run Tests:**
```bash
cd backend
npm test
```

---

## Recommended Next Phase

**Priority: Security & Persistence Hardening (v0.2)**

**Critical Fixes (6-8 hours):**
1. ✅ Validate approval tokens (add signature or timestamp verification)
2. ✅ Migrate sessions to SQLite (add session table, TTL, cleanup job)
3. ✅ Add request input validation middleware
4. ✅ Add startup environment variable validation
5. ✅ Remove encryption fallback key (fail hard if key malformed)

**After v0.2:** Consider undo capability, data export, frontend modularization

---

## Getting Started (Development)

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with real Google OAuth credentials

# Start servers
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm start

# Open browser
http://localhost:3000
```

---

## Notes

- **Production Ready?** No. v0.1 demo. Needs security fixes before any deployment.
- **Scale Testing?** Email sync logic written for 40,000+ but untested at scale.
- **Multi-User?** Not supported. In-memory sessions, no multi-tenant isolation.
- **Rate Limiting?** None. May hit Gmail API quota limits.
- **Browser Support?** OAuth callback via postMessage (Chrome/Firefox confirmed, Safari/Edge untested).

---

## Architecture Decisions

**Why postMessage for OAuth?** Popup-based OAuth redirect cannot access parent window context directly. postMessage allows callback window to communicate session data back to parent.

**Why lazy-init OAuth2Client?** Environment variables not available at require-time; lazy initialization ensures OAuth2Client created only after dotenv.config() completes.

**Why in-memory sessions?** Simple for MVP. SQLite move needed for production.

**Why rule-based not AI categorization?** Faster iteration, predictable behavior, no ML infrastructure required. AI version is future enhancement.

**Why no email deletion?** Gmail API requires explicit delete scope; chosen to be conservative and only request necessary permissions.
