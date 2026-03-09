# Gmail Inbox Cleanup Tool — Enterprise v1 Design Document

**Version:** 1.0 (Enterprise)  
**Date:** March 6, 2026  
**Status:** Architecture & Design Phase  
**Focus:** Enterprise-safe reversible operations with full undo support

---

## 1. Goals

### Primary Goals (Enterprise v1)
- **Safe Reversibility**: Every destructive or organizational action (ARCHIVE, LABEL, TRASH) can be completely undone with explicit approval, restoring original state
- **Full State Snapshots**: Capture complete message state before any operation, enabling deterministic restoration
- **Explicit Multi-Step Approval**: Dry-run → Approve Execute → Execute → Approve Undo → Undo (each step explicit)
- **Fine-Grained Audit Trail**: Record every state transition, user action, and partial failure with full context
- **Enterprise Lifecycle States**: Operations progress through well-defined states with clear semantics
- **Idempotent Execution**: Operations can be safely retried without duplicate effects
- **Policy-Based Exclusions**: Pluggable policy engine for message filtering (not just fixed SQL)
- **Partial Failure Resilience**: If operation fails mid-batch, mark state clearly and allow selective undo

### Success Criteria
1. User can perform operation → approve execute → observe results → approve undo → restore original state
2. Operation state machine is unambiguous (no race conditions)
3. Undo can be executed multiple times safely (idempotent)
4. Every operation has full pre-execution snapshot (labels, state)
5. Audit trail shows every user action and system event
6. Protected messages excluded by policy (configurable, default excludes starred + important)
7. Partial failures are visible and don't block undo
8. Zero data loss (snapshots survive failures)

---

## 2. Non-Goals (Enterprise v1)

- **Automatic Undo**: Undo is always explicit, never automatic or time-based
- **Partial Undo UI**: User undoes entire operation, not individual messages
- **Multi-Step Rollback**: Only support undo of immediate prior state, not arbitrary history
- **Distributed Transactions**: Single-user SQLite; no multi-session conflict resolution required
- **Audit Log Export APIs**: Audit logs are read-only via DB export (not REST)
- **Policy as Code Version Control**: Policies are not version-tracked; no git-based policy history
- **AI-Driven Approvals**: All approvals are 100% manual and explicit
- **Async undo/redo queues**: Undo execution is synchronous

---

## 3. System Boundaries & Data Flow

### High-Level Operation Lifecycle

```
┌─────────────────────────────────────────────────────────┐
│                    OPERATION PENDING_APPROVAL            │
│  (Dry-run created, no Gmail changes, snapshot stored)    │
└────────────┬────────────────────────────────────────────┘
             │ User clicks "Approve Execute"
             ▼
┌─────────────────────────────────────────────────────────┐
│                    OPERATION APPROVED                     │
│  (Awaiting execution window, snapshot finalized)          │
└────────────┬────────────────────────────────────────────┘
             │ User clicks "Execute"
             ▼
┌─────────────────────────────────────────────────────────┐
│                    OPERATION EXECUTING                    │
│  (Batching to Gmail API, tracking succeeded/failed)       │
└────────────┬────────────────────────────────────────────┘
             │ All batches processed
             ▼
┌──────────────────────────────────────────────────────────┐
│    OPERATION COMPLETED (or COMPLETED_WITH_ERRORS)        │
│  (Changes applied to Gmail, snapshot ready for undo)      │
└────────────┬───────────────────────────────────────────┘
             │ User clicks "Approve Undo"
             ▼
┌──────────────────────────────────────────────────────────┐
│              OPERATION UNDO_PENDING_APPROVAL              │
│  (Undo preview created from snapshot)                     │
└────────────┬───────────────────────────────────────────┘
             │ User clicks "Approve Undo Execution"
             ▼
┌──────────────────────────────────────────────────────────┐
│              OPERATION UNDO_APPROVED                      │
│  (Ready to restore from snapshot)                         │
└────────────┬───────────────────────────────────────────┘
             │ User clicks "Execute Undo"
             ▼
┌──────────────────────────────────────────────────────────┐
│              OPERATION UNDO_EXECUTING                     │
│  (Restoring labels from snapshot)                         │
└────────────┬───────────────────────────────────────────┘
             │ All batches processed
             ▼
┌──────────────────────────────────────────────────────────┐
│                 OPERATION UNDONE                          │
│  (Original state restored, operation history complete)    │
└──────────────────────────────────────────────────────────┘
```

