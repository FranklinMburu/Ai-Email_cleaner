# Gmail Inbox Cleanup — Enterprise v1 Implementation Plan

**Status**: Ready for Implementation (March 6, 2026)  
**Spec**: `/docs/design/gmail-inbox-cleanup-enterprise-v1.md` + `/specs/gmail-inbox-cleanup-enterprise-v1.md`  
**Estimated Completion**: 2-3 weeks (80-100 hours)

---

## Phase Summary

| Phase | Component | Est. Hours | Status |
|-------|-----------|-----------|--------|
| 1 | Database Schema + Migration | 8 | Not Started |
| 2 | Token Service | 6 | Not Started |
| 3 | State Machine | 10 | Not Started |
| 4 | Policy Engine | 8 | Not Started |
| 5 | Execute/Undo Engine | 20 | Not Started |
| 6 | API Endpoints | 16 | Not Started |
| 7 | Frontend UI Components | 18 | Not Started |
| 8 | Test Suite | 20 | Not Started |
| 9 | Smoke Verification | 4 | Not Started |

**Total**: ~110 hours

---

## PHASE 1: Database Schema + Migration

### Deliverables
- [ ] 8 new tables created (SQLite)
- [ ] operations table modified (8 new columns)
- [ ] All indexes created
- [ ] Migration script (v0 → v1) tested
- [ ] Backward compatibility verified

### Tables to Create (with DDL from spec Section 3)
1. [ ] operation_snapshots
2. [ ] message_snapshots
3. [ ] message_execution_outcomes (NEW: with attempt_number for retry history)
4. [ ] approval_tokens (HARDENED: no raw tokens, only hashes)
5. [ ] event_log
6. [ ] batch_execution_log
7. [ ] undo_batch_execution_log
8. [ ] (operations table already exists; ALTER with 8 new columns)

### Files to Create/Modify
- [ ] `backend/src/database.js` — Add DDL for 8 tables + migration
- [ ] `backend/migrations/001-v0-to-v1.sql` — Migration script (safe ALTER TABLE + CREATE TABLE)
- [ ] Tests: `backend/tests/schema.test.js` — Verify schema created, indexes present, immutability enforced

### Implementation Notes
- **message_execution_outcomes**: UNIQUE constraint includes attempt_number; retries insert new rows, no UPDATE
- **approval_tokens**: Store only token_hash (SHA256) + token_last_four_chars; never store raw token_value
- **Immutability**: No UPDATE/DELETE on: operation_snapshots, message_snapshots, message_execution_outcomes, event_log, batch_execution_log, undo_batch_execution_log
- **Rollback Safety**: Migration script should allow rollback to v0 schema (if needed pre-production)

**Stop Condition**: `npm test` runs schema.test.js and all assertions pass; migration tested both directions.

---

## PHASE 2: Token Service

### Deliverables
- [ ] TokenService class (generate, validate, hash, store, expire)
- [ ] token_generate() returns raw token to client once
- [ ] token_validate() verifies SHA256(token) == token_hash
- [ ] token_expire() marks token used_at + one-time use
- [ ] Token expiry check (24-hour window)
- [ ] Tests: token generation, hashing, one-time use, expiry

### Functions to Implement
```javascript
// crypto/token-service.js
export class TokenService {
  static generate(operation_id, token_type, expires_in_hours = 24) 
    // Returns: { raw_token: string, token_hash: string, last_four: string }
  
  static validate(operation_id, token_type, raw_token)
    // Queries DB, computes SHA256(raw_token), compares to stored hash
    // Returns: { valid: bool, expires_at: datetime, used_at: datetime }
  
  static markUsed(operation_id, token_type, state_transition)
    // Updates approval_tokens set used_at = NOW(), used_by_state = state_transition
    // Prevents reuse by checking used_at on next validate()
}
```

### Files to Create/Modify
- [ ] `backend/src/crypto/token-service.js` — Core implementation
- [ ] `backend/src/crypto/crypto-utils.js` — SHA256 hash, secure random
- [ ] Tests: `backend/tests/token-service.test.js` — 10+ test cases

