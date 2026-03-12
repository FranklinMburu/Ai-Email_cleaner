import React from 'react';
import { LoadingState } from '../common/LoadingState';
import { EmptyState } from '../common/EmptyState';
import { SenderControls } from './SenderControls';
import { ScheduledReview } from './ScheduledReview';

/**
 * OverviewTab - Display inbox overview and sync controls
 */
export function OverviewTab({ data, loading, onSync, syncing, onGenerateReport }) {
  return (
    <div className="tab-pane">
      <div className="section">
        <h2 className="section-title">📊 Inbox Overview</h2>

        {loading && <LoadingState message="Loading overview..." />}

        {!loading && data.overview && (
          <div className="grid grid-3">
            <div className="stat-card">
              <div className="stat-value">{data.overview.totalMessages}</div>
              <div className="stat-label">Total Messages</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{data.overview.unreadMessages}</div>
              <div className="stat-label">Unread</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{data.overview.starredMessages}</div>
              <div className="stat-label">Starred</div>
            </div>
          </div>
        )}

        {data.syncResult && (
          <div className="alert alert-success">
            <span>✓</span>
            <div>
              <strong>Sync completed!</strong> {data.syncResult.messageCount} messages synced.
            </div>
          </div>
        )}

        <div className="action-buttons" style={{ marginTop: 'var(--spacing-xl)' }}>
          <button
            onClick={onSync}
            disabled={syncing}
            className="btn btn-primary btn-large"
          >
            {syncing ? '⏳ Syncing...' : '🔄 Sync Now'}
          </button>
          <button onClick={onGenerateReport} disabled={loading} className="btn btn-primary btn-large">
            {loading ? '⏳ Generating...' : '✨ Generate Report'}
          </button>
        </div>
      </div>

      <div className="overview-sections">
        <div className="section">
          <h3 className="section-title">👥 Sender Controls</h3>
          <SenderControls />
        </div>
        
        <div className="section">
          <h3 className="section-title">📅 Scheduled Review</h3>
          <ScheduledReview />
        </div>
      </div>
    </div>
  );
}

export default OverviewTab;
