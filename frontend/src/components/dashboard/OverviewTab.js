import React from 'react';
import { LoadingState } from '../common/LoadingState';
import { EmptyState } from '../common/EmptyState';

/**
 * OverviewTab - Display inbox overview and sync controls
 */
export function OverviewTab({ data, loading, onSync, syncing, onGenerateReport }) {
  return (
    <div className="tab-pane">
      <h2>Inbox Overview</h2>

      {loading && <LoadingState message="Loading overview..." />}

      {!loading && data.overview && (
        <div className="overview-stats">
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
        <div className="success-box">
          <strong>Sync completed!</strong> {data.syncResult.messageCount} messages synced.
        </div>
      )}

      <div className="action-buttons">
        <button
          onClick={onSync}
          disabled={syncing}
          className="btn btn-primary"
        >
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
        <button onClick={onGenerateReport} disabled={loading} className="btn btn-primary">
          {loading ? 'Generating...' : 'Generate Report'}
        </button>
      </div>
    </div>
  );
}

export default OverviewTab;