### Key State Transitions
- **PENDING_APPROVAL → APPROVED**: User approves execute (via approvalToken)
- **APPROVED → EXECUTING**: Backend batches begin, first event logged
- **EXECUTING → COMPLETED**: All batches succeeded
- **EXECUTING → COMPLETED_WITH_ERRORS**: Some batches failed, user notified
- **COMPLETED → UNDO_PENDING_APPROVAL**: User requests undo preview
- **UNDO_PENDING_APPROVAL → UNDO_APPROVED**: User approves undo (new token)
- **UNDO_APPROVED → UNDO_EXECUTING**: Undo batches begin
- **UNDO_EXECUTING → UNDONE**: All undo batches succeeded

---

## 4. Operation Snapshot Architecture

### What Gets Snapshotted (At Dry-Run Time)

#### MessageSnapshot
```javascript
{
  operation_id:        "op_<uuid>",
  message_id:          "msg_abc123",
  thread_id:           "thread_xyz",
  
  // Pre-operation state (captured at snapshot time)
  original_labels:     ["INBOX", "IMPORTANT", "custom_label"],
  original_is_starred: true,
  original_is_unread:  false,
  
  // Message metadata (immutable)
  from_addr:           "user@example.com",
  subject:             "Important Email",
  snippet:             "This is the body preview...",
  internal_date_ms:    1741206185000,
  size_estimate:       2048,
  
  // Captured at snapshot time
  snapshot_timestamp:  "2026-03-06T18:03:05.036Z",
  policy_excluded:     false,          // If true, this message was excluded by policy
  exclusion_reason:    null            // "STARRED", "IMPORTANT", "RECENT", etc.
}
```

#### OperationSnapshot
```javascript
{
  operation_id:           "op_<uuid>",
  user_email:             "user@gmail.com",
  operation_type:         "ARCHIVE" | "LABEL" | "TRASH",
  
  // Category being operated on
  category_ids:           ["promotions", "newsletters"],
  
  // Policy applied at snapshot time
  policy_snapshot:        {
    exclude_starred:      true,
    exclude_important:    true,
    exclude_unread:       false,
    exclude_recent_days:  0,
    exclude_threads:      [],
    custom_rules:         []
  },
  
  // Counts at snapshot time
  total_messages_in_category:     15000,
  protected_excluded:              145,
  policy_excluded:                 230,
  affected_count:                  14625,
  
  // Operation parameters
  operation_params:       {
    // For ARCHIVE: nothing extra
    // For LABEL: { label_id: "custom_label_id", label_name: "Archive 2025" }
    // For TRASH: nothing extra
  },
  
  // Message snapshots (first 100 as samples)
  affected_messages:      [MessageSnapshot, MessageSnapshot, ...],
  
  // Approval & execution tracking
  created_at:             "2026-03-06T18:00:00Z",
  approved_at:            null,
  approved_by:            null,
  approval_token:         "b3BfMTc3MjgyMDE4NTAz...",
  
  execution_started_at:   null,
  execution_completed_at: null,
  execution_status:       "PENDING_APPROVAL",
  
  // Results after execution
  succeeded_count:        null,
  failed_count:           null,
  partial_failure:        false,
  error_details:          null,
  
  // Undo tracking
  undo_requested_at:      null,
  undo_approved_at:       null,
  undo_approval_token:    null,
  undo_executed_at:       null,
  undo_status:            null   // "UNDO_PENDING_APPROVAL", "UNDONE", etc.
}
```

### Snapshot Storage Location
- **Primary**: `operation_snapshots` table (full JSON + indexed fields)
- **Restoration Data**: `message_snapshots` table (pre-operation label state)
- **Linked via**: `operation_id` (foreign key)
- **Never Modified**: Once created, snapshots are immutable (INSERT-only)

---

## 5. Operation Lifecycle States & State Machine

