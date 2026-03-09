/**
 * State Machine: Unified 15-state lifecycle for gmail-cleanup-enterprise-v1
 * Spec: Single operations.status field, no separate undo_status
 * States: DRAFT → PENDING_APPROVAL → APPROVED → EXECUTING/UNDO_EXECUTING → SUCCEEDED/FAILED/UNKNOWN
 */

// State enum - unified single status field
export const OperationState = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  EXECUTING: 'EXECUTING',
  PENDING_UNDO: 'PENDING_UNDO',
  UNDO_EXECUTING: 'UNDO_EXECUTING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
  UNDO_SUCCEEDED: 'UNDO_SUCCEEDED',
  UNDO_FAILED: 'UNDO_FAILED',
  UNDO_UNKNOWN: 'UNDO_UNKNOWN',
};

// Terminal states - no further transitions allowed
// Note: SUCCEEDED and UNKNOWN can transition to PENDING_UNDO, so they're not truly terminal
const TERMINAL_STATES = [
  OperationState.UNDO_SUCCEEDED,
  OperationState.UNDO_FAILED,
  OperationState.UNDO_UNKNOWN,
  // FAILED, SUCCEEDED, UNKNOWN are non-terminal (allow retry/undo)
];

// Valid state transitions (from → to [])
const VALID_TRANSITIONS = {
  [OperationState.DRAFT]: [
    OperationState.PENDING_APPROVAL, // User initiates approval
  ],
  [OperationState.PENDING_APPROVAL]: [
    OperationState.APPROVED, // Admin approves
    OperationState.DRAFT, // Cancel/reject
  ],
  [OperationState.APPROVED]: [
    OperationState.EXECUTING, // Execution starts
    OperationState.DRAFT, // Cancel before execution
  ],
  [OperationState.EXECUTING]: [
    OperationState.SUCCEEDED, // All succeeded
    OperationState.FAILED, // All failed or too many failures
    OperationState.UNKNOWN, // Conflicts detected
  ],
  [OperationState.SUCCEEDED]: [
    OperationState.PENDING_UNDO, // User requests undo
  ],
  [OperationState.FAILED]: [
    OperationState.PENDING_UNDO, // Can undo partial results (rare)
    OperationState.APPROVED, // Retry whole operation (rare)
  ],
  [OperationState.UNKNOWN]: [
    OperationState.PENDING_UNDO, // User requests undo despite conflicts
  ],
  [OperationState.PENDING_UNDO]: [
    OperationState.UNDO_EXECUTING, // Admin approves undo
    OperationState.SUCCEEDED, // Cancel undo request
  ],
  [OperationState.UNDO_EXECUTING]: [
    OperationState.UNDO_SUCCEEDED, // All restored
    OperationState.UNDO_FAILED, // Restoration failed
    OperationState.UNDO_UNKNOWN, // Conflicts during undo
  ],
  // Terminal states - no transitions out
  [OperationState.UNDO_SUCCEEDED]: [],
  [OperationState.UNDO_FAILED]: [],
  [OperationState.UNDO_UNKNOWN]: [],
};

/**
 * Check if a state transition is valid
 * @param {string} currentState - Current state
 * @param {string} targetState - Desired next state
 * @returns {boolean} True if transition is allowed
 */
export function isValidTransition(currentState, targetState) {
  if (!VALID_TRANSITIONS[currentState]) {
    return false; // Unknown current state
  }
  return VALID_TRANSITIONS[currentState].includes(targetState);
}

/**
 * Get all valid next states from current state
 * @param {string} currentState - Current state
 * @returns {string[]} Array of valid next states
 */
export function getValidNextStates(currentState) {
  return VALID_TRANSITIONS[currentState] || [];
}

/**
 * Check if state is terminal (operation complete)
 * @param {string} state - Current state
 * @returns {boolean} True if no further transitions possible
 */
export function isTerminalState(state) {
  return TERMINAL_STATES.includes(state);
}

