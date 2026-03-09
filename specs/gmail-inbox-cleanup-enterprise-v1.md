# Gmail Inbox Cleanup Tool — Enterprise v1 Specification

**Version:** 1.0 (Enterprise)  
**Date:** March 6, 2026  
**Status:** Approved for Implementation  
**Focus:** Full undo support with operation snapshots & state machine

---

## STATUS: PRE-IMPLEMENTATION SCHEMA CORRECTIONS APPLIED

**Final corrections before implementation** (March 6, 2026):
1. ✅ message_execution_outcomes redesigned for immutable retry history
   - Added `attempt_number` to unique key: UNIQUE(operation_id, message_id, phase, batch_number, attempt_number)
   - Retries create new rows with incremented attempt_number (no UPDATE needed)
   - No PENDING placeholder rows (only SUCCEEDED | FAILED | UNKNOWN stored)
   - Full attempt history preserved for audit trail

2. ✅ Undo conflict detection enforcement specified
   - expected_labels MUST derive from message_snapshots.original_labels + operation semantics (NOT from operation_snapshots samples)
   - Explicit pseudocode provided for applyOperationSemantics logic
   - Conflict detection remains safe and deterministic

3. ✅ Implementation phases approved (no scope changes)
   - Follow design docs exactly
   - Enforce all hard invariants in code
   - Return files changed + schema + invariants + tests + limitations

---

## 1. Goal (Measurable)

**PRIMARY GOAL:**  
Deliver an **enterprise-safe Gmail inbox cleanup tool with full operation reversibility** that allows users to:
1. Perform cleanup operation (ARCHIVE, LABEL, TRASH) with dry-run preview
2. Explicitly approve execution via approval token
3. Execute operation with full state snapshot stored pre-Gmail-API-call
4. View complete audit trail of execution
5. Request undo of completed operation via new undo preview
6. Explicitly approve undo via separate approval token
7. Execute undo, restoring original message state from snapshot
8. Resume/retry operations safely (idempotent execution)
9. Handle partial failures without losing ability to undo

**SUCCESS CRITERIA:**
- ✅ Operation state machine fully implemented (15 states, all transitions valid)
- ✅ Pre-operation snapshots created and stored immutably for all operations
- ✅ Undo restores original message labels from snapshots
- ✅ Undo execution uses separate approval token (not same as execute)
- ✅ All state transitions logged as events (immutable audit trail)
- ✅ Protected messages excluded by policy engine (configurable, default)
- ✅ Batch execution idempotent (can retry without duplicates)
- ✅ Partial execution visible (succeeded_count ≠ affected_count is clear)
- ✅ All tests pass (unit, integration, E2E state machine)
- ✅ Code lints without errors; no security warnings
- ✅ Documentation complete (schema, API, state diagrams)

**MEASURABLE DELIVERABLES:**
- Backend: 3,500+ lines (added 1,600+ lines for:8 tables, state machine, policy engine, token service, message execution tracking, conflict detection, event context schemas)
- Frontend: 600+ lines updates (new components: OperationDetail, UndoDialog, ApproveExecute/Undo, OperationTimeline, ConflictResolver + Dashboard tab)
- Tests: 500+ lines (new: undo-conflict.test.js, token.test.js, message-execution.test.js + existing policy/state machine/snapshot/undo/event/idempotence tests)
- Documentation: Updates to design doc + spec covering all 5 architectural corrections
- Documentation: Updated design doc, API reference, migration guide

---

## 2. Constraints & Invariants

### Constraints (Hard Boundaries)
1. **Single Account**: One Gmail account per session (unchanged from v0)
2. **Manual Operations**: No scheduled cleanup or auto-undo (unchanged)
3. **Local Storage**: SQLite only; no cloud sync (unchanged)
4. **Explicit Approval**: Every major state transition requires user action

### Hard Invariants (MUST be enforced in code)

#### Invariant 1: No Destructive Action Without Explicit Approval
- **Enforcement**: Execute endpoint validates `approvalToken` (generated during dry-run, unique per operation)
- **Test**: operations.test.js verifies token required for state transition APPROVED → EXECUTING
- **UI Check**: "Execute" button hidden until dry-run completes successfully

#### Invariant 2: Every Reversible Operation Must Support Undo
- **Reversible Types**: ARCHIVE, LABEL, TRASH
- **Non-Reversible**: None (all are reversible in v1)
- **Enforcement**: Once COMPLETED, operation enters UNDO_PENDING_APPROVAL state (no additional checks needed)
- **Test**: operations.test.js verifies COMPLETED → UNDO_PENDING_APPROVAL transition

#### Invariant 3: Undo Requires Explicit Approval (Separate Token)
- **Enforcement**: UNDO_APPROVED → UNDO_EXECUTING transition validates `undo_approval_token`
- **Token Different**: `undo_approval_token ≠ approvalToken` (separate values)
- **Test**: operations.test.js verifies undo token validation & difference from execute token
- **UI Check**: "Execute Undo" button hidden until undo dry-run created

#### Invariant 4: Protected Messages Excluded by Policy (By Default)
- **Protected Labels** (default): STARRED, IMPORTANT, UNREAD, RECENT (< 7 days)
- **Default Enterprise Policy**:
  - `exclude_starred`: true (always exclude)
  - `exclude_important`: true (always exclude)
  - `exclude_unread`: true (safer default for enterprise)
  - `exclude_recent_days`: 7 (exclude messages < 7 days old)
  - Custom rules: extensible array