### Enum: OperationStatus

```javascript
const OperationStatus = {
  // Pre-execution phase
  PENDING_APPROVAL:           "pending_approval",        // Dry-run created
  APPROVED:                   "approved",                // User approved execute
  
  // Execution phase
  EXECUTING:                  "executing",               // Batches in progress
  EXECUTION_PAUSED:           "execution_paused",        // Batch failed, awaiting retry
  
  // Post-execution phase (success variants)
  COMPLETED:                  "completed",               // All messages succeeded
  COMPLETED_WITH_ERRORS:      "completed_with_errors",  // Some succeeded, some failed
  
  // Post-execution phase (failure variant)
  EXECUTION_FAILED:           "execution_failed",        // All batches failed
  
  // Undo phase
  UNDO_PENDING_APPROVAL:      "undo_pending_approval",    // Undo preview created
  UNDO_APPROVED:              "undo_approved",             // User approved undo
  UNDO_EXECUTING:             "undo_executing",            // Undo batches in progress
  
  // Undo terminal states
  UNDONE:                     "undone",                   // Undo succeeded
  UNDO_FAILED:                "undo_failed",              // Undo execution failed
}
```

### Allowed State Transitions

```
PENDING_APPROVAL
  → APPROVED           (user approves execute)
  → CANCELLED          (operation timeout or user cancels)

APPROVED
  → EXECUTING          (execute endpoint called)

EXECUTING
  → COMPLETED          (all batches succeeded)
  → COMPLETED_WITH_ERRORS (some succeeded, some failed)
  → EXECUTION_FAILED   (all batches failed)

COMPLETED, COMPLETED_WITH_ERRORS, EXECUTION_FAILED
  → UNDO_PENDING_APPROVAL (user requests undo)
  → EXPIRED            (24 hours passed, undo no longer allowed)

UNDO_PENDING_APPROVAL
  → UNDO_APPROVED      (user approves undo)
  → UNDO_CANCELLED     (user cancels undo)

UNDO_APPROVED
  → UNDO_EXECUTING     (undo execute called)

UNDO_EXECUTING
  → UNDONE             (all undo batches succeeded)
  → UNDO_FAILED        (undo execution failed)

// Terminal states: CANCELLED, EXPIRED, EXECUTION_FAILED, UNDO_FAILED, UNDONE
```

### State Invariants
- No transition back to earlier phases (no re-approval)
- EXECUTING prevents approval changes
- APPROVED blocks execution for > 24 hours (auto-expires)
- UNDONE is final (no further operations allowed)

---

## 6. Policy Engine Model

### PolicyEngine Class

```javascript
class PolicyEngine {
  constructor(policy) {
    this.excludeStarred = policy.exclude_starred ?? true;
    this.excludeImportant = policy.exclude_important ?? true;
    this.excludeUnread = policy.exclude_unread ?? false;
    this.excludeRecentDays = policy.exclude_recent_days ?? 0;
    this.customRules = policy.custom_rules ?? [];
  }

  evaluateMessage(message, timestamp = Date.now()) {
    // Returns: { included: bool, reason: string | null }
    
    if (this.excludeStarred && message.is_starred) {
      return { included: false, reason: "STARRED" };
    }
    
    if (this.excludeImportant && this.hasLabel(message, "IMPORTANT")) {
      return { included: false, reason: "IMPORTANT" };
    }
    
    if (this.excludeUnread && message.is_unread) {
      return { included: false, reason: "UNREAD" };
    }
    
    if (this.excludeRecentDays > 0) {
      const ageMs = timestamp - message.internal_date_ms;
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      if (ageDays < this.excludeRecentDays) {
        return { included: false, reason: `RECENT_${this.excludeRecentDays}D` };
      }
    }
    
    // Custom rules (future extension)
    for (const rule of this.customRules) {
      const result = rule(message);
      if (!result.included) return result;
    }
    
    return { included: true, reason: null };
  }

  filterMessages(messages, timestamp) {
    // Returns: { included: Message[], excluded: {message, reason}[] }
    const included = [];
    const excluded = [];
    
    for (const msg of messages) {
      const result = this.evaluateMessage(msg, timestamp);
      if (result.included) {
        included.push(msg);
      } else {
        excluded.push({ message: msg, reason: result.reason });
      }
    }
    
    return { included, excluded };
  }

  hasLabel(message, labelId) {
    return (message.label_ids || []).includes(labelId);
  }
}
```