/**
 * Compute terminal state from operation outcomes
 * Used at end of EXECUTING or UNDO_EXECUTING phase
 * Rules:
 *   - If all outcomes SUCCEEDED → return SUCCEEDED (or UNDO_SUCCEEDED if undo phase)
 *   - If all outcomes FAILED → return FAILED (or UNDO_FAILED if undo phase)
 *   - If any outcome UNKNOWN or mix of outcomes → return UNKNOWN (or UNDO_UNKNOWN if undo phase)
 *
 * @param {object[]} outcomes - Array of { status: SUCCEEDED|FAILED|UNKNOWN }
 * @param {string} executionType - 'EXECUTE' or 'UNDO_EXECUTE'
 * @returns {string} Terminal state (SUCCEEDED|FAILED|UNKNOWN or undo variants)
 */
export function computeTerminalState(outcomes, executionType = 'EXECUTE') {
  if (!outcomes || outcomes.length === 0) {
    // No outcomes means unexpected error
    return executionType === 'EXECUTE'
      ? OperationState.UNKNOWN
      : OperationState.UNDO_UNKNOWN;
  }

  const statusCounts = {
    SUCCEEDED: 0,
    FAILED: 0,
    UNKNOWN: 0,
  };

  for (const outcome of outcomes) {
    if (statusCounts.hasOwnProperty(outcome.status)) {
      statusCounts[outcome.status]++;
    }
  }

  // Compute result
  const total = outcomes.length;
  const succeeded = statusCounts.SUCCEEDED;
  const failed = statusCounts.FAILED;
  const unknown = statusCounts.UNKNOWN;

  // Determine terminal state
  let terminalState;

  if (unknown > 0) {
    // Any UNKNOWN outcome makes whole operation UNKNOWN (conflicts detected)
    terminalState =
      executionType === 'EXECUTE'
        ? OperationState.UNKNOWN
        : OperationState.UNDO_UNKNOWN;
  } else if (failed === 0) {
    // All succeeded (no unknown, no failed)
    terminalState =
      executionType === 'EXECUTE'
        ? OperationState.SUCCEEDED
        : OperationState.UNDO_SUCCEEDED;
  } else if (succeeded === 0) {
    // All failed (no succeeded, no unknown)
    terminalState =
      executionType === 'EXECUTE'
        ? OperationState.FAILED
        : OperationState.UNDO_FAILED;
  } else {
    // Mix of succeeded and failed (no unknown) → treat as FAILED
    terminalState =
      executionType === 'EXECUTE'
        ? OperationState.FAILED
        : OperationState.UNDO_FAILED;
  }

  return terminalState;
}

/**
 * Check if operation can transition to EXECUTING
 * @param {string} currentState - Current state
 * @returns {boolean} True if ready to execute
 */
export function canExecute(currentState) {
  return currentState === OperationState.APPROVED;
}

/**
 * Check if operation can transition to UNDO_EXECUTING
 * @param {string} currentState - Current state
 * @returns {boolean} True if ready to undo
 */
export function canUndo(currentState) {
  return currentState === OperationState.PENDING_UNDO;
}

/**
 * Check if operation can be retried
 * Retry means transiting from a non-terminal state back to APPROVED or EXECUTING
 * @param {string} currentState - Current state
 * @returns {boolean} True if can retry
 */
export function canRetry(currentState) {
  // Only FAILED allows transitioning back to APPROVED for retry
  return currentState === OperationState.FAILED;
}

/**
 * Get next state when executing phase completes successfully
 * @param {object[]} outcomes - { status: SUCCEEDED|FAILED|UNKNOWN }
 * @returns {string} Next state (SUCCEEDED|FAILED|UNKNOWN)
 */
export function transitionExecutionPhaseComplete(outcomes) {
  return computeTerminalState(outcomes, 'EXECUTE');
}

/**
 * Get next state when undo phase completes
 * @param {object[]} outcomes - { status: SUCCEEDED|FAILED|UNKNOWN }
 * @returns {string} Next state (UNDO_SUCCEEDED|UNDO_FAILED|UNDO_UNKNOWN)
 */
export function transitionUndoPhaseComplete(outcomes) {
  return computeTerminalState(outcomes, 'UNDO_EXECUTE');
}

/**
 * Validate state value
 * @param {string} state - State to validate
 * @returns {boolean} True if valid state
 */
export function isValidState(state) {
  return Object.values(OperationState).includes(state);
}