### Implementation Notes
- **Token Generation**: Use crypto.randomBytes(32) + base64url encoding; 43+ character tokens
- **Hash Storage**: SHA256 hash, indexed for lookup speed
- **One-Time Use**: Query approval_tokens; if used_at is not NULL, reject request
- **Expiry**: Compare expires_at to current time; reject if expired

**Stop Condition**: `npm test` runs token-service.test.js; all tests pass (generation, hashing, one-time use, expiry).

---

## PHASE 3: State Machine

### Deliverables
- [ ] OperationStateMachine class (15 states, transitions, invariants)
- [ ] All valid transitions implemented
- [ ] Invalid transitions blocked (return error)
- [ ] State transition validation (pre-conditions)
- [ ] Tests: 12+ transition tests covering all major paths

### States (from spec)
- PENDING_APPROVAL (initial)
- APPROVED
- EXECUTING
- COMPLETED
- COMPLETED_WITH_ERRORS
- UNDO_PENDING_APPROVAL
- UNDO_APPROVED
- UNDO_EXECUTING
- UNDONE
- CANCELLED (error)
- EXPIRED (error)
- EXECUTION_FAILED (error)
- UNDO_FAILED (error)

### Transitions & Guards
```
PENDING_APPROVAL → APPROVED (guard: approvalToken valid + not expired)
APPROVED → EXECUTING (guard: same)
EXECUTING → COMPLETED (guard: succeeded_count == affected_count)
EXECUTING → COMPLETED_WITH_ERRORS (guard: failed_count > 0 OR unknown_count > 0)
COMPLETED → UNDO_PENDING_APPROVAL (guard: undo request)
UNDO_PENDING_APPROVAL → UNDO_APPROVED (guard: undoApprovalToken valid)
UNDO_APPROVED → UNDO_EXECUTING (guard: same)
UNDO_EXECUTING → UNDONE (guard: undo completed)
(Any) → CANCELLED (guard: user cancels)
(Any) → EXPIRED (guard: operation > 24 hours old)
EXECUTING → EXECUTION_FAILED (guard: API error)
UNDO_EXECUTING → UNDO_FAILED (guard: API error)
```

### Files to Create/Modify
- [ ] `backend/src/state-machine.js` — Core state machine logic
- [ ] Tests: `backend/tests/state-machine.test.js` — 12+ transition tests + E2E 15-state test

### Implementation Notes
- **Database Persistence**: Read/write state from operations.status column
- **Transition Validation**: Check pre-conditions before updating DB; atomic transaction
- **Terminal States**: CANCELLED, EXPIRED, EXECUTION_FAILED, UNDO_FAILED, UNDONE (no further transitions)
- **Idempotency**: Repeated state transition request returns current state (no error)

**Stop Condition**: `npm test` runs state-machine.test.js; all 12+ transition tests pass + E2E 15-state test passes.

---

## PHASE 4: Policy Engine

### Deliverables
- [ ] PolicyEngine class (configurable rules, default enterprise policy)
- [ ] message evaluation (per-message filtering)
- [ ] batch filtering (sorted excluded messages)
- [ ] Policy snapshot (store applied policy immutably)
- [ ] Tests: 5+ test cases (starred, important, unread, recent, batch)

### Default Enterprise Policy
```json
{
  "exclude_starred": true,
  "exclude_important": true,
  "exclude_unread": true,
  "exclude_recent_days": 7,
  "custom_rules": []
}
```

### Methods to Implement
```javascript
// policy/policy-engine.js
export class PolicyEngine {
  constructor(policy_config) // Takes policy object with above shape
  
  evaluateMessage(message)
    // Returns: { included: bool, reason: string }
    // reason = "STARRED" | "IMPORTANT" | "UNREAD" | "RECENT_7" | "" (pass)
  
  filterMessages(messages)
    // Returns: { included: Message[], excluded: {message, reason}[] }
  
  getPolicySnapshot()
    // Returns: JSON-serializable policy object for storage
}
```

### Files to Create/Modify
- [ ] `backend/src/policy/policy-engine.js` — Core implementation
- [ ] Tests: `backend/tests/policy-engine.test.js` — 5+ test cases