### Default Policy
```javascript
const DEFAULT_POLICY = {
  exclude_starred: true,
  exclude_important: true,
  exclude_unread: false,
  exclude_recent_days: 0,
  custom_rules: []
};
```

### Policy Application Flow
1. **Dry-run**: Create PolicyEngine from policy_snapshot
2. **Query**: `SELECT * FROM message_metadata WHERE user_email = ?`
3. **Filter**: For each message, call `PolicyEngine.evaluateMessage()`
4. **Count**: Report included vs excluded (with reasons)
5. **Snapshot**: Store policy + exclusion reasons with operation snapshot
6. **Execute**: Use same policy evaluation (no changes allowed after approval)

---

## 7. Audit & Event Model

### EventLog Entry

```javascript
{
  id:              "evt_<uuid>",
  timestamp:       "2026-03-06T18:03:05.036Z",
  user_email:      "user@gmail.com",
  operation_id:    "op_<uuid>",
  
  event_type:      "DRY_RUN_CREATED" | 
                   "EXECUTION_APPROVED" |
                   "EXECUTION_STARTED" |
                   "BATCH_STARTED" |
                   "BATCH_COMPLETED" |
                   "BATCH_FAILED" |
                   "EXECUTION_COMPLETED" |
                   "EXECUTION_FAILED" |
                   "UNDO_REQUESTED" |
                   "UNDO_APPROVED" |
                   "UNDO_STARTED" |
                   "UNDO_COMPLETED" |
                   "UNDO_FAILED",
  
  // Detailed context (never contains email bodies)
  context:         {
    // For DRY_RUN_CREATED
    operation_type:          "ARCHIVE",
    affected_count:          1200,
    protected_excluded:      5,
    
    // For EXECUTION_APPROVED
    approval_timestamp:      "2026-03-06T18:02:00Z",
    
    // For BATCH_STARTED
    batch_number:            1,
    batch_size:              500,
    batch_message_ids:       ["msg_1", "msg_2", ...],  // First 100 only
    
    // For BATCH_COMPLETED
    succeeded_count:         500,
    failed_ids:              [],
    
    // For BATCH_FAILED
    error_code:              "GMAIL_API_ERROR",
    error_message:           "The caller does not have permission",
    failed_message_ids:      ["msg_500", ...],  // IDs that failed
    
    // For UNDO_*
    undo_reason:             "User requested reversal",
  },
  
  // Machine-readable status
  status:          "success" | "failure" | "partial",
}
```

### Event Types & Semantics

| Event | Trigger | Status | Impact |
|-------|---------|--------|--------|
| DRY_RUN_CREATED | Dry-run endpoint called | success | Operation in PENDING_APPROVAL |
| EXECUTION_APPROVED | User clicks approve | success | Operation in APPROVED state |
| EXECUTION_STARTED | Execute endpoint called | success | EXECUTING state, first batch begins |
| BATCH_STARTED | Batch submitted to Gmail | success | Tracking began |
| BATCH_COMPLETED | Batch returned 200 OK | success | succeeded_count incremented |
| BATCH_FAILED | Batch API error | failure | failed_ids tracked, may retry |
| EXECUTION_COMPLETED | All batches done | success | COMPLETED state |
| EXECUTION_FAILED | All retries exhausted | failure | EXECUTION_FAILED state |
| UNDO_REQUESTED | User requests undo | success | UNDO_PENDING_APPROVAL state |
| UNDO_APPROVED | User approves undo | success | UNDO_APPROVED state |
| UNDO_STARTED | Undo execute called | success | UNDO_EXECUTING state |
| UNDO_COMPLETED | All undo batches done | success | UNDONE state |
| UNDO_FAILED | Undo batches failed | failure | UNDO_FAILED state |

