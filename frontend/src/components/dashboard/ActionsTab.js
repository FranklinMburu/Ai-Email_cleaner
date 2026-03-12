import React, { useState } from 'react';
import api from '../../services/api';
import { EmptyState } from '../common/EmptyState';
import { LoadingState } from '../common/LoadingState';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PresetManager } from './PresetManager';
import { truncateText } from '../../utils/formatters';

/**
 * ActionsTab - Dry-run and execute operations
 */
export function ActionsTab({ data, onOperationExecuted, notifications }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [actionType, setActionType] = useState('ARCHIVE');
  const [dryRunResult, setDryRunResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const report = data.report;

  const handleDryRun = async () => {
    if (!selectedCategory) {
      notifications.warning('Please select a category first');
      return;
    }

    try {
      setLoading(true);
      const res = await api.operations.dryRun(actionType, [selectedCategory], null);
      setDryRunResult(res.data);
      notifications.success('Dry-run preview generated');
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      notifications.error('Dry-run failed: ' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteClick = () => {
    setShowConfirm(true);
  };

  const handleExecuteConfirm = async () => {
    if (!dryRunResult) {
      notifications.warning('Run dry-run first');
      return;
    }

    setShowConfirm(false);

    try {
      setLoading(true);
      await api.operations.execute(
        dryRunResult.operationId,
        actionType,
        [selectedCategory],
        null,
        dryRunResult.approvalToken
      );
      
      notifications.success('Operation completed successfully!');
      setDryRunResult(null);
      setSelectedCategory(null);
      
      if (onOperationExecuted) {
        onOperationExecuted();
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      notifications.error('Operation failed: ' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadOperationPreset = (preset) => {
    // Apply the saved operation preset
    if (preset && preset.config) {
      setActionType(preset.config.operationType || 'ARCHIVE');
      if (preset.config.categoryId) {
        setSelectedCategory(preset.config.categoryId);
      }
      notifications.success(`Loaded preset: ${preset.name}`);
    }
  };

  if (!report) {
    return (
      <div className="tab-pane">
        <EmptyState
          title="No recommendations available"
          message="Generate recommendations first."
        />
      </div>
    );
  }

  return (
    <div className="tab-pane">
      <PresetManager presetType="operations" onLoadPreset={handleLoadOperationPreset} />

      <h2>Action Composer</h2>

      <div className="composer-section">
        <label>
          <strong>Select Category:</strong>
          <select
            value={selectedCategory || ''}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="">-- Choose --</option>
            {report.categories.map((cat) => (
              <option key={cat.categoryId} value={cat.categoryId}>
                {cat.name} ({cat.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          <strong>Action:</strong>
          <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
            <option value="ARCHIVE">Archive</option>
            <option value="LABEL">Label</option>
            <option value="TRASH">Trash</option>
          </select>
        </label>

        <button
          onClick={handleDryRun}
          disabled={!selectedCategory || loading}
          className="btn btn-primary"
        >
          {loading && !dryRunResult ? 'Loading...' : 'Preview (Dry Run)'}
        </button>
      </div>

      {loading && dryRunResult && (
        <div className="loading-overlay">
          <LoadingState message="Executing operation..." size="small" />
        </div>
      )}

      {dryRunResult && !loading && (
        <div className="dryrun-results">
          <h3>Dry Run Preview</h3>
          <div className="results-box">
            <p>
              <strong>Total affected:</strong> {dryRunResult.totalAffected}
            </p>
            <p>
              <strong>Batches:</strong> {dryRunResult.batchCount}
            </p>
            <p>
              <strong>Estimated time:</strong> {dryRunResult.estimatedTimeSeconds}s
            </p>

            {dryRunResult.riskAssessment && (
              <div className="risk-assessment">
                <strong>Risk Assessment:</strong>
                <ul>
                  {dryRunResult.riskAssessment.protectedEmailConflict > 0 && (
                    <li>
                      ⚠ {dryRunResult.riskAssessment.protectedEmailConflict} protected
                      emails (starred/important)
                    </li>
                  )}
                  {dryRunResult.riskAssessment.recentEmailConflict > 0 && (
                    <li>
                      ℹ {dryRunResult.riskAssessment.recentEmailConflict} recent emails
                    </li>
                  )}
                  {dryRunResult.riskAssessment.unreadEmailConflict > 0 && (
                    <li>
                      ℹ {dryRunResult.riskAssessment.unreadEmailConflict} unread emails
                    </li>
                  )}
                </ul>
              </div>
            )}

            {dryRunResult.sampleAffected && dryRunResult.sampleAffected.length > 0 && (
              <div className="samples-preview">
                <strong>Sample emails:</strong>
                <ul>
                  {dryRunResult.sampleAffected.slice(0, 5).map((s) => (
                    <li key={s.id}>
                      {truncateText(s.subject, 60)} from {s.from}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="action-buttons">
              <button
                onClick={handleExecuteClick}
                disabled={!dryRunResult.canProceed || loading}
                className="btn btn-danger"
              >
                {loading ? 'Executing...' : 'Start Cleanup'}
              </button>
              <button
                onClick={() => setDryRunResult(null)}
                className="btn btn-secondary"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showConfirm}
        title="Confirm Cleanup"
        message={`Execute ${actionType.toLowerCase()} on ${
          dryRunResult?.totalAffected || 0
        } emails? This action cannot be undone.`}
        confirmText="Start Cleanup"
        cancelText="Cancel"
        isDangerous={true}
        onConfirm={handleExecuteConfirm}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}

export default ActionsTab;