### Implementation Notes
- **recent_days Calculation**: internal_date_ms vs NOW(); exclude if < N days old
- **Label Checking**: "STARRED" label presence; "IMPORTANT" label presence
- **Unread Flag**: is_unread boolean field
- **Custom Rules**: Extensible array for enterprise-specific exclusions (future use)

**Stop Condition**: `npm test` runs policy-engine.test.js; all 5+ tests pass (starred, important, unread, recent, batch filtering).

---

## PHASE 5: Execute/Undo Engine

### Deliverables
- [ ] ExecutionEngine class (dry-run, execute, batch processing, per-message outcomes)
- [ ] UndoEngine class (undo dry-run, undo execute, conflict detection, restoration)
- [ ] Per-message outcome tracking (message_execution_outcomes with attempt_number)
- [ ] Retry logic (FAILED messages eligible, UNKNOWN blocked)
- [ ] Conflict detection logic
- [ ] Tests: 10+ integration tests (dry-run, execute, partial failures, undo, conflicts, idempotence)

### ExecutionEngine

```javascript
export class ExecutionEngine {
  async dryRun(operation_id, operation_type, category_ids, policy_config)
    // 1. Fetch messages from DB matching categories
    // 2. Apply policy filter
    // 3. Create operation_snapshot + message_snapshots (immutable)
    // 4. Return: { affected_count, protected_excluded, policy_excluded, samples, approval_token }
  
  async execute(operation_id, approval_token)
    // 1. Validate token, mark state EXECUTING
    // 2. Batch messages (500 per batch)
    // 3. Call Gmail API for each batch
    // 4. Record outcomes in message_execution_outcomes (attempt_number=1)
    // 5. Return: { succeeded_count, failed_count, unknown_count, status }
  
  async retryFailed(operation_id)
    // 1. Query message_execution_outcomes where status=FAILED
    // 2. Re-attempt with incremented attempt_number
    // 3. Record new outcomes
    // 4. Return: { succeeded_count, failed_count }
}
```

### UndoEngine

```javascript
export class UndoEngine {
  async undoDryRun(operation_id)
    // 1. Fetch operation_snapshot + message_snapshots
    // 2. Preview restoration (don't call Gmail API yet)
    // 3. Return: { affected_count, restoration_samples, undo_approval_token }
  
  async undoExecute(operation_id, undo_approval_token)
    // 1. Validate token, mark state UNDO_EXECUTING
    // 2. For each batch:
    //    a. Fetch current labels from Gmail (conflict detection)
    //    b. Compute expected_labels from message_snapshots.original_labels + operation semantics
    //    c. If conflict detected: mark message_execution_outcomes status=UNKNOWN, log event
    //    d. Otherwise: apply restoration labels to Gmail API
    // 3. Record outcomes in message_execution_outcomes (phase=UNDO, attempt_number=1)
    // 4. Return: { succeeded_count, failed_count, unknown_count, conflict_count }
}

// Helper: Conflict detection
function detectConflictForMessage(message_id, expected_labels, actual_labels)
  // Returns: { conflict_detected: bool, conflict_reason: string }
  // Reason: "labels_differ", "message_deleted", "unexpected_state"

// Helper: Apply operation semantics for expected state
function applyOperationSemantics(original_labels, operation_type, operation_params)
  // operation_type: ARCHIVE | LABEL | TRASH
  // Returns: expected_labels (JSON array)
  // ARCHIVE: removes INBOX, keeps other labels (not in TRASH)
  // LABEL: adds operation_params.label_id/label_name
  // TRASH: adds TRASH label
```

### Files to Create/Modify
- [ ] `backend/src/engines/execution-engine.js` — Execute + retry logic
- [ ] `backend/src/engines/undo-engine.js` — Undo + conflict detection
- [ ] `backend/src/engines/operation-semantics.js` — applyOperationSemantics() function
- [ ] Tests: `backend/tests/execution-engine.test.js`, `backend/tests/undo-engine.test.js`, `backend/tests/conflict-detection.test.js`