### Audit Trail Immutability
- **INSERT-only**: Application never modifies event_log after insert
- **No cascading deletes**: If operation deleted, events remain
- **Timestamped**: Every event has unambiguous timestamp
- **User-attributed**: Every event tied to `user_email`
- **No Bodies**: Never stores full email bodies or raw sender addresses

---

## 8. Execution & Partial Failure Strategy

### Batch Execution Flow

```
EXECUTE CALL
  ↓
Get operation_snapshot (lookup by operation_id)
  ↓
Validate approval_token (must match snapshots)
  ↓
Fetch message_snapshots for operation
  ↓
Create batches (500 messages per batch)
  ↓
FOR EACH BATCH:
  │
  ├→ Log: BATCH_STARTED
  │
  ├→ Call Gmail API: batchModify({
  │     ids: [msg_1, msg_2, ...],
  │     addLabelIds: ["label_to_add"],   // For LABEL
  │     removeLabelIds: ["INBOX"]        // For ARCHIVE
  │   })
  │
  ├→ IF Success (200):
  │   ├→ Log: BATCH_COMPLETED {succeeded_count: 500}
  │   ├→ If all messages in batch processed:
  │   │   ├→ Update operation_snapshots.succeeded_count += 500
  │   │   └→ Mark batch messages as executed
  │   │
  │   └→ Continue to next batch
  │
  ├→ IF Failure (rate limit / transient):
  │   ├→ Log: BATCH_FAILED {error, retry_count: N}
  │   ├→ Exponential backoff (1s, 2s, 4s, 8s, ...)
  │   ├→ Retry up to 3 times
  │   │
  │   └→ If all retries exhausted:
  │       ├→ Log: BATCH_FAILED {final: true}
  │       ├→ Track failed_message_ids in operation_snapshots
  │       └→ Continue to next batch (partial failure)
  │
  └→ IF Failure (permanent, e.g., permission denied):
       ├→ Log: BATCH_FAILED {error: "PERMISSION_DENIED", final: true}
       ├→ Abort remaining batches
       └→ Mark operation as EXECUTION_FAILED
  
END FOR EACH BATCH
  ↓
Check results:
  ├→ succeeded_count == affected_count?
  │   ├→ Yes: Set status = COMPLETED
  │   └→ No: Set status = COMPLETED_WITH_ERRORS
  │
  └→ If all failed: status = EXECUTION_FAILED
  
Log: EXECUTION_COMPLETED or EXECUTION_FAILED
  ↓
Return response with {succeeded_count, failed_count, partial_failure}
```

### Idempotent Execution

```javascript
// Each operation has idempotency_key (operation_id)
// Before each batch execution:

const executedBatches = db.prepare(`
  SELECT batch_number FROM batch_execution_log
  WHERE operation_id = ? AND batch_number = ?
`).get(operationId, batchNum);

if (executedBatches) {
  // Already executed this batch
  // Return cached result
  return cachedResult;
}

// Otherwise proceed with execution
```

### Retry & Resume Strategy
- **Transient Errors** (5xx, timeout): Retry up to 3x with backoff
- **Permanent Errors** (403, rate limit): Log, mark failed, continue
- **Resumable State**: If operation crash mid-batch, can resume from batch_execution_log
- **No Duplicate Effects**: Idempotency key prevents double-labeling

---

## 9. Undo Restoration Strategy

### Undo Execution Flow