/**
 * Get operation completion percentage
 * Returns estimated progress based on current state
 * @param {string} currentState - Current state
 * @param {number} attempt - Current attempt number
 * @param {number} maxAttempts - Maximum retries
 * @returns {number} Progress 0-100
 */
export function getEstimatedProgress(currentState, attempt = 1, maxAttempts = 3) {
  const stateProgress = {
    [OperationState.DRAFT]: 5,
    [OperationState.PENDING_APPROVAL]: 10,
    [OperationState.APPROVED]: 15,
    [OperationState.EXECUTING]: 50, // In progress
    [OperationState.PENDING_UNDO]: 60,
    [OperationState.UNDO_EXECUTING]: 85,
    [OperationState.SUCCEEDED]: 100,
    [OperationState.FAILED]: 100,
    [OperationState.UNKNOWN]: 100,
    [OperationState.UNDO_SUCCEEDED]: 100,
    [OperationState.UNDO_FAILED]: 100,
    [OperationState.UNDO_UNKNOWN]: 100,
  };

  return stateProgress[currentState] || 0;
}

/**
 * Check if state is in undo phase
 * @param {string} state - Current state
 * @returns {boolean} True if state is related to undo
 */
export function isUndoPhase(state) {
  return [
    OperationState.PENDING_UNDO,
    OperationState.UNDO_EXECUTING,
    OperationState.UNDO_SUCCEEDED,
    OperationState.UNDO_FAILED,
    OperationState.UNDO_UNKNOWN,
  ].includes(state);
}

/**
 * Check if state is in execute phase
 * @param {string} state - Current state
 * @returns {boolean} True if state is related to execution
 */
export function isExecutePhase(state) {
  return [
    OperationState.DRAFT,
    OperationState.PENDING_APPROVAL,
    OperationState.APPROVED,
    OperationState.EXECUTING,
  ].includes(state);
}

/**
 * Get human-readable state description
 * @param {string} state - Current state
 * @returns {string} Human-readable description
 */
export function getStateDescription(state) {
  const descriptions = {
    [OperationState.DRAFT]: 'Initializing operation (dry-run)',
    [OperationState.PENDING_APPROVAL]: 'Awaiting admin approval',
    [OperationState.APPROVED]: 'Approved, ready to execute',
    [OperationState.EXECUTING]: 'Executing operation on messages',
    [OperationState.PENDING_UNDO]: 'Awaiting undo approval',
    [OperationState.UNDO_EXECUTING]: 'Restoring original message state',
    [OperationState.SUCCEEDED]: 'Operation completed successfully',
    [OperationState.FAILED]: 'Operation failed (see error details)',
    [OperationState.UNKNOWN]:
      'Operation state unknown (conflicts detected, manual review needed)',
    [OperationState.UNDO_SUCCEEDED]: 'Undo completed successfully',
    [OperationState.UNDO_FAILED]: 'Undo failed (see error details)',
    [OperationState.UNDO_UNKNOWN]:
      'Undo state unknown (conflicts detected, manual review needed)',
  };

  return descriptions[state] || 'Unknown state';
}

/**
 * Validate state machine consistency
 *  (For testing/debugging)
 * @returns {object} Validation report { valid: boolean, issues: string[] }
 */
export function validateStateMachine() {
  const issues = [];

  // Check all states in VALID_TRANSITIONS exist in OperationState
  for (const [state] of Object.entries(VALID_TRANSITIONS)) {
    if (!isValidState(state)) {
      issues.push(`Invalid state in transitions: ${state}`);
    }
  }

  // Check all target states exist
  for (const [state, targets] of Object.entries(VALID_TRANSITIONS)) {
    for (const target of targets) {
      if (!isValidState(target)) {
        issues.push(
          `Invalid target state: ${state} → ${target}`
        );
      }
    }
  }

  // Check terminal states have no outgoing transitions (or empty arrays)
  for (const terminalState of TERMINAL_STATES) {
    const transitions = VALID_TRANSITIONS[terminalState] || [];
    if (transitions.length > 0) {
      issues.push(
        `Terminal state ${terminalState} has outgoing transitions: ${transitions.join(', ')}`
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