### Implementation Notes
- **No PENDING Rows**: Don't preinsert outcome rows; only insert when outcome determined
- **attempt_number**: Auto-increment on retry; retries create new rows with same (op, msg, phase, batch) but different attempt_number
- **expected_labels Derivation**: MUST use message_snapshots.original_labels, NEVER operation_snapshots samples
- **Immutability**: All outcome rows INSERT-only, never UPDATE
- **Rate Limiting**: Implement exponential backoff for Gmail API (429, 500, 503)

**Stop Condition**: Integration tests pass (10+ cases): dry-run, execute, partial failure, undo, conflict detection, idempotence, retry logic.

---

## PHASE 6: API Endpoints

### Deliverables
- [ ] 8 API endpoints (5 new, 3 modified)
- [ ] Request/response validation
- [ ] Event context schema validation
- [ ] Error handling + detailed error messages
- [ ] Token handling (return raw token once, accept hash on subsequent requests)
- [ ] Tests: API integration tests (request/response examples from spec)

### Endpoints

1. **POST /api/operation/dryrun** (MODIFIED)
   - Request: operationType, categories, policyOverrides
   - Response: operationId, affected_count, samples, approvalToken, tokenPreview
   - Handler: Create operation_snapshot, message_snapshots; generate approval token

2. **POST /api/operation/approve** (NEW)
   - Request: operationId, approvalToken (raw)
   - Response: operationId, status=approved, approvedAt
   - Handler: Validate token hash, transition state PENDING_APPROVAL → APPROVED

3. **POST /api/operation/execute** (MODIFIED)
   - Request: operationId, approvalToken (raw)
   - Response: progress updates (streaming/polling), final: succeeded, failed, unknown counts
   - Handler: ExecutionEngine.execute(), emit progress events, record outcomes

4. **POST /api/operation/undo-dryrun** (NEW)
   - Request: operationId
   - Response: operationId, undoPreview, restorationSamples, undoApprovalToken, tokenPreview
   - Handler: Fetch message_snapshots, preview restoration

5. **POST /api/operation/approve-undo** (NEW)
   - Request: operationId, undoApprovalToken (raw)
   - Response: operationId, undoStatus=undo_approved, undoApprovedAt
   - Handler: Validate undo token hash, transition state UNDO_PENDING_APPROVAL → UNDO_APPROVED

6. **POST /api/operation/undo-execute** (NEW)
   - Request: operationId, undoApprovalToken (raw)
   - Response: progress updates, final: succeeded, failed, unknown, conflict counts
   - Handler: UndoEngine.undoExecute(), conflict detection, emit events, record outcomes

7. **GET /api/operation/{id}** (NEW)
   - Response: Full operation state (status, snapshots, execution details, undo availability)
   - Handler: Fetch from operations + snapshots tables

8. **GET /api/events** (NEW)
   - Query: operationId, eventType, limit
   - Response: Array of event objects with context per event_type schema
   - Handler: Query event_log, apply filters

### Files to Create/Modify
- [ ] `backend/src/routes.js` — Add 5 new endpoints, modify 3 existing
- [ ] Tests: `backend/tests/api-endpoints.test.js` — 8+ test cases (request/response examples from spec)

### Implementation Notes
- **Token Handling**: Generate returns raw token; subsequent requests validate raw token via hash comparison
- **Error Handling**: Return 400 for invalid tokens, 403 for expired, 409 for invalid state transitions
- **Event Emission**: Emit events for every state transition and batch event
- **Streaming Response**: execute/undo-execute can stream progress updates (chunked responses or WebSocket)

**Stop Condition**: API integration tests pass (8+ cases); endpoints return correct JSON with event context schemas.

---

## PHASE 7: Frontend UI Components

### Deliverables
- [ ] 5 new components (OperationDetail, UndoDialog, OperationTimeline, ConflictResolver, EventLogView)
- [ ] 2 modified components (Dashboard with Operations tab, ApprovalFlow split into Execute/Undo)
- [ ] State management (track operation status, approval tokens, event stream)
- [ ] Conflict resolution UI (show expected vs actual labels, manual intervention option)
- [ ] Tests: Component unit tests (render checks, state transitions)

### New Components