```
UNDO EXECUTE CALL
  ↓
Get operation_snapshot (lookup by operation_id)
  ↓
Validate undo_approval_token (must match)
  ↓
Verify operation is UNDOABLE:
  ├→ Status = COMPLETED or COMPLETED_WITH_ERRORS
  └→ Time < 24 hours from execution
  
Fetch message_snapshots for this operation
  ↓
Determine restoration action by operation_type:
  ├→ ARCHIVE:
  │   └→ Remove TRASH, add INBOX (if not present)
  │
  ├→ LABEL:
  │   └→ Remove custom label (stored in operation_params.label_id)
  │
  └→ TRASH:
      └→ Remove TRASH label
  
Create undo batches (500 per batch)
  ↓
FOR EACH UNDO BATCH:
  │
  ├→ Log: UNDO BATCH_STARTED
  │
  ├→ Call Gmail API: batchModify({
  │     ids: [msg_1, msg_2, ...],
  │     removeLabelIds: ["label_to_remove"],
  │     addLabelIds: ["label_to_add"]
  │   })
  │
  ├→ IF Success:
  │   ├→ Log: UNDO BATCH_COMPLETED
  │   └→ Increment undo_succeeded_count
  │
  └→ IF Failure:
      ├→ Log: UNDO BATCH_FAILED
      ├→ Retry with backoff
      └→ Continue to next batch (partial undo allowed)

END FOR EACH UNDO BATCH
  ↓
Check results:
  ├→ undo_succeeded_count == affected_count?
  │   ├→ Yes: status = UNDONE
  │   └→ No: status = UNDO_PARTIAL_FAILURE
  │
  └→ If all failed: status = UNDO_FAILED
  
Log: UNDO_COMPLETED or UNDO_FAILED
  ↓
Return response with {undo_succeeded_count, undo_failed_count}
```

### Undo Idempotence
- **Same idempotency semantics**: Each undo has undo_batch_execution_log
- **Resume-safe**: Can retry undo without double-restoring
- **Multiple Undo Attempts**: Can call undo multiple times safely

---

## 10. Enterprise Definition of Done

### Schema Completeness
- ✅ 11 tables (up from 6): Added snapshots, events, batch logs
- ✅ All immutable tables have no UPDATE/DELETE triggers
- ✅ All operation tracking tables have proper foreign keys
- ✅ Indexes on: user_email, operation_id, created_at, event_type

### API Completeness
- ✅ POST /api/operation/dryrun (unchanged output format, but new snapshot stored)
- ✅ POST /api/operation/approve (new: approve execute)
- ✅ POST /api/operation/execute (updated: validate approval)
- ✅ POST /api/operation/undo-dryrun (new: undo preview)
- ✅ POST /api/operation/approve-undo (new: approve undo)
- ✅ POST /api/operation/undo-execute (new: execute undo)
- ✅ GET /api/operation/{id} (new: get operation details + status)
- ✅ GET /api/events (new: retrieve event log)
- ✅ GET /api/audit-trail (new: formatted audit report)

### State Machine Completeness
- ✅ All 15 states defined
- ✅ All valid transitions documented
- ✅ All state invariants enforced in code
- ✅ All terminal states identified

### Safety Invariants (All Enforced)
- ✅ No destructive action without explicit approval
- ✅ Every reversible operation supports undo
- ✅ Undo requires explicit approval (separate token)
- ✅ Protected messages excluded by policy (configurable)
- ✅ Full pre-operation state required before execution
- ✅ All executions + undos audited
- ✅ No email bodies in logs or DB
- ✅ Execution idempotent and retry-safe

### Test Coverage
- ✅ State machine transitions (happy path + edge cases)
- ✅ Policy filtering (all exclusion types)
- ✅ Snapshot integrity (snapshots never modified)
- ✅ Undo restoration (messages restored to original state)
- ✅ Partial failure (some batches fail, undo still works)
- ✅ Idempotence (duplicate batch calls return same result)
- ✅ Event logging (all state changes logged)
- ✅ Approval tokens (separate tokens for execute/undo)

### Documentation Completeness
- ✅ Design doc (this document) complete
- ✅ Specification document complete
- ✅ Schema migration guide (v0 → v1)
- ✅ API endpoint documentation
- ✅ State machine diagram
- ✅ Example payloads for all endpoints
- ✅ Troubleshooting guide for partial failures

---

## 11. High-Level Schema Overview

### New/Modified Tables (Enterprise v1)

```
oauth_tokens              (unchanged)
message_metadata          (unchanged)
sync_state               (unchanged)
categorization_cache     (unchanged)
operations               (MODIFIED: add status, approval fields)

NEW: operation_snapshots     (full operation state at dry-run time)
NEW: message_snapshots       (pre-operation label state for each message)
NEW: approval_tokens         (separate tokens for execute & undo)
NEW: event_log               (immutable event stream)
NEW: batch_execution_log     (track executed batches for idempotence)
NEW: undo_batch_execution_log (track undo batches for idempotence)
```

### Key Additions

