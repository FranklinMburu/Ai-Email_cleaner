import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { ErrorBanner } from '../common/ErrorBanner';
import { Toast } from '../common/Toast';
import { DashboardTabs } from './DashboardTabs';
import { useNotifications } from '../../hooks/useNotifications';

/**
 * DashboardLayout - Main dashboard layout with state management
 */
export function DashboardLayout({ userEmail, onLogout, notifications }) {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [logsRefreshTrigger, setLogsRefreshTrigger] = useState(0);

  // Load overview on mount
  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.inbox.getOverview();
      setData((prev) => ({ ...prev, overview: res.data }));
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      setError(errorMsg);
      notifications.error('Failed to load overview: ' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      const res = await api.sync.start('incremental');
      setData((prev) => ({ ...prev, syncResult: res.data }));
      notifications.success(`Sync completed! ${res.data.messageCount} messages synced.`);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      setError(errorMsg);
      notifications.error('Sync failed: ' + errorMsg);
    } finally {
      setSyncing(false);
    }
  };

  const handleGenerateReport = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.report.generate();
      setData((prev) => ({ ...prev, report: res.data }));
      setTab('recommendations');
      notifications.success('Report generated successfully!');
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      setError(errorMsg);
      notifications.error('Report generation failed: ' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.auth.disconnect();
      onLogout();
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      notifications.error('Disconnect failed: ' + errorMsg);
    }
  };

  const handleOperationExecuted = () => {
    setData((prev) => ({ ...prev, dryRunResult: null }));
    // Reload overview to show updated stats
    loadOverview();
  };

  const refreshLogs = () => {
    setLogsRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Gmail Inbox Cleanup</h1>
        <div className="header-info">
          <span>{userEmail}</span>
          <button onClick={handleDisconnect} className="btn btn-secondary">
            Disconnect
          </button>
        </div>
      </header>

      {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

      <Toast notifications={notifications.notifications} onRemove={notifications.removeNotification} />

      <DashboardTabs
        tab={tab}
        setTab={setTab}
        data={data}
        loading={loading}
        syncing={syncing}
        notifications={notifications}
        refreshLogs={logsRefreshTrigger}
        onSync={handleSync}
        onGenerateReport={handleGenerateReport}
        onOperationExecuted={handleOperationExecuted}
      />
    </div>
  );
}

export default DashboardLayout;