1. **OperationDetail.js**
   - Display full operation lifecycle (15-state progress visual)
   - Show operation type, affected count, policy applied
   - Show execution progress (X of Y batches, X succeeded/failed)
   - Show undo availability + undo approval button
   - Link to EventLogView for detailed events

2. **UndoDialog.js**
   - Modal: "Restore X messages?"
   - Show restoration preview (sample messages)
   - "Approve Undo" button (generates undo_approval_token)
   - Display conflicts if any (show expected vs actual labels)

3. **OperationTimeline.js**
   - Visual timeline of operation lifecycle
   - Milestones: DRY_RUN → APPROVED → EXECUTING → COMPLETED → UNDO_PENDING → UNDONE
   - Timestamps + event references

4. **ConflictResolver.js**
   - Show list of conflicted messages (status=UNKNOWN from undo)
   - For each: message_id, expected_labels, actual_labels, conflict_reason
   - Options: "Skip this message" or "Retry undo for this message"

5. **EventLogView.js**
   - Table/list of events for operation
   - Columns: timestamp, event_type, status, context
   - Filters: by event_type, by date range
   - Copy-to-clipboard for context JSON (debugging)

### Modified Components

1. **Dashboard.js**
   - Add "Operations" tab (list all operations with status)
   - For each: operation type, affected count, status badge, progress bar
   - "View Details" → OperationDetail component

2. **ApprovalFlow.js**
   - Split into ApproveExecute.js + ApproveUndo.js
   - Different token types, different UI flows
   - Show token preview (last 4 chars, expiry)

### Files to Create/Modify
- [ ] `frontend/src/components/OperationDetail.js` (NEW)
- [ ] `frontend/src/components/UndoDialog.js` (NEW)
- [ ] `frontend/src/components/OperationTimeline.js` (NEW)
- [ ] `frontend/src/components/ConflictResolver.js` (NEW)
- [ ] `frontend/src/components/EventLogView.js` (NEW)
- [ ] `frontend/src/components/Dashboard.js` (MODIFIED: add Operations tab)
- [ ] `frontend/src/components/ApproveExecute.js` (NEW: split from ApprovalFlow)
- [ ] `frontend/src/components/ApproveUndo.js` (NEW: split from ApprovalFlow)
- [ ] Tests: `frontend/tests/components/*.test.js` (unit tests for each component)

### Implementation Notes
- **State Management**: Use React hooks (useState, useEffect) or Redux for operation state, event stream
- **Real-time Updates**: Fetch events periodically (poll every 1-2 seconds during execution) or use WebSocket
- **Conflict Display**: Two-column layout: expected labels vs actual labels, color-coded diff
- **Token Preview**: Display last 4 characters + expiry time; don't expose full token in UI

**Stop Condition**: Component tests pass; UI renders correctly with mocked operation states; manual UI testing verifies all interactions.

---

## PHASE 8: Test Suite (66+ Tests)

### Unit Tests (40+ tests)
- [ ] policy-engine.test.js (5 tests: starred, important, unread, recent, batch)
- [ ] state-machine.test.js (12 tests: all major transitions + E2E 15-state)
- [ ] token-service.test.js (8 tests: generate, hash, one-time use, expiry, validation)
- [ ] message-execution.test.js (5 tests: SUCCEEDED/FAILED/UNKNOWN status, attempt tracking)
- [ ] schema.test.js (5 tests: tables created, indexes, immutability, foreign keys)

### Integration Tests (25+ tests)
- [ ] execution-engine.test.js (7 tests: dry-run, execute, partial failure, retry)
- [ ] undo-engine.test.js (6 tests: undo dry-run, undo execute, conflicts, restoration)
- [ ] conflict-detection.test.js (6 tests: no conflict, conflict detected, message deleted, expected vs actual)
- [ ] event-log.test.js (4 tests: event creation, immutability, context schemas, filtering)
- [ ] idempotence.test.js (4 tests: batch idempotence, duplicate batch handling, retry safety)

### E2E Test (1 test)
- [ ] state-machine-e2e.test.js
  - Full 15-state operation lifecycle
  - Execute with partial failure
  - Undo with conflict detection + recovery
  - Verify snapshots, outcomes, events all created correctly