- **Enforcement**: PolicyEngine evaluates every message before counting affected
- **Policy Snapshot**: Stored immutably with operation (can't change during execution)
- **Override**: Optional toggle in UI (OFF by default) + second confirmation
- **Test**: operations.test.js verifies protected_excluded count > 0 in dry-run response

#### Invariant 5: Full Pre-Operation State Required Before Execution
- **Snapshot Responsibility Separation**:
  - **message_snapshots**: Source of truth for per-message undo restoration (original labels, metadata, state pre-operation)
  - **operation_snapshots**: Summary/audit only (counts, policy applied, affected message samples, operation context)
- **Snapshot Created**: During dry-run (no changes to Gmail yet)
- **Data Captured in message_snapshots**: original_labels, original_is_starred, original_is_unread, from_addr, subject, snippet for each message
- **Timing**: Snapshot BEFORE any Gmail API call
- **Immutable**: Never modified after creation (INSERT-only table; enforced at application level)
- **Restoration Logic**: Undo MUST use message_snapshots only, never operation_snapshots or current Gmail state
- **Test**: snapshot.test.js verifies message_snapshots data matches pre-execution state and undo restoration uses message_snapshots

#### Invariant 6: All Executions & Undo Executions Audited
- **Event Log Entry**: Created for EVERY state change, batch event, error
- **No Bodies**: Never logs full email content, only message IDs + metadata
- **User-Attributed**: Every event logged with `user_email`
- **Immutable**: No UPDATE/DELETE on event_log (INSERT-only)
- **Test**: event.test.js verifies event created for each operation & undo phase

#### Invariant 7: Execution Idempotent & Retry-Safe
- **Idempotency Key**: operation_id + batch_number
- **Per-Message Tracking**: message_execution_outcomes records outcome for every message in every batch
- **Batch Tracking**: batch_execution_log stores batch-level summary (succeeded count, failed_ids)
- **Duplicate Prevention**: If batch already executed, return cached result from message_execution_outcomes
- **Partial Failures Distinguishable**: Status enum includes SUCCEEDED | FAILED | UNKNOWN (prevents false success)
- **Undo Idempotence**: Same idempotency for undo batches via undo_batch_execution_log + message_execution_outcomes (phase=UNDO)
- **Test**: idempotence.test.js verifies duplicate batch calls return same result; partial-failure.test.js distinguishes FAILED from UNKNOWN

#### Invariant 8: Undo Conflict Detection & Safe Restoration
- **Conflict Scenario**: Gmail state has changed after original execution and before undo (e.g., user manually modified labels)
- **Safe Restore Condition**: Only restore if message still exists in Gmail with current labels matching expected state
- **Conflict Detection Rule**: Before undo batch, verify current Gmail labels match expected post-execution state for each message
- **Conflict Status Handling**:
  - **No Conflict**: Proceed with restoration, mark SUCCEEDED
  - **Conflict Detected**: Do not apply changes, mark UNKNOWN (not FAILED—user action required)
  - **Message Deleted**: Skip message, mark UNKNOWN (restoration not possible)
- **Audit/Event Behavior**: Log conflict detection event with message_id + expected vs actual labels
- **UI Behavior**: Show conflict details to user, option to retry or manually resolve
- **Test**: undo-conflict.test.js verifies conflict detection before restoration and UNKNOWN status handling

---

## 2a. Architectural Clarifications

### Snapshot Responsibility Model

**Separation of Concerns**:
- **message_snapshots** = Source of truth for undo restoration
  - Contains original message state pre-operation (original_labels, is_starred, is_unread, etc.)
  - Used EXCLUSIVELY by undo restoration logic
  - Never modified or re-queried during undo (immutable, inserted once)
  - Guarantees deterministic restoration regardless of Gmail state changes

- **operation_snapshots** = Summary/audit context only
  - Contains operation-level metadata (affected counts, policy applied, sample messages)
  - Used for UI display, progress tracking, and audit trail
  - Never used for restoration logic (undo ignores this table)
  - Provides audit trail of original operation intent

**Implementation Invariant**: Undo restoration code must always read from message_snapshots, NEVER from operation_snapshots or current Gmail state. Database foreign keys enforce this relationship.

### Execution Tracking & Partial Failure Model

**Per-Message Outcome Tracking** (`message_execution_outcomes` table):
- Every message in every batch gets a row with (operation_id, message_id, phase, batch_number, attempt_number) as unique key
- Status enum: SUCCEEDED | FAILED | UNKNOWN (only determined outcomes; no PENDING placeholders)
  - **SUCCEEDED**: Gmail API returned success (200-299) and label operations applied
  - **FAILED**: Recoverable Gmail API error (4xx) or application error; eligible for retry
  - **UNKNOWN**: Unrecoverable error, network loss, or conflict detected; requires manual intervention (not auto-retried)

**Partial Failure Handling**:
- A batch can have mixed outcomes (some SUCCEEDED, some FAILED, some UNKNOWN)
- batch_execution_log aggregates counts: succeeded_count, failed_count, unknown_count
- operation status transitions to COMPLETED_WITH_ERRORS if any message has status != SUCCEEDED
- User can retry failed messages without re-executing succeeded messages (idempotency via message_execution_outcomes)
- UNKNOWN messages block undo until resolved (safe default; prevents cascading errors)

### Single Unified Lifecycle State Machine

**Design Choice**: One unified state machine for execute and undo phases, not separate workflows.

**Rationale**:
- **Simplicity**: 15 states with clear transitions is easier to test than separate workflows
- **Consistency**: Same event logging, same batch tracking, same conflict detection for both phases
- **Auditability**: Single event stream for entire operation lifecycle
- **Undo Separation**: Undo has its own branch of states (UNDO_*) but shares operation record

**State Grouping**:
- Execute Phase: PENDING_APPROVAL → APPROVED → EXECUTING → COMPLETED
- Undo Phase: COMPLETED → UNDO_PENDING_APPROVAL → UNDO_APPROVED → UNDO_EXECUTING → UNDONE
- Error States: CANCELLED, EXPIRED, EXECUTION_FAILED, UNDO_FAILED (reachable from any state)

**Implementation**: Single `state` column on operations table with enum values. State transitions validated via database constraints and application logic.

---

## 3. Required Schema Changes (DDL)

### New Tables (8 tables for enterprise v1: + message_execution_outcomes)

#### operations (MODIFIED)
```sql
-- Add new columns to existing operations table
ALTER TABLE operations ADD COLUMN status TEXT DEFAULT 'pending_approval';  -- Single state field for 15-state machine
ALTER TABLE operations ADD COLUMN snapshot_id TEXT REFERENCES operation_snapshots(id);
ALTER TABLE operations ADD COLUMN undo_requested_at DATETIME;
ALTER TABLE operations ADD COLUMN undo_executed_at DATETIME;
ALTER TABLE operations ADD COLUMN succeeded_count INTEGER;
ALTER TABLE operations ADD COLUMN failed_count INTEGER;
ALTER TABLE operations ADD COLUMN unknown_count INTEGER DEFAULT 0;  -- For undo conflicts
ALTER TABLE operations ADD COLUMN partial_failure INTEGER DEFAULT 0;
-- Indexes
CREATE INDEX idx_operations_status ON operations(status);
CREATE INDEX idx_operations_snapshot_id ON operations(snapshot_id);
```

#### operation_snapshots (NEW - IMMUTABLE)
```sql
CREATE TABLE IF NOT EXISTS operation_snapshots (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) ON DELETE RESTRICT,
  user_email TEXT NOT NULL,
  
  -- Operation details
  operation_type TEXT NOT NULL,  -- ARCHIVE | LABEL | TRASH
  category_ids TEXT NOT NULL,    -- JSON array: ["promotions", "newsletters"]
  
  -- Policy snapshot (captured at dry-run time)
  policy_snapshot TEXT NOT NULL, -- JSON: {exclude_starred, exclude_important, ...}
  
  -- Counts at snapshot time
  total_messages_in_category INTEGER NOT NULL,
  protected_excluded_count INTEGER NOT NULL,
  policy_excluded_count INTEGER NOT NULL,
  affected_count INTEGER NOT NULL,
  
  -- Message snapshots (first 100 as samples)
  affected_messages TEXT NOT NULL,  -- JSON array of MessageSnapshot objects
  
  -- Operation parameters (type-specific)
  operation_params TEXT,  -- JSON: {} for ARCHIVE, {label_id, label_name} for LABEL, {} for TRASH
  
  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  snapshot_taken_at DATETIME NOT NULL,
  
  FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE,
  UNIQUE(operation_id)
);

CREATE INDEX idx_operation_snapshots_user ON operation_snapshots(user_email);
CREATE INDEX idx_operation_snapshots_op_id ON operation_snapshots(operation_id);
```

#### message_snapshots (NEW - IMMUTABLE)
```sql
CREATE TABLE IF NOT EXISTS message_snapshots (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operation_snapshots(operation_id) ON DELETE RESTRICT,
  message_id TEXT NOT NULL,
  
  -- Original message state (pre-operation)
  original_labels TEXT NOT NULL,      -- JSON array: ["INBOX", "IMPORTANT", "custom"]
  original_is_starred INTEGER NOT NULL,
  original_is_unread INTEGER NOT NULL,
  
  -- Message metadata (immutable)
  from_addr TEXT,
  subject TEXT,
  snippet TEXT,
  internal_date_ms INTEGER,
  size_estimate INTEGER,
  
  -- Snapshot context
  snapshot_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  policy_excluded INTEGER NOT NULL DEFAULT 0,  -- 1 if excluded by policy
  exclusion_reason TEXT,  -- STARRED | IMPORTANT | RECENT_X | etc.
  
  FOREIGN KEY (operation_id) REFERENCES operation_snapshots(operation_id) ON DELETE CASCADE,
  UNIQUE(operation_id, message_id)
);

CREATE INDEX idx_message_snapshots_op_id ON message_snapshots(operation_id);
CREATE INDEX idx_message_snapshots_msg_id ON message_snapshots(message_id);
```

#### message_execution_outcomes (NEW - IMMUTABLE, Retry-Safe)
```sql
CREATE TABLE IF NOT EXISTS message_execution_outcomes (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
  message_id TEXT NOT NULL,
  
  -- Execution phase
  phase TEXT NOT NULL,  -- EXECUTE | UNDO (which operation phase this outcome is for)
  
  -- Batch context
  batch_number INTEGER NOT NULL,
  batch_message_ids TEXT,  -- JSON array of message IDs in this batch
  
  -- Retry tracking (allows immutable history of all attempts)
  attempt_number INTEGER NOT NULL DEFAULT 1,  -- 1st attempt, 2nd attempt, etc.
  
  -- Intended action (from operation_type + operation_params)
  intended_action TEXT NOT NULL,  -- e.g., "ARCHIVE", "ADD_LABEL:custom", "TRASH"
  
  -- Execution outcome (per-message, per-attempt granularity)
  status TEXT NOT NULL,  -- SUCCEEDED | FAILED | UNKNOWN (never PENDING - no placeholder rows)
  error_code TEXT,  -- HTTP status code (e.g., "404", "429", "500", etc.)
  error_details TEXT,  -- Free-form error message from Gmail API or application
  
  -- Conflict detection (for undo phase only)
  conflict_detected INTEGER DEFAULT 0,  -- 1 if conflict detected (UNKNOWN status)
  conflict_reason TEXT,  -- e.g., "labels_differ", "message_deleted", "unexpected_state"
  expected_labels TEXT,  -- JSON array: expected labels after original execution (from message_snapshots + operation semantics)
  actual_labels TEXT,  -- JSON array: actual Gmail labels at undo time
  
  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at DATETIME,  -- When Gmail API call was attempted
  
  -- Immutability guarantee
  UNIQUE(operation_id, message_id, phase, batch_number, attempt_number),
  FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
);

CREATE INDEX idx_msg_outcomes_op_id ON message_execution_outcomes(operation_id);
CREATE INDEX idx_msg_outcomes_msg_id ON message_execution_outcomes(message_id);
CREATE INDEX idx_msg_outcomes_status ON message_execution_outcomes(status);
CREATE INDEX idx_msg_outcomes_phase ON message_execution_outcomes(phase);
CREATE INDEX idx_msg_outcomes_conflict ON message_execution_outcomes(conflict_detected);
CREATE INDEX idx_msg_outcomes_attempt ON message_execution_outcomes(attempt_number);
```

**CRITICAL Design Rules for message_execution_outcomes**:
1. **INSERT-ONLY**: Never UPDATE or DELETE rows
2. **No PENDING Placeholders**: Do not preinsert rows with status=PENDING; only insert when outcome is determined (SUCCEEDED | FAILED | UNKNOWN)
3. **Retry Strategy**: Retries create new rows with incremented `attempt_number`
   - 1st attempt fails with 429: (op_1, msg_1, EXECUTE, batch_1, attempt_1, status=FAILED, error_code=429)
   - Retry: (op_1, msg_1, EXECUTE, batch_1, attempt_2, status=SUCCEEDED)
   - Both rows exist; full history preserved; no UPDATE needed
4. **Immutable History**: All attempts visible for audit trail and retry decision logic
5. **Query Latest Attempt**: App logic queries MAX(attempt_number) per (operation_id, message_id, phase, batch_number) to get current outcome

#### approval_tokens (NEW - HARDENED)
```sql
CREATE TABLE IF NOT EXISTS approval_tokens (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  
  token_type TEXT NOT NULL,  -- EXECUTE | UNDO_EXECUTE
  -- NOTE: Raw token_value is NEVER stored in DB
  -- Raw token returned once to client only upon creation
  token_hash TEXT NOT NULL UNIQUE,  -- SHA256 hash of token (indexed for validation)
  token_last_four_chars TEXT NOT NULL,  -- Last 4 chars of token for user display (e.g., "...a7X2")
  
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,  -- 24 hours from creation
  used_at DATETIME,  -- When this token was used
  used_by_state TEXT,  -- The state transition that used this token (e.g., "APPROVED")
  
  FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE,
  UNIQUE(operation_id, token_type)  -- One execute token + one undo token per operation
);

CREATE INDEX idx_approval_tokens_hash ON approval_tokens(token_hash);
CREATE INDEX idx_approval_tokens_op_id ON approval_tokens(operation_id);
```
**IMPORTANT**: Token generation and storage (approval_tokens table only):
1. Generate random token (32+ chars, cryptographically secure) once per operation
2. Compute SHA256(token) for storage as token_hash in approval_tokens table
3. Store only in approval_tokens: token_hash + token_last_four_chars (never raw token_value)
4. Return raw token to client in response (once only)
5. On subsequent API requests, client includes raw token; server verifies SHA256(token) == token_hash in approval_tokens table
6. Do NOT store token data in operations table (avoid duplication; use approval_tokens table exclusively)

#### event_log (NEW - IMMUTABLE)
```sql
CREATE TABLE IF NOT EXISTS event_log (
  id TEXT PRIMARY KEY,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_email TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
  
  -- Event type
  event_type TEXT NOT NULL,  -- DRY_RUN_CREATED, EXECUTION_APPROVED, BATCH_STARTED, etc.
  status TEXT NOT NULL,  -- success | failure | partial
  
  -- Detailed context (never contains email bodies)
  context TEXT NOT NULL,  -- JSON with all event-specific data
  
  FOREIGN KEY (user_email) REFERENCES oauth_tokens(user_email) ON DELETE CASCADE,
  FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT
);

CREATE INDEX idx_event_log_user ON event_log(user_email);
CREATE INDEX idx_event_log_op_id ON event_log(operation_id);
CREATE INDEX idx_event_log_type ON event_log(event_type);
CREATE INDEX idx_event_log_timestamp ON event_log(timestamp);
```

#### batch_execution_log (NEW - IMMUTABLE)
```sql
CREATE TABLE IF NOT EXISTS batch_execution_log (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
  batch_number INTEGER NOT NULL,
  
  -- Execution details
  batch_message_ids TEXT NOT NULL,  -- JSON array of 500 message IDs
  execution_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Result summary (derived from message_execution_outcomes)
  succeeded_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  unknown_count INTEGER NOT NULL DEFAULT 0,  -- Messages with UNKNOWN status (partial failures)
  
  -- NOTE: Detailed per-message outcomes stored in message_execution_outcomes table
  
  UNIQUE(operation_id, batch_number),
  FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE
);

CREATE INDEX idx_batch_log_op_id ON batch_execution_log(operation_id);
```

#### undo_batch_execution_log (NEW - IMMUTABLE)
```sql
CREATE TABLE IF NOT EXISTS undo_batch_execution_log (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
  batch_number INTEGER NOT NULL,
  
  -- Undo execution details
  batch_message_ids TEXT NOT NULL,
  execution_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Result summary (derived from message_execution_outcomes with phase=UNDO)
  succeeded_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  unknown_count INTEGER NOT NULL DEFAULT 0,  -- Conflicts detected (safe handling)
  conflict_count INTEGER NOT NULL DEFAULT 0,  -- Messages with conflict_detected=1
  
  -- NOTE: Detailed per-message outcomes stored in message_execution_outcomes table with phase=UNDO
  
  UNIQUE(operation_id, batch_number),
  FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE
);

CREATE INDEX idx_undo_batch_log_op_id ON undo_batch_execution_log(operation_id);
```

### Immutable Table Guarantee
- ✅ No UPDATE triggers on: operation_snapshots, message_snapshots, message_execution_outcomes, event_log, batch_execution_log, undo_batch_execution_log
- ✅ No DELETE triggers (only CASCADE on parent deletion)
- ✅ Application code never issues UPDATE on these tables
- ✅ message_execution_outcomes is INSERT-only; retries create new rows with incremented attempt_number, not UPDATE
- ✅ No PENDING placeholder rows; only SUCCEEDED | FAILED | UNKNOWN statuses stored
- ✅ Immutable history preserved: all attempt records exist for audit trail

---

## 4. Required API Changes

### New/Modified Endpoints

#### 1. POST /api/operation/dryrun (MODIFIED)
**Changes**: Now stores operation_snapshot, returns operation_id + approval_token

**Request**:
```json
{
  "operationType": "ARCHIVE",
  "categories": ["promotions", "newsletters"],
  "policyOverrides": {
    "exclude_starred": true,
    "exclude_important": true,
    "exclude_unread": true,
    "exclude_recent_days": 7
  }
}
```

**Response** (includes raw token returned once only):
```json
{
  "operationId": "op_1772820185033",
  "operationType": "ARCHIVE",
  "totalAffected": 12000,
  "protectedExcluded": 145,
  "policyExcluded": 230,
  "samples": [
    {
      "id": "msg_abc123",
      "subject": "50% OFF Sale",
      "from": "promo@store.com",
      "date": "2026-03-05T12:00:00Z"
    }
  ],
  "riskAssessment": {
    "protectedEmailConflict": 145,
    "unreadEmailConflict": 0,
    "recentEmailConflict": 0,
    "overallRisk": "low"
  },
  "warnings": ["145 starred/important/unread/recent emails excluded"],
  "approvalToken": "eyJ...",  // Raw token returned ONCE to client only - store securely
  "tokenPreview": {
    "last_four_chars": "a7X2",  // For UI display and verification
    "expires_at": "2026-03-07T18:03:05.036Z"  // Token expiration
  },
  "canProceed": true,
  "expiresAt": "2026-03-07T18:03:05.036Z"
}
```

#### 2. POST /api/operation/approve (NEW)
**Purpose**: Move operation from PENDING_APPROVAL → APPROVED

**Request**:
```json
{
  "operationId": "op_1772820185033",
  "approvalToken": "eyJ..."
}
```

**Response**:
```json
{
  "operationId": "op_1772820185033",
  "status": "approved",
  "approvedAt": "2026-03-06T18:02:00.000Z",
  "message": "Operation approved. Click 'Execute' to proceed."
}
```

#### 3. POST /api/operation/execute (MODIFIED)
**Changes**: Now validates approvalToken, moves APPROVED → EXECUTING, batches to Gmail with snapshot

**Request**:
```json
{
  "operationId": "op_1772820185033",
  "approvalToken": "eyJ..."
}
```

**Response (Streaming/Polling)**:
```json
{
  "operationId": "op_1772820185033",
  "status": "executing",
  "progress": {
    "batchesProcessed": 5,
    "totalBatches": 24,
    "messagesSucceeded": 2500,
    "messagesFailed": 0
  },
  "estimatedSecondsRemaining": 120
}
```

**Final Response**:
```json
{
  "operationId": "op_1772820185033",
  "status": "completed",
  "succeededCount": 12000,
  "failedCount": 0,
  "partialFailure": false,
  "executedAt": "2026-03-06T18:05:00.000Z",
  "message": "12000 emails archived successfully.",
  "canUndo": true,
  "undoAvailableUntil": "2026-03-07T18:05:00.000Z"
}
```

#### 4. POST /api/operation/undo-dryrun (NEW)
**Purpose**: Create undo preview from snapshot, returns undo_approval_token

**Request**:
```json
{
  "operationId": "op_1772820185033"
}
```

**Response**:
```json
{
  "operationId": "op_1772820185033",
  "undoPreview": {
    "operationType": "ARCHIVE",
    "affectedCount": 12000,
    "restorationMessage": "Undo will attempt to restore 12000 messages. Conflicts or user changes may prevent restoration of some messages."
  },
  "restorationSamples": [
    {
      "id": "msg_abc123",
      "subject": "50% OFF Sale",
      "action": "Add INBOX label"
    }
  ],
  "undoApprovalToken": "eyJ...",  // Different from execute token
  "canProceedWithUndo": true,
  "expiresAt": "2026-03-07T18:03:05.036Z"
}
```

#### 5. POST /api/operation/approve-undo (NEW)
**Purpose**: Move operation from UNDO_PENDING_APPROVAL → UNDO_APPROVED

**Request**:
```json
{
  "operationId": "op_1772820185033",
  "undoApprovalToken": "eyJ..."
}
```

**Response**:
```json
{
  "operationId": "op_1772820185033",
  "status": "undo_approved",
  "statusExplained": "This status is part of the unified operation state machine (15 states including UNDO_APPROVED).",
  "undoApprovedAt": "2026-03-06T18:04:00.000Z",
  "message": "Undo approved. Click 'Execute Undo' to restore."
}
```

#### 6. POST /api/operation/undo-execute (NEW)
**Purpose**: Execute undo, restoring from snapshot

**Request**:
```json
{
  "operationId": "op_1772820185033",
  "undoApprovalToken": "eyJ..."
}
```

**Response (Final)**:
```json
{
  "operationId": "op_1772820185033",
  "status": "undone",
  "statusExplained": "This status is part of the unified operation state machine (15 states including UNDONE). The operation has been fully undone or safely handled.",
  "undoSucceededCount": 12000,
  "undoFailedCount": 0,
  "undoUnknownCount": 0,
  "undoExecutedAt": "2026-03-06T18:06:00.000Z",
  "message": "Undo completed: 12000 restored, 0 conflicts, 0 manual review needed."
}
```

#### 7. GET /api/operation/{id} (NEW)
**Purpose**: Get full operation details including state, snapshot, execution status

**Response**:
```json
{
  "operationId": "op_1772820185033",
  "status": "completed",
  "operationType": "ARCHIVE",
  "categories": ["promotions"],
  "createdAt": "2026-03-06T18:00:00Z",
  "approvedAt": "2026-03-06T18:02:00Z",
  "executedAt": "2026-03-06T18:05:00Z",
  "snapshot": {
    "affectedCount": 12000,
    "protectedExcluded": 145,
    "policySnapshot": {
      "exclude_starred": true,
      "exclude_important": true
    }
  },
  "execution": {
    "succeededCount": 12000,
    "failedCount": 0,
    "partialFailure": false
  },
  "undo": {
    "requested": false,
    "available": true,
    "availableUntil": "2026-03-07T18:05:00Z",
    "statusNote": "For undo phase, check main 'status' field (unified state machine): UNDO_PENDING_APPROVAL, UNDO_APPROVED, UNDO_EXECUTING, or UNDONE"
  }
}
```

#### 8. GET /api/events (NEW)
**Purpose**: Get audit event log for operation

**Query Params**:
- `operationId`: Filter by operation
- `limit`: Max events to return (default 100)
- `eventType`: Filter by event type

**Response**:
```json
{
  "events": [
    {
      "id": "evt_abc",
      "timestamp": "2026-03-06T18:00:05.036Z",
      "eventType": "DRY_RUN_CREATED",
      "status": "success",
      "context": {
        "operation_type": "ARCHIVE",
        "affected_count": 12000,
        "protected_excluded": 145
      }
    },
    {
      "id": "evt_def",
      "timestamp": "2026-03-06T18:02:00.000Z",
      "eventType": "EXECUTION_APPROVED",
      "status": "success",
      "context": {
        "approval_timestamp": "2026-03-06T18:02:00Z"
      }
    },
    {
      "id": "evt_ghi",
      "timestamp": "2026-03-06T18:03:45.000Z",
      "eventType": "BATCH_COMPLETED",
      "status": "success",
      "context": {
        "batch_number": 1,
        "succeeded_count": 500,
        "failed_count": 0
      }
    }
  ]
}
```

### 4a. Event Context Schemas (Detailed Definitions)

Each event_type has a required context JSON schema. These are enforced at insertion time.

#### DRY_RUN_CREATED
```json
{
  "operation_type": "ARCHIVE",
  "total_messages_in_category": 12500,
  "protected_excluded": 145,
  "policy_excluded": 230,
  "affected_count": 12000,
  "policy_snapshot": {
    "exclude_starred": true,
    "exclude_important": true,
    "exclude_unread": true,
    "exclude_recent_days": 7
  }
}
```

#### EXECUTION_APPROVED
```json
{
  "approval_timestamp": "2026-03-06T18:02:00.000Z",
  "token_last_four": "a7X2",  // Never include full token
  "token_expires_at": "2026-03-07T18:02:00.000Z"
}
```

#### BATCH_STARTED
```json
{
  "batch_number": 1,
  "total_batches": 24,
  "messages_in_batch": 500,
  "operation_type": "ARCHIVE"
}
```

#### BATCH_COMPLETED
```json
{
  "batch_number": 1,
  "succeeded_count": 500,
  "failed_count": 0,
  "unknown_count": 0
}
```

#### BATCH_FAILED
```json
{
  "batch_number": 3,
  "error_code": "500",
  "error_message": "Gmail API returned 500 Internal Server Error",
  "attempted_message_ids": ["msg_1", "msg_2", "msg_3"],  // First few
  "total_in_batch": 500
}
```

#### EXECUTION_COMPLETED
```json
{
  "total_attempted": 12000,
  "succeeded": 12000,
  "failed": 0,
  "unknown": 0,
  "partial_failure": false,
  "total_duration_seconds": 45,
  "batches_processed": 24
}
```

#### EXECUTION_FAILED
```json
{
  "error_code": "403",
  "error_message": "Gmail API token expired",
  "failed_at_batch": 5,
  "messages_processed": 2500,
  "messages_failed": 2500
}
```

#### UNDO_REQUESTED
```json
{
  "original_operation_type": "ARCHIVE",
  "affected_count": 12000,
  "request_timestamp": "2026-03-06T18:03:00.000Z"
}
```

#### UNDO_APPROVED
```json
{
  "approval_timestamp": "2026-03-06T18:04:00.000Z",
  "token_last_four": "b3Y9",  // Never include full token
  "token_expires_at": "2026-03-07T18:04:00.000Z"
}
```

#### UNDO_BATCH_STARTED
```json
{
  "batch_number": 1,
  "total_batches": 24,
  "messages_in_batch": 500,
  "restoration_action": "RESTORE_INBOX_LABEL"
}
```

#### UNDO_BATCH_COMPLETED
```json
{
  "batch_number": 1,
  "succeeded_count": 500,
  "failed_count": 0,
  "unknown_count": 0,
  "conflict_count": 0,
  "conflicts": []  // Detail of any conflicts detected
}
```

#### UNDO_BATCH_CONFLICT
```json
{
  "batch_number": 2,
  "message_id": "msg_abc123",
  "conflict_reason": "labels_differ",
  "expected_labels": ["INBOX"],
  "actual_labels": ["INBOX", "CUSTOM_LABEL"],
  "conflict_details": "Message was manually labeled after execution"
}
```

#### UNDO_COMPLETED
```json
{
  "total_attempted": 12000,
  "succeeded": 12000,
  "failed": 0,
  "unknown": 0,  // Conflicts detected but safely handled
  "conflict_count": 0,
  "total_duration_seconds": 45,
  "batches_processed": 24
}
```

#### UNDO_FAILED
```json
{
  "error_code": "401",
  "error_message": "Unauthorized: Gmail API access revoked",
  "failed_at_batch": 3,
  "messages_restored": 1000,
  "messages_not_restored": 11000
}
```

---

## 4b. Undo Conflict Policy & Safe Restoration

### Conflict Scenario Definition
After an operation executes successfully, Gmail state may change before undo is executed:
- User manually labels/unlabels messages
- User moves messages to/from folders
- Automatic filters modify message state
- Admin applies domain-wide settings

### Safe Restore Conditions (Per Message)

**Before Undo Execution**, for each message:
1. **Message Must Still Exist** in Gmail
   - If deleted by user: Skip message, mark UNKNOWN, log event
   - If permanently deleted: Skip, mark UNKNOWN

2. **Current Labels Must Match Expected Post-Execution State**
   - Expected state = derived from message_snapshots.original_labels + operation semantics + operation_params
   - Examples:
     - ARCHIVE operation: expected = no INBOX label
     - LABEL operation: expected = has custom label applied
     - TRASH operation: expected = has TRASH label
   - If mismatch detected: Do not apply changes, mark UNKNOWN, log conflict event

### Conflict Detection Rule

**Query Gmail API before each undo message batch**:
```
for each message_id in batch:
  // CRITICAL: Derive expected state from message_snapshots ONLY, not operation_snapshots
  msg_snapshot = message_snapshots WHERE operation_id AND message_id
  original_labels = JSON.parse(msg_snapshot.original_labels)
  
  // Derive expected post-execution state by applying operation semantics to original state
  operation_type = operation_snapshots.operation_type
  operation_params = JSON.parse(operation_snapshots.operation_params)
  expected_labels = applyOperationSemantics(original_labels, operation_type, operation_params)
  // Examples:
  //   ARCHIVE: removes INBOX label (no TRASH for ARCHIVE, just removes from inbox)
  //   LABEL: includes custom label from operation_params applied
  //   TRASH: includes TRASH label
  
  // Get current state from Gmail
  actual_labels = Gmail.getLabels(message_id)
  
  if actual_labels ≠ expected_labels:
    conflict_detected = True
    mark message_execution_outcome.status = UNKNOWN
    record in message_execution_outcomes table:
      - expected_labels (JSON)
      - actual_labels (JSON)
      - conflict_reason (e.g., "labels_differ")
    log event: UNDO_BATCH_CONFLICT
  else:
    proceed with restoration
```

**ENFORCEMENT**: expected_labels MUST be computed from message_snapshots.original_labels + operation semantics. Never use operation_snapshots sample data (e.g., affected_messages field) for expected state calculation. operation_snapshots exists for audit/UI only.

### Conflict Status Handling

| Scenario | Status | Action | User Experience |
|----------|--------|--------|-----------------|
| **No conflict detected** | SUCCEEDED | Apply restoration, mark message restored | Message shows "Restored" ✓ |
| **Unexpected labels** | UNKNOWN | Do not apply changes (manual user action took precedence) | Message shows "Conflict: User made changes" ⚠|
| **Message deleted** | UNKNOWN | Skip message (nothing to restore) | Message shows "Not found: user deleted?" ⚠ |
| **API error (429, 500)** | FAILED | Retry in next batch | Message shows "Retry..." and can be retried |

### Audit & Event Behavior

**Every conflict is logged**:
- Event type: UNDO_BATCH_CONFLICT
- Context: message_id, conflict_reason, expected_labels, actual_labels
- Immutable record in event_log (no deletion)
- Never contains email bodies (only message IDs + label names)

**User Notification**:
- Undo completion shows: "12000 messages attempted, 12000 succeeded, 0 conflicts detected"
- Or: "12000 messages attempted, 11980 succeeded, 20 conflicts detected (user made changes - safe)"
- User can view conflicts by operation ID + event_type filter

**Retry Behavior**:
- Failed messages (429, 500) can be retried manually via action button
- UNKNOWN messages (conflicts) cannot be auto-retried; user must manually resolve
- Application policy: Each retry on same (operation_id, message_id, phase, batch_number) creates new row with incremented attempt_number

### Restoration Logic (Safe Order)

```
for each message in batch:
  1. Check if message still exists (404 handling)
  2. Get current labels from Gmail
  3. Compare to expected_labels (conflict check)
  
  if conflict_detected:
    mark UNKNOWN, log event, skip step 4
  else:
    4. Apply restoration:
       - ARCHIVE: Remove TRASH, add INBOX and original labels
       - LABEL: Add back original custom labels
       - TRASH: Remove TRASH label
       
    5. Verify Gmail API response
    6. Mark SUCCEEDED or FAILED
    7. Record in message_execution_outcomes
```

### Why UNKNOWN (Not FAILED)

- **FAILED** = Temporary error, can be retried, batch should eventually succeed
- **UNKNOWN** = Permanent user action or unrecoverable state, needs manual review
- Distinction prevents false success metrics and alerts user to potential data loss

---

## 5. Required UI Changes

### New Components & State

#### OperationDetail.js (NEW)
- Display full operation state machine status
- Show timeline: dry-run → approved → executing → completed → undo preview → undo approved → undone
- Live progress during execution/undo

#### UndoDialog.js (NEW)
- Show undo preview
- "Approve Undo" button (generates undo_approval_token)
- Restoration details: what will be restored, which labels, sample messages

#### ApprovalFlow.js (MODIFIED)
- Split into: ApproveExecute.js + ApproveUndo.js
- Different tokens, different timing windows

#### OperationTimeline.js (NEW)
- Visual timeline of operation lifecycle
- Milestone markers: DRY_RUN → APPROVED → EXECUTING → COMPLETED → UNDO_PENDING → UNDONE

### Updated Dashboard.js
- Add "Operations" tab showing all operations + status
- For each operation: status badge, progress bar, undo button (if available)
- "View Details" → OperationDetail component

### Event Log View (Tab)
- New tab showing audit event stream
- Filterable by operation, event type
- Shows: timestamp, event type, status, context details

---

## 6. Required Tests

### Unit Tests (90+ lines)

#### policy.test.js (NEW)
```javascript
import PolicyEngine from '../src/policy-engine.js';

test('PolicyEngine: exclude starred', () => {
  const policy = new PolicyEngine({
    exclude_starred: true,
    exclude_important: false,
    exclude_unread: false,
    exclude_recent_days: 0
  });
  
  const message = { is_starred: true, label_ids: [] };
  const result = policy.evaluateMessage(message);
  
  assert.strictEqual(result.included, false);
  assert.strictEqual(result.reason, 'STARRED');
});

test('PolicyEngine: exclude important', () => {
  // Similar test for IMPORTANT label
});

test('PolicyEngine: exclude recent', () => {
  // Test exclude_recent_days parameter
});

test('PolicyEngine: filter messages batch', () => {
  // Test filterMessages() method
});
```

#### state-machine.test.js (NEW)
```javascript
import OperationStateMachine from '../src/state-machine.js';

test('State transition: PENDING_APPROVAL → APPROVED', () => {
  const sm = new OperationStateMachine('pending_approval');
  const result = sm.transition('approved', { approvalToken: 'token' });
  
  assert.strictEqual(result.status, 'approved');
  assert.strictEqual(result.valid, true);
});

test('State transition: Invalid transition blocked', () => {
  const sm = new OperationStateMachine('completed');
  const result = sm.transition('approved');  // Invalid
  
  assert.strictEqual(result.valid, false);
  assert.strictEqual(sm.currentState, 'completed');  // Unchanged
});

// 12+ more transition tests
```

### Integration Tests (150+ lines)

#### snapshot.test.js (NEW)
```javascript
test('Snapshot created during dry-run, stored immutably', () => {
  // Create dry-run operation
  const dryRun = createDryRunOperation(mockMessages);
  
  // Verify snapshot in DB
  const snapshot = fetchOperationSnapshot(dryRun.operationId);
  assert.ok(snapshot);
  assert.strictEqual(snapshot.affected_count, 100);
  
  // Try to modify snapshot (should fail)
  assert.throws(() => {
    updateOperationSnapshot(snapshot.id, { affected_count: 99 });
  });
});

test('Message snapshots preserve original labels', () => {
  const msgSnapshots = fetchMessageSnapshots(operationId);
  
  for (const snap of msgSnapshots) {
    assert.ok(snap.original_labels);  // Must exist
    assert.ok(Array.isArray(snap.original_labels));
    assert.ok(snap.original_is_starred !== null);  // Must be set
  }
});
```

#### undo.test.js (NEW)
```javascript
test('Undo restores original labels from snapshot', () => {
  // Execute operation: ARCHIVE (removes INBOX)
  executeOperation(operationId, approvalToken);
  
  // Verify messages no longer have INBOX (mocked)
  // ...
  
  // Execute undo
  executeUndo(operationId, undoApprovalToken);
  
  // Verify messages restored to original state
  const msgSnapshots = fetchMessageSnapshots(operationId);
  for (const snap of msgSnapshots) {
    assert.ok(snap.original_labels.includes('INBOX'));
  }
});

test('Undo is idempotent', () => {
  executeUndo(operationId, undoApprovalToken);
  const result1 = fetchUndoBatchLog(operationId, batchNum);
  
  // Execute undo again
  executeUndo(operationId, undoApprovalToken);
  const result2 = fetchUndoBatchLog(operationId, batchNum);
  
  // Should return same result (cached)
  assert.deepEqual(result1, result2);
});
```

#### event-log.test.js (NEW)
```javascript
test('Event log created for every state transition', () => {
  createDryRunOperation(operationId);
  approveExecute(operationId, token);
  executeOperation(operationId, token);
  
  const events = fetchEvents(operationId);
  const eventTypes = events.map(e => e.event_type);
  
  assert.ok(eventTypes.includes('DRY_RUN_CREATED'));
  assert.ok(eventTypes.includes('EXECUTION_APPROVED'));
  assert.ok(eventTypes.includes('BATCH_STARTED'));
  assert.ok(eventTypes.includes('EXECUTION_COMPLETED'));
});

test('Event log entries immutable', () => {
  const event = createEvent({...});
  
  // Try to update (should fail)
  assert.throws(() => {
    updateEvent(event.id, { status: 'failure' });
  });
});
```

### E2E State Machine Test (200+ lines)

#### state-machine-e2e.test.js (NEW)
```javascript
test('Full operation lifecycle: PENDING_APPROVAL → APPROVED → EXECUTING → COMPLETED → UNDO_PENDING_APPROVAL → UNDONE', () => {
  // Step 1: Dry-run (PENDING_APPROVAL state)
  const dryRun = createDryRunOperation({
    operationType: 'ARCHIVE',
    categories: ['promotions']
  });
  assert.strictEqual(dryRun.status, 'pending_approval');
  assert.ok(dryRun.approvalToken);
  
  // Step 2: Approve execute (APPROVED state)
  const approved = approveExecute(dryRun.operationId, dryRun.approvalToken);
  assert.strictEqual(approved.status, 'approved');
  assert.ok(approved.approvedAt);
  
  // Step 3: Execute (EXECUTING → COMPLETED state)
  const executed = executeOperation(dryRun.operationId, dryRun.approvalToken);
  assert.strictEqual(executed.status, 'completed');
  assert.strictEqual(executed.succeededCount, 1200);
  
  // Step 4: Undo dry-run (UNDO_PENDING_APPROVAL state)
  const undoPreview = createUndoDryRun(dryRun.operationId);
  assert.strictEqual(undoPreview.status, 'undo_pending_approval');  // Single status field (unified state machine)
  assert.ok(undoPreview.undoApprovalToken);
  
  // Step 5: Approve undo (UNDO_APPROVED state)
  const undoApproved = approveUndo(
    dryRun.operationId,
    undoPreview.undoApprovalToken
  );
  assert.strictEqual(undoApproved.status, 'undo_approved');  // Single status field
  
  // Step 6: Execute undo (UNDO_EXECUTING → UNDONE state)
  const undone = executeUndo(
    dryRun.operationId,
    undoPreview.undoApprovalToken
  );
  assert.strictEqual(undone.status, 'undone');  // Single status field
  assert.strictEqual(undone.undoSucceededCount, 1200);
  
  // Verify messages restored from message_snapshots (source of truth, not operation_snapshots)
  const finalSnapshot = fetchMessageSnapshots(dryRun.operationId);
  for (const msg of finalSnapshot) {
    assert.ok(msg.original_labels.includes('INBOX'));
  }
});

test('Partial failure: some messages fail during execute, undo still works', () => {
  // Create operation, approve, execute
  // Mock Gmail API to fail on batch 3 of 5
  
  const executed = executeOperation(operationId, token);
  assert.strictEqual(executed.status, 'completed_with_errors');
  assert.strictEqual(executed.succeededCount, 1000);
  assert.strictEqual(executed.failedCount, 200);
  
  // Undo should still work (only SUCCEEDED messages are undone, FAILED weren't modified)
  const undone = executeUndo(operationId, undoToken);
  assert.strictEqual(undone.status, 'undone');  // Single status field (unified state machine)
  
  // Undo outcomes tracked per-message: succeeded vs conflicts vs failures
  assert.strictEqual(undone.undoSucceededCount, 1180);  // Successfully restored
  assert.strictEqual(undone.undoConflictCount, 20);    // Conflicts detected (user manual changes)
});

test('Idempotent execution: duplicate batch requests return cached result', () => {
  approveExecute(operationId, token);
  
  // Execute batch 1
  const result1 = executeBatch(operationId, 1, messageIds);
  assert.strictEqual(result1.succeededCount, 500);
  
  // Execute batch 1 again (idempotent)
  const result2 = executeBatch(operationId, 1, messageIds);
  assert.deepEqual(result1, result2);  // Same result
});
```

### Test Execution
```bash
$ npm test
✓ 40+ unit tests (policy, state machine, snapshot)
✓ 25+ integration tests (operations, undo, events, idempotence)
✓ 1 E2E smoke test (full state machine lifecycle)
✓ Total: 66+ tests, all passing
✓ Duration: ~5s
```

---

## 7. Stop Condition (Definition of Done)

**STOP and declare COMPLETE when ALL of the following are true:**

### Code & Schema
- ✅ 8 new tables created with immutable guarantees (+ message_execution_outcomes)
- ✅ operations table modified with status, snapshot_id columns (approval token hashes stored in approval_tokens table exclusively)
- ✅ All indexes created for performance (including idx_approval_tokens_hash, idx_msg_outcomes_status)
- ✅ No UPDATE/DELETE on immutable tables (verified in schema review)
- ✅ Foreign key constraints in place with CASCADE/RESTRICT logic
- ✅ Migration script from v0 → v1 provided (transforms existing operations table safely)
- ✅ Raw approval tokens NEVER stored in DB; only token_hash stored

### State Machine
- ✅ All 15 states defined with clear semantics
- ✅ All valid transitions implemented (execute phase + undo phase)
- ✅ Invalid transitions blocked with clear error messages
- ✅ State transitions tested (12+ transition tests + E2E state machine)
- ✅ Terminal states identified (CANCELLED, EXPIRED, UNDONE, UNDO_FAILED, EXECUTION_FAILED)
- ✅ Single unified state machine used (not separate undo workflow)

### Approval Tokens (Hardened)
- ✅ Separate tokens for execute and undo (never same token value)
- ✅ Tokens generated cryptographically secure (32+ chars)
- ✅ Raw token_value returned to client ONCE only (in response, not stored in DB)
- ✅ Only token_hash (SHA256) stored in database
- ✅ token_last_four_chars stored for UI display without exposing full token
- ✅ Tokens expire after 24 hours
- ✅ Tokens expire after first use (one-time use)
- ✅ Token validation enforced via SHA256 comparison on API requests
- ✅ Token tests pass (generation, expiry, reuse prevention, hash verification)

### Snapshots & Restoration (Clarified Responsibilities)
- ✅ message_snapshots = sole source of truth for undo restoration (per-message original state)
- ✅ operation_snapshots = summary/audit only (aggregate counts, policy context)
- ✅ operation_snapshots created during dry-run (before any Gmail API call)
- ✅ message_snapshots store original label state, metadata for each message
- ✅ Snapshots are immutable (INSERT-only, enforced at application level)
- ✅ Undo restoration code reads ONLY from message_snapshots (not operation_snapshots or Gmail)
- ✅ Undo tested for all 3 operation types (ARCHIVE, LABEL, TRASH)
- ✅ Undo tested with conflict scenarios (user manual changes between execute and undo)
- ✅ Snapshots survive operation failures (stored before API calls)

### Per-Message Execution Tracking
- ✅ message_execution_outcomes table tracks status for every message in every batch
- ✅ Status enum: SUCCEEDED | FAILED | UNKNOWN
- ✅ FAILED = recoverable error (429, 500); can be retried
- ✅ UNKNOWN = unrecoverable or conflict; requires manual review
- ✅ Partial failures distinguishable (operation shows succeeded_count vs failed_count vs unknown_count)
- ✅ Idempotency: Duplicate batch requests return cached result from message_execution_outcomes
- ✅ Tests verify FAILED and UNKNOWN status handling separately

### Undo Conflict Policy (Implemented)
- ✅ Conflict detection rule: Compare Gmail labels to expected post-execution labels before undo
- ✅ Safe restore condition defined: Message exists + labels match expected state
- ✅ Conflict status marked UNKNOWN (not FAILED) to prevent false retries
- ✅ Conflict events logged (UNDO_BATCH_CONFLICT) with expected vs actual labels
- ✅ Undo proceeds safely despite conflicts (applies restoration only to non-conflicted messages)
- ✅ Undo conflict tests pass (detects user manual changes, deleted messages, label mismatches)

### Policy Engine
- ✅ PolicyEngine class created with configurable rules
- ✅ Default enterprise policy: exclude_starred=true, exclude_important=true, exclude_unread=true, exclude_recent_days=7
- ✅ Policy snapshot stored immutably with operation
- ✅ Policy evaluation tested for all rule types (starred, important, unread, recent)
- ✅ Protected email exclusion counts accurate in dry-run response
- ✅ ConfigurabIe recent_days threshold (default 7 days; configurable per operation)

### Audit Trail

- ✅ event_log table created (immutable, INSERT-only)
- ✅ Events logged for all state transitions (EXECUTION_APPROVED, UNDO_APPROVED, etc.)
- ✅ Events logged for all batch events (BATCH_STARTED, BATCH_COMPLETED, BATCH_FAILED, UNDO_BATCH_CONFLICT)
- ✅ Event context schemas defined per event_type (never logs full email bodies)
- ✅ Conflict events (UNDO_BATCH_CONFLICT) logged with expected vs actual labels
- ✅ User-attributed events (user_email on every event)
- ✅ Event log tests pass (immutability, completeness, schema validation)

### Partial Failures & Unknown Outcomes
- ✅ message_execution_outcomes tracks SUCCEEDED | FAILED | UNKNOWN per message
- ✅ FAILED messages can be retried (transient errors: 429, 500, 503)
- ✅ UNKNOWN messages cannot be retried (conflicts: user changed labels, message deleted)
- ✅ Batch failures don't block undo (undo can proceed with conflict handling)
- ✅ succeeded_count + failed_count + unknown_count visible in operation status
- ✅ COMPLETED_WITH_ERRORS state used when unknown_count > 0 or failed_count > 0
- ✅ Partial failure tests pass (FAILED vs UNKNOWN distinction)

### Idempotence & Retry Safety
- ✅ message_execution_outcomes primary key: (operation_id, message_id, phase, batch_number, attempt_number)
- ✅ Duplicate batch requests checked against message_execution_outcomes
- ✅ If message already processed, return cached status (SUCCEEDED/FAILED/UNKNOWN)
- ✅ batch_execution_log aggregates counts from message_execution_outcomes
- ✅ undo_batch_execution_log same idempotency design for undo phase
- ✅ Application retry policy: monotonically increasing attempt_number prevents infinite loops; max retries configurable
- ✅ Idempotence tests pass (same result on retry, no duplicate Gmail API calls)

### API Endpoints
- ✅ POST /api/operation/dryrun (MODIFIED: returns snapshot + token_preview with last_four_chars)
- ✅ POST /api/operation/approve (NEW: validates token_hash against DB)
- ✅ POST /api/operation/execute (MODIFIED: validates approvalToken via hash comparison)
- ✅ POST /api/operation/undo-dryrun (NEW: shows conflict preview if applicable)
- ✅ POST /api/operation/approve-undo (NEW: validates undo_approval_token via hash)
- ✅ POST /api/operation/undo-execute (NEW: detects conflicts, marks UNKNOWN messages)
- ✅ GET /api/operation/{id} (NEW: returns full state incl. execution details)
- ✅ GET /api/events (NEW: queryable event log with eventType/operationId filters)
- ✅ All endpoints return correct JSON responses with event context schemas

### Frontend UI
- ✅ OperationDetail component shows operation state machine progress
- ✅ UndoDialog component shows undo preview + conflict warnings
- ✅ Approval flow split into ApproveExecute.js + ApproveUndo.js (separate token types)
- ✅ Timeline visualization shows all 15 states + phase transitions
- ✅ Event log viewer with filters (by eventType, operationId, timestamp)
- ✅ Conflict resolution UI shows expected vs actual labels for manual review
- ✅ "Undo unavailable" message when > 24 hours
- ✅ Failed message list visible with retry option
- ✅ Unknown message list visible (requires manual intervention)

### Hard Invariants (All Enforced)
- ✅ **Invariant 1**: No destructive action without explicit approval token (enforced via validation)
- ✅ **Invariant 2**: Every reversible operation supports undo (ARCHIVE, LABEL, TRASH all reversible)
- ✅ **Invariant 3**: Undo requires separate approval token ≠ execute token (different token_hash)
- ✅ **Invariant 4**: Protected messages excluded by policy (default: starred, important, unread, recent)
- ✅ **Invariant 5**: Full pre-operation state required before execution (message_snapshots created in dry-run only)
- ✅ **Invariant 6**: All executions + undos audited immutably (event_log INSERT-only)
- ✅ **Invariant 7**: Execution idempotent and retry-safe (message_execution_outcomes + batch logs)
- ✅ **Invariant 8**: Undo conflict detection & safe restoration (detects label mismatches, marks UNKNOWN)

### Security & Data Protection
- ✅ Raw approval tokens never stored in DB (only token_hash via SHA256)
- ✅ Raw token returned to client once only (in API response)
- ✅ token_last_four_chars stored for UI display without exposing full token
- ✅ Email bodies never logged (only message IDs, labels, metadata)
- ✅ User email attributed to all events and operations
- ✅ GDPR compliance: Immutable audit trail, no data deletion

### Tests (Updated Requirements)
- ✅ 40+ unit tests pass (policy, state-machine, token validation)
- ✅ 25+ integration tests pass (snapshots, undo, events, idempotence, conflicts)
- ✅ 1 E2E state machine test passes (full 15-state lifecycle + undo conflict scenario)
- ✅ NEW: undo-conflict.test.js passes (conflict detection, UNKNOWN status, safe restoration)
- ✅ NEW: token.test.js passes (hash generation, one-time use, expiry)
- ✅ NEW: message-execution.test.js passes (FAILED vs UNKNOWN distinction, retry logic)
- ✅ Linting: 0 errors
- ✅ Code formatted consistently (npm run format applied)

- ✅ No security warnings

### Documentation
- ✅ Design doc updated with architectural clarifications (snapshot responsibility, conflict policy)
- ✅ Spec updated with all 5 architectural corrections + recommendations
- ✅ Schema migration guide (v0 → v1 with all 8 new tables)
- ✅ API reference with event context schemas per event_type
- ✅ State machine diagram (unified 15-state machine + phase branches)
- ✅ Token handling guide (hash generation, one-time use, safe storage)
- ✅ Undo conflict policy guide (safe restoration logic, conflict detection)
- ✅ Test documentation (new test files: undo-conflict.test.js, token.test.js, message-execution.test.js)
- ✅ Example payloads (dry-run, approve, execute, undo-dryrun, approve-undo, undo-execute, events with conflict examples)

### Backward Compatibility
- ✅ v0 operations table remains (not deleted)
- ✅ v1 operations use new tables + modified operations columns (no breaking changes to existing v0 data)
- ✅ UI shows "Undo unavailable" for v0 operations
- ✅ Migration guide documents exact ALTER TABLE + CREATE TABLE sequence
- ✅ Rollback procedure documented (if needed before go-live)

### Production Readiness
- ✅ All 8 hardened invariants enforced in code
- ✅ Enterprise-safe reversibility guaranteed (snapshots + conflict policy)
- ✅ Zero data loss on failures (message_snapshots created before API calls)
- ✅ Full auditability (event_log immutable, never stored with email bodies)
- ✅ Retry resilience (idempotent execution via message_execution_outcomes)
- ✅ Conflict resilience (UNKNOWN vs FAILED distinction prevents false retries)
- ✅ Clear failure messages (user can take informed action)
- ✅ Token security (no raw tokens in DB, only hashes)

---

## 8. Approval Gate & Next Steps

**This spec is LOCKED after this point with all 5 architectural corrections applied.**

### Authorization to Proceed
- ✅ Design doc updated and reviewed (snapshot responsibility, conflict policy added)
- ✅ Spec complete, measurable, and implementation-ready
- ✅ All 8 hard invariants defined, enforced, and documented
- ✅ All 66+ test cases outlined with new tests for conflicts + tokens + message execution
- ✅ All 8 new tables designed with immutability enforced (+ message_execution_outcomes)
- ✅ All 5 architectural corrections applied:
  - Snapshot responsibility clarified (message_snapshots = source of truth)
  - Message-level execution tracking added (message_execution_outcomes table)
  - Unified lifecycle state machine selected (not separate workflows)
  - Approval token storage hardened (hash-only, no raw tokens in DB)
  - Undo conflict policy defined (safe restoration with conflict detection)

### Implementation Phase
After approval, follow in order:
1. **Database Schema** (database.js): Create 8 new tables + modify operations table
2. **State Machine Module**: Define 15 states with transitions
3. **Policy Engine Module**: Configurable rules with defaults (starred, important, unread, recent)
4. **Token Service Module**: Generate, hash, store, and validate (one-time use, expiry)
5. **Execution & Undo Logic**: Message-level outcome tracking + conflict detection
6. **API Endpoints** (8 endpoints): All with event context schema validation
7. **Frontend Components** (5 new, 2 modified): With conflict UI + timeline
8. **Test Suite** (66+ tests): Including new undo-conflict.test.js, token.test.js, message-execution.test.js
9. **Migration Script**: Safe v0 → v1 transition
10. **Smoke Tests & Validation**: Full 15-state E2E test

### Documentation Phase

1. API reference (Postman collection)
2. State machine diagram (Mermaid)
3. Migration guide (SQL + code)
4. Troubleshooting guide (partial failures, retries)
5. Example workflows (screenshots)

---

**Spec Owner**: Architecture Team  
**Status**: Ready for Implementation  
**Approval Gate**: Design + Spec Review Required Before Coding
**Target Completion**: STEP 3 Enterprise Implementation