**operation_snapshots**
- Stores complete operation state at dry-run time
- Immutable after creation
- Used to restore during undo
- Contains policy snapshot, message counts, affected_count

**message_snapshots**
- Stores original label state for each affected message
- Linked to operation_snapshots via operation_id
- Used during undo to restore labels
- Never modified

**approval_tokens**
- Separate tokens for each operation (execute & undo)
- Tokens are short-lived (expire after use or 24 hours)
- Validated before state transitions

**event_log**
- Append-only audit trail
- Every state change generates event
- Contains full context (no bodies)
- Indexed on operation_id, event_type, timestamp

**batch_execution_log**
- Tracks which batches have been executed
- Enables resumable & idempotent execution
- Soft links to operations (survives operation deletion)

---

## 12. Enterprise Requirements Checklist

### Reversibility
- [ ] Every ARCHIVE/LABEL/TRASH operation is undoable
- [ ] Undo uses pre-operation snapshot (not current Gmail state)
- [ ] Undo is idempotent (can retry safely)
- [ ] Undo requires explicit approval (separate token)

### State & Snapshots
- [ ] Full message state captured before execution
- [ ] Snapshots include: labels, starred, unread, dates
- [ ] Snapshots stored in DB before Gmail API call
- [ ] Snapshots never modified (INSERT-only)

### Lifecycle & States
- [ ] 15 defined states with clear semantics
- [ ] State machine unambiguous (no race conditions)
- [ ] Terminal states well-defined
- [ ] Approval gates between phases

### Policy Engine
- [ ] PolicyEngine class with configurable rules
- [ ] Default policy: exclude starred + important
- [ ] Policy evaluated once at snapshot time
- [ ] Policy snapshot stored immutably

### Audit Trail
- [ ] Event log captures every state transition
- [ ] Events never deleted or modified
- [ ] Events include full context (no bodies)
- [ ] User-attributed (user_email on every event)

### Partial Failures
- [ ] Batch failures don't block undo
- [ ] Partial success visible in operation status
- [ ] Undo works even on COMPLETED_WITH_ERRORS

### Idempotence
- [ ] Execution batch log prevents duplicates
- [ ] Undo execution also tracked for idempotence
- [ ] Retries return cached results

### Safety
- [ ] No Gmail API call during dry-run
- [ ] No execute without approval token
- [ ] No undo without separate approval token
- [ ] Protected messages excluded by default

---

## 13. Known Limitations (Enterprise v1)

### By Design (Non-Negotiable)
- **Single-User Session**: No multi-user conflict resolution
- **Not Scheduled**: Undo only available for 24 hours post-execution
- **Explicit Undo**: Cannot undo arbitrary prior operation (only last)
- **Local Storage**: SQLite only; no cloud sync

### API Constraints
- **Batch Size**: Limited to 500 messages per batch (Gmail API limit)
- **Idempotency Window**: 24 hours (older operations can't be redone)
- **Rate Limiting**: Gmail API ~1 req/sec ; backoff handled

### Future Enhancements (Out of Scope)
- Policy versioning (git-style policy history)
- Selective undo (undo specific messages, not all)
- Scheduled undo (auto-undo after N days)
- Distributed multi-session consistency

---

## 14. Migration Path (v0 → v1)

### Backward Compatibility
- v0 operations table remains
- v1 adds new tables alongside v0
- UI shows "undo" only for v1 operations (new ones)
- v0 operations can't be undone (no snapshots)

### Migration Strategy
1. Deploy v1 backend (new tables, no breaking changes)
2. New operations use v1 flow (snapshots created)
3. Existing v0 operations: "Undo unavailable (legacy operation)"
4. Optional: batch-migrate v0 operations to v1 (recreate snapshots)

---

## 15. Next Step: Specification

See: `specs/gmail-inbox-cleanup-enterprise-v1.md`

The spec will detail:
1. Required schema changes (DDL)
2. Required API endpoints (with examples)
3. Required UI changes (with mockups)
4. Required tests
5. Stop condition & delivery checklist

---

**Design Owner**: Architecture Team  
**Next Phase**: Specification & Implementation  
**Approval Gate**: Design review before spec finalization