### Test Framework
- **Framework**: Jest
- **Mocking**: Mock Gmail API (success, 429, 500, 403, 404 errors)
- **Database**: SQLite in-memory for unit/integration tests
- **Coverage Target**: >80% code coverage

### Files to Create/Modify
- [ ] `backend/tests/policy-engine.test.js` (5 tests)
- [ ] `backend/tests/state-machine.test.js` (12 tests)
- [ ] `backend/tests/token-service.test.js` (8 tests)
- [ ] `backend/tests/message-execution.test.js` (5 tests)
- [ ] `backend/tests/schema.test.js` (5 tests)
- [ ] `backend/tests/execution-engine.test.js` (7 tests)
- [ ] `backend/tests/undo-engine.test.js` (6 tests)
- [ ] `backend/tests/conflict-detection.test.js` (6 tests)
- [ ] `backend/tests/event-log.test.js` (4 tests)
- [ ] `backend/tests/idempotence.test.js` (4 tests)
- [ ] `backend/tests/state-machine-e2e.test.js` (1 test)
- [ ] Frontend component tests (10+ tests for UI components)

### Test Execution

```bash
# Run all tests
npm test

# Expected output:
# 66+ tests
# Duration: ~15-30 seconds
# Coverage: >80%
# All assertions passing
```

**Stop Condition**: `npm test` runs all 66+ tests; all pass; coverage >80%; no warnings.

---

## PHASE 9: Smoke Verification

### Deliverables
- [ ] Full end-to-end workflow test (manual + automated)
- [ ] All 8 hard invariants verified
- [ ] No security warnings
- [ ] Code linting clean
- [ ] Database migration tested (v0 → v1 → rollback)

### Smoke Test Checklist

```
1. ✅ Database
   - All 8 tables created
   - v0 data migrated safely
   - Indexes present
   - Foreign keys enforced

2. ✅ Operation Lifecycle
   - DRY_RUN creates operation_snapshot + message_snapshots
   - APPROVE generates approval_token (raw returned once)
   - EXECUTE runs batches, creates message_execution_outcomes (status=SUCCEEDED|FAILED)
   - COMPLETED → UNDO_PENDING_APPROVAL
   - UNDO_APPROVE generates undo_approval_token
   - UNDO_EXECUTE restores from snapshots, detects conflicts
   - UNDONE is terminal

3. ✅ Snapshots & Restoration
   - message_snapshots captured during dry-run (immutable)
   - Undo restoration uses message_snapshots (not operation_snapshots)
   - Original labels preserved exactly

4. ✅ Per-Message Tracking
   - message_execution_outcomes records every message
   - Retries increment attempt_number (new rows, not UPDATE)
   - Status: SUCCEEDED | FAILED | UNKNOWN

5. ✅ Conflict Detection
   - UNKNOWN status for conflicted messages (not auto-retried)
   - Event log shows expected vs actual labels
   - UI displays conflicts to user

6. ✅ Token Security
   - Raw tokens never stored in DB
   - Only token_hash stored (SHA256)
   - One-time use enforced
   - 24-hour expiry enforced

7. ✅ Hard Invariants (all 8)
   - No destructive action without approval token
   - Every reversible operation supports undo
   - Undo requires separate token
   - Protected messages excluded (starred, important, unread, recent)
   - Pre-operation snapshots required
   - All executions audited (event_log)
   - Execution idempotent (message_execution_outcomes with attempt_number)
   - Undo conflicts safely handled (UNKNOWN status)

8. ✅ Code Quality
   - npm run lint → 0 errors
   - npm test → 66+ tests pass
   - npm run format → applied
   - Security audit → no warnings
   - Database constraints → enforced (no missing FKs, etc.)

9. ✅ Documentation
   - Design doc updated with architectural corrections
   - Spec updated with all clarifications
   - API reference complete
   - Schema diagram available
   - Implementation notes in code comments
```

### Files to Create/Modify
- [ ] `backend/tests/smoke.test.js` — One comprehensive E2E test covering all above
- [ ] `docs/SMOKE_TEST_RESULTS.md` — Document results + timestamps

