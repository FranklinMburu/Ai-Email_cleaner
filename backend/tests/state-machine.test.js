import { describe, test, expect } from '@jest/globals';
import {
  OperationState,
  isValidTransition,
  getValidNextStates,
  isTerminalState,
  computeTerminalState,
  canExecute,
  canUndo,
  canRetry,
  transitionExecutionPhaseComplete,
  transitionUndoPhaseComplete,
  isValidState,
  getEstimatedProgress,
  isUndoPhase,
  isExecutePhase,
  getStateDescription,
  validateStateMachine,
} from '../src/state-machine.js';

describe('State Machine', () => {
  describe('State Enum', () => {
    test('should have all 12 required states', () => {
      const expectedStates = [
        'DRAFT',
        'PENDING_APPROVAL',
        'APPROVED',
        'EXECUTING',
        'PENDING_UNDO',
        'UNDO_EXECUTING',
        'SUCCEEDED',
        'FAILED',
        'UNKNOWN',
        'UNDO_SUCCEEDED',
        'UNDO_FAILED',
        'UNDO_UNKNOWN',
      ];

      for (const state of expectedStates) {
        expect(OperationState[state]).toBe(state);
      }
    });
  });

  describe('isValidTransition', () => {
    test('should allow DRAFT → PENDING_APPROVAL', () => {
      expect(
        isValidTransition(OperationState.DRAFT, OperationState.PENDING_APPROVAL)
      ).toBe(true);
    });

    test('should allow PENDING_APPROVAL → APPROVED', () => {
      expect(
        isValidTransition(OperationState.PENDING_APPROVAL, OperationState.APPROVED)
      ).toBe(true);
    });

    test('should allow APPROVED → EXECUTING', () => {
      expect(
        isValidTransition(OperationState.APPROVED, OperationState.EXECUTING)
      ).toBe(true);
    });

    test('should allow EXECUTING → SUCCEEDED/FAILED/UNKNOWN', () => {
      expect(
        isValidTransition(OperationState.EXECUTING, OperationState.SUCCEEDED)
      ).toBe(true);
      expect(
        isValidTransition(OperationState.EXECUTING, OperationState.FAILED)
      ).toBe(true);
      expect(
        isValidTransition(OperationState.EXECUTING, OperationState.UNKNOWN)
      ).toBe(true);
    });

    test('should allow SUCCEEDED → PENDING_UNDO', () => {
      expect(
        isValidTransition(OperationState.SUCCEEDED, OperationState.PENDING_UNDO)
      ).toBe(true);
    });

    test('should allow PENDING_UNDO → UNDO_EXECUTING', () => {
      expect(
        isValidTransition(OperationState.PENDING_UNDO, OperationState.UNDO_EXECUTING)
      ).toBe(true);
    });

    test('should allow UNDO_EXECUTING → UNDO_SUCCEEDED/UNDO_FAILED/UNDO_UNKNOWN', () => {
      expect(
        isValidTransition(OperationState.UNDO_EXECUTING, OperationState.UNDO_SUCCEEDED)
      ).toBe(true);
      expect(
        isValidTransition(OperationState.UNDO_EXECUTING, OperationState.UNDO_FAILED)
      ).toBe(true);
      expect(
        isValidTransition(OperationState.UNDO_EXECUTING, OperationState.UNDO_UNKNOWN)
      ).toBe(true);
    });

    test('should allow cancellation APPROVED → DRAFT', () => {
      expect(
        isValidTransition(OperationState.APPROVED, OperationState.DRAFT)
      ).toBe(true);
    });

    test('should allow retry FAILED → APPROVED', () => {
      expect(
        isValidTransition(OperationState.FAILED, OperationState.APPROVED)
      ).toBe(true);
    });

    test('should reject invalid backward transitions (EXECUTING → APPROVED)', () => {
      expect(
        isValidTransition(OperationState.EXECUTING, OperationState.APPROVED)
      ).toBe(false);
    });

    test('should reject cross-path transitions (EXECUTING → UNDO_EXECUTING)', () => {
      expect(
        isValidTransition(OperationState.EXECUTING, OperationState.UNDO_EXECUTING)
      ).toBe(false);
    });

    test('should reject terminal state transitions (SUCCEEDED → FAILED)', () => {
      expect(
        isValidTransition(OperationState.SUCCEEDED, OperationState.FAILED)
      ).toBe(false);
    });

    test('should reject unknown states', () => {
      expect(isValidTransition('INVALID_STATE', OperationState.DRAFT)).toBe(
        false
      );
    });
  });

  describe('getValidNextStates', () => {
    test('should return valid next states from DRAFT', () => {
      const nextStates = getValidNextStates(OperationState.DRAFT);
      expect(nextStates).toContain(OperationState.PENDING_APPROVAL);
      expect(nextStates.length).toBeGreaterThan(0);
    });

    test('should identify FAILED as non-terminal (allows retry)', () => {
      expect(isTerminalState(OperationState.FAILED)).toBe(false);
    });

    test('should return valid next states for non-terminal states', () => {
      // SUCCEEDED is not completely terminal - allows undo
      expect(getValidNextStates(OperationState.SUCCEEDED)).toContain(
        OperationState.PENDING_UNDO
      );
      // UNKNOWN allows undo
      expect(getValidNextStates(OperationState.UNKNOWN)).toContain(
        OperationState.PENDING_UNDO
      );
    });

    test('should return empty array for truly final states', () => {
      // Only these are truly terminal with no further transitions
      expect(getValidNextStates(OperationState.UNDO_SUCCEEDED)).toEqual([]);
      expect(getValidNextStates(OperationState.UNDO_FAILED)).toEqual([]);
      expect(getValidNextStates(OperationState.UNDO_UNKNOWN)).toEqual([]);
    });
  });

  describe('isTerminalState', () => {
    test('should identify SUCCEEDED as terminal', () => {
      expect(isTerminalState(OperationState.SUCCEEDED)).toBe(true);
    });

    test('should identify FAILED as non-terminal (allows retry)', () => {
      expect(isTerminalState(OperationState.FAILED)).toBe(false); // FAILED allows retry
    });

    test('should identify UNKNOWN as terminal', () => {
      expect(isTerminalState(OperationState.UNKNOWN)).toBe(true);
    });

    test('should identify UNDO_SUCCEEDED as terminal', () => {
      expect(isTerminalState(OperationState.UNDO_SUCCEEDED)).toBe(true);
    });

    test('should identify UNDO_FAILED as terminal', () => {
      expect(isTerminalState(OperationState.UNDO_FAILED)).toBe(true);
    });

    test('should identify UNDO_UNKNOWN as terminal', () => {
      expect(isTerminalState(OperationState.UNDO_UNKNOWN)).toBe(true);
    });

    test('should not identify EXECUTING as terminal', () => {
      expect(isTerminalState(OperationState.EXECUTING)).toBe(false);
    });

    test('should not identify PENDING_APPROVAL as terminal', () => {
      expect(isTerminalState(OperationState.PENDING_APPROVAL)).toBe(false);
    });
  });

  describe('computeTerminalState', () => {
    test('should return SUCCEEDED when all outcomes succeeded', () => {
      const outcomes = [
        { status: 'SUCCEEDED' },
        { status: 'SUCCEEDED' },
        { status: 'SUCCEEDED' },
      ];
      expect(computeTerminalState(outcomes, 'EXECUTE')).toBe(
        OperationState.SUCCEEDED
      );
    });

    test('should return FAILED when all outcomes failed', () => {
      const outcomes = [
        { status: 'FAILED' },
        { status: 'FAILED' },
        { status: 'FAILED' },
      ];
      expect(computeTerminalState(outcomes, 'EXECUTE')).toBe(
        OperationState.FAILED
      );
    });

    test('should return UNKNOWN when any outcome is UNKNOWN', () => {
      const outcomes = [
        { status: 'SUCCEEDED' },
        { status: 'UNKNOWN' },
        { status: 'SUCCEEDED' },
      ];
      expect(computeTerminalState(outcomes, 'EXECUTE')).toBe(
        OperationState.UNKNOWN
      );
    });

    test('should return FAILED when mix of SUCCEEDED and FAILED', () => {
      const outcomes = [
        { status: 'SUCCEEDED' },
        { status: 'FAILED' },
        { status: 'SUCCEEDED' },
      ];
      expect(computeTerminalState(outcomes, 'EXECUTE')).toBe(
        OperationState.FAILED
      );
    });

    test('should return UNDO_SUCCEEDED for undo execution', () => {
      const outcomes = [
        { status: 'SUCCEEDED' },
        { status: 'SUCCEEDED' },
      ];
      expect(computeTerminalState(outcomes, 'UNDO_EXECUTE')).toBe(
        OperationState.UNDO_SUCCEEDED
      );
    });

    test('should return UNDO_FAILED for undo execution', () => {
      const outcomes = [
        { status: 'FAILED' },
        { status: 'FAILED' },
      ];
      expect(computeTerminalState(outcomes, 'UNDO_EXECUTE')).toBe(
        OperationState.UNDO_FAILED
      );
    });

    test('should return UNDO_UNKNOWN for undo execution with conflicts', () => {
      const outcomes = [
        { status: 'SUCCEEDED' },
        { status: 'UNKNOWN' },
      ];
      expect(computeTerminalState(outcomes, 'UNDO_EXECUTE')).toBe(
        OperationState.UNDO_UNKNOWN
      );
    });

    test('should handle empty outcomes array', () => {
      const result = computeTerminalState([], 'EXECUTE');
      expect(result).toBe(OperationState.UNKNOWN);
    });

    test('should handle null outcomes', () => {
      const result = computeTerminalState(null, 'EXECUTE');
      expect(result).toBe(OperationState.UNKNOWN);
    });
  });

  describe('canExecute', () => {
    test('should allow execution from APPROVED state', () => {
      expect(canExecute(OperationState.APPROVED)).toBe(true);
    });

    test('should not allow execution from other states', () => {
      expect(canExecute(OperationState.DRAFT)).toBe(false);
      expect(canExecute(OperationState.PENDING_APPROVAL)).toBe(false);
      expect(canExecute(OperationState.EXECUTING)).toBe(false);
      expect(canExecute(OperationState.SUCCEEDED)).toBe(false);
    });
  });

  describe('canUndo', () => {
    test('should allow undo from PENDING_UNDO state', () => {
      expect(canUndo(OperationState.PENDING_UNDO)).toBe(true);
    });

    test('should not allow undo from other states', () => {
      expect(canUndo(OperationState.SUCCEEDED)).toBe(false);
      expect(canUndo(OperationState.EXECUTING)).toBe(false);
      expect(canUndo(OperationState.PENDING_APPROVAL)).toBe(false);
    });
  });

  describe('canRetry', () => {
    test('should allow retry from FAILED state', () => {
      expect(canRetry(OperationState.FAILED)).toBe(true);
    });

    test('should not allow retry from other states', () => {
      expect(canRetry(OperationState.SUCCEEDED)).toBe(false);
      expect(canRetry(OperationState.UNKNOWN)).toBe(false);
      expect(canRetry(OperationState.EXECUTING)).toBe(false);
    });
  });

  describe('transitionExecutionPhaseComplete', () => {
    test('should compute correct terminal state for execution', () => {
      const outcomes = [
        { status: 'SUCCEEDED' },
        { status: 'SUCCEEDED' },
      ];
      expect(transitionExecutionPhaseComplete(outcomes)).toBe(
        OperationState.SUCCEEDED
      );
    });
  });

  describe('transitionUndoPhaseComplete', () => {
    test('should compute correct terminal state for undo', () => {
      const outcomes = [
        { status: 'SUCCEEDED' },
        { status: 'SUCCEEDED' },
      ];
      expect(transitionUndoPhaseComplete(outcomes)).toBe(
        OperationState.UNDO_SUCCEEDED
      );
    });
  });

  describe('isValidState', () => {
    test('should validate known states', () => {
      expect(isValidState(OperationState.DRAFT)).toBe(true);
      expect(isValidState(OperationState.SUCCEEDED)).toBe(true);
      expect(isValidState(OperationState.UNDO_UNKNOWN)).toBe(true);
    });

    test('should reject unknown states', () => {
      expect(isValidState('INVALID')).toBe(false);
      expect(isValidState('')).toBe(false);
      expect(isValidState(null)).toBe(false);
    });
  });

  describe('getEstimatedProgress', () => {
    test('should return 0-100 range for all states', () => {
      const allStates = Object.values(OperationState);
      for (const state of allStates) {
        const progress = getEstimatedProgress(state);
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThanOrEqual(100);
      }
    });

    test('should return 100 for terminal states', () => {
      expect(getEstimatedProgress(OperationState.SUCCEEDED)).toBe(100);
      expect(getEstimatedProgress(OperationState.FAILED)).toBe(100);
      expect(getEstimatedProgress(OperationState.UNKNOWN)).toBe(100);
      expect(getEstimatedProgress(OperationState.UNDO_SUCCEEDED)).toBe(100);
    });

    test('should return 50 for EXECUTING state', () => {
      expect(getEstimatedProgress(OperationState.EXECUTING)).toBe(50);
    });
  });

  describe('isUndoPhase', () => {
    test('should identify undo-related states', () => {
      expect(isUndoPhase(OperationState.PENDING_UNDO)).toBe(true);
      expect(isUndoPhase(OperationState.UNDO_EXECUTING)).toBe(true);
      expect(isUndoPhase(OperationState.UNDO_SUCCEEDED)).toBe(true);
      expect(isUndoPhase(OperationState.UNDO_FAILED)).toBe(true);
      expect(isUndoPhase(OperationState.UNDO_UNKNOWN)).toBe(true);
    });

    test('should not identify execute-related states as undo', () => {
      expect(isUndoPhase(OperationState.DRAFT)).toBe(false);
      expect(isUndoPhase(OperationState.APPROVED)).toBe(false);
      expect(isUndoPhase(OperationState.EXECUTING)).toBe(false);
      expect(isUndoPhase(OperationState.SUCCEEDED)).toBe(false);
    });
  });

  describe('isExecutePhase', () => {
    test('should identify execute-related states', () => {
      expect(isExecutePhase(OperationState.DRAFT)).toBe(true);
      expect(isExecutePhase(OperationState.PENDING_APPROVAL)).toBe(true);
      expect(isExecutePhase(OperationState.APPROVED)).toBe(true);
      expect(isExecutePhase(OperationState.EXECUTING)).toBe(true);
    });

    test('should not identify undo-related states as execute', () => {
      expect(isExecutePhase(OperationState.PENDING_UNDO)).toBe(false);
      expect(isExecutePhase(OperationState.UNDO_EXECUTING)).toBe(false);
      expect(isExecutePhase(OperationState.UNDO_SUCCEEDED)).toBe(false);
    });
  });

  describe('getStateDescription', () => {
    test('should return description for all states', () => {
      const allStates = Object.values(OperationState);
      for (const state of allStates) {
        const description = getStateDescription(state);
        expect(description).toBeTruthy();
        expect(description.length).toBeGreaterThan(0);
        expect(description).not.toBe('Unknown state'); // Should have specific descriptions
      }
    });

    test('should return Unknown state for invalid state', () => {
      expect(getStateDescription('INVALID')).toBe('Unknown state');
    });
  });

  describe('validateStateMachine', () => {
    test('should validate state machine consistency', () => {
      const validation = validateStateMachine();
      expect(validation.valid).toBe(true);
      expect(validation.issues).toEqual([]);
    });
  });

  describe('Full workflow paths', () => {
    test('should allow complete execute → succeed → undo → undo_succeed flow', () => {
      let state = OperationState.DRAFT;
      expect(isValidTransition(state, OperationState.PENDING_APPROVAL)).toBe(true);
      state = OperationState.PENDING_APPROVAL;

      expect(isValidTransition(state, OperationState.APPROVED)).toBe(true);
      state = OperationState.APPROVED;

      expect(canExecute(state)).toBe(true);
      expect(isValidTransition(state, OperationState.EXECUTING)).toBe(true);
      state = OperationState.EXECUTING;

      const outcomes = [{ status: 'SUCCEEDED' }];
      state = computeTerminalState(outcomes, 'EXECUTE');
      expect(state).toBe(OperationState.SUCCEEDED);

      expect(isValidTransition(state, OperationState.PENDING_UNDO)).toBe(true);
      state = OperationState.PENDING_UNDO;

      expect(canUndo(state)).toBe(true);
      expect(isValidTransition(state, OperationState.UNDO_EXECUTING)).toBe(true);
      state = OperationState.UNDO_EXECUTING;

      const undoOutcomes = [{ status: 'SUCCEEDED' }];
      state = computeTerminalState(undoOutcomes, 'UNDO_EXECUTE');
      expect(state).toBe(OperationState.UNDO_SUCCEEDED);
      expect(isTerminalState(state)).toBe(true);
    });

    test('should allow conflict detection flow', () => {
      let state = OperationState.APPROVED;
      state = OperationState.EXECUTING;

      const outcomes = [
        { status: 'SUCCEEDED' },
        { status: 'UNKNOWN' }, // Conflict detected
      ];
      state = computeTerminalState(outcomes, 'EXECUTE');
      expect(state).toBe(OperationState.UNKNOWN);

      expect(isValidTransition(state, OperationState.PENDING_UNDO)).toBe(true);
    });
  });
});