### Test Execution

```bash
npm test backend/tests/smoke.test.js

# Expected output:
# ✅ Full operation lifecycle (dry-run → execute → undo → restore)
# ✅ Partial failure detected + handled
# ✅ Conflict detected + marked UNKNOWN
# ✅ All invariants enforced
# ✅ No security issues
# ✅ Code clean (lint), tests pass, coverage good
```

**Stop Condition**: Smoke test passes; all 8 invariants verified in code + tests; no warnings/errors.

---

## CRITICAL RULES FOR IMPLEMENTATION

### Schema & Immutability

1. **message_execution_outcomes ONLY**:
   - UNIQUE key must include attempt_number: `UNIQUE(operation_id, message_id, phase, batch_number, attempt_number)`
   - Retries create new rows with incremented attempt_number (NO UPDATE)
   - Only SUCCEEDED | FAILED | UNKNOWN statuses stored (NO PENDING placeholders)
   - Full attempt history preserved in DB

2. **Undo Conflict Detection**:
   - `expected_labels` MUST be derived from `message_snapshots.original_labels` + operation semantics
   - NEVER use `operation_snapshots.affected_messages` for expected state
   - Query Gmail API before undo to get `actual_labels`
   - If mismatch: status=UNKNOWN (not FAILED), log event, skip restoration

3. **Token Storage**:
   - NEVER store `token_value` (raw token) in DB
   - Only store `token_hash` (SHA256) + `token_last_four_chars`
   - Return raw token to client ONCE in response
   - Validate by computing SHA256(raw_token) == token_hash

### Code Organization

```
backend/src/
  database.js — Schema DDL, migrations
  crypto/
    token-service.js — Token generation, validation, hashing
    crypto-utils.js — SHA256, secure random
  state-machine.js — 15 states, transitions, guards
  policy/
    policy-engine.js — Configurable rules, filtering
  engines/
    execution-engine.js — Dry-run, execute, retry
    undo-engine.js — Undo dry-run, undo execute, conflict detection
    operation-semantics.js — applyOperationSemantics(original_labels, op_type, params)
  routes.js — 8 API endpoints (5 new, 3 modified)

backend/tests/
  schema.test.js
  token-service.test.js
  state-machine.test.js
  policy-engine.test.js
  message-execution.test.js
  execution-engine.test.js
  undo-engine.test.js
  conflict-detection.test.js
  event-log.test.js
  idempotence.test.js
  state-machine-e2e.test.js
  smoke.test.js

frontend/src/components/
  OperationDetail.js (NEW)
  UndoDialog.js (NEW)
  OperationTimeline.js (NEW)
  ConflictResolver.js (NEW)
  EventLogView.js (NEW)
  ApproveExecute.js (NEW; split from ApprovalFlow)
  ApproveUndo.js (NEW; split from ApprovalFlow)
  Dashboard.js (MODIFIED)
```

### Testing Standards

- Unit tests: At least 40+ tests
- Integration tests: At least 25+ tests
- E2E tests: At least 1 full state machine test
- Coverage: >80% code coverage
- All invariants tested in at least one test case
- Mocking: Gmail API errors (429, 500, 403, 404)

### Success Metrics

- [ ] All 66+ tests passing
- [ ] Code coverage >80%
- [ ] npm run lint → 0 errors
- [ ] npm run format applied
- [ ] All 8 hard invariants enforced in code
- [ ] No security warnings
- [ ] Database migration tested both directions
- [ ] Smoke test passes (full 15-state E2E)
- [ ] Schema matches spec DDL exactly

---

## References

- **Design Doc**: `/home/franklin/ulg/Ai-Email_cleaner/docs/design/gmail-inbox-cleanup-enterprise-v1.md`
- **Specification**: `/home/franklin/ulg/Ai-Email_cleaner/specs/gmail-inbox-cleanup-enterprise-v1.md`
- **v0 Code**: `/home/franklin/ulg/Ai-Email_cleaner/backend/src/`, `/home/franklin/ulg/Ai-Email_cleaner/frontend/src/`

---

**Status**: Ready to begin PHASE 1 (Database Schema + Migration)
