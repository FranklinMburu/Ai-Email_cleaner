import React from 'react';
import { OverviewTab } from './OverviewTab';
import { RecommendationsTab } from './RecommendationsTab';
import { ActionsTab } from './ActionsTab';
import { LogsTab } from './LogsTab';

/**
 * DashboardTabs - Tab navigation and tab content rendering
 */
export function DashboardTabs({
  tab,
  setTab,
  data,
  loading,
  syncing,
  notifications,
  refreshLogs,
  onSync,
  onGenerateReport,
  onOperationExecuted,
}) {
  return (
    <>
      <div className="tabs">
        <button
          className={tab === 'overview' ? 'tab active' : 'tab'}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          className={tab === 'recommendations' ? 'tab active' : 'tab'}
          onClick={() => setTab('recommendations')}
        >
          Recommendations
        </button>
        <button className={tab === 'actions' ? 'tab active' : 'tab'} onClick={() => setTab('actions')}>
          Actions
        </button>
        <button className={tab === 'logs' ? 'tab active' : 'tab'} onClick={() => setTab('logs')}>
          Logs
        </button>
      </div>

      <div className="tab-content">
        {tab === 'overview' && (
          <OverviewTab
            data={data}
            loading={loading}
            onSync={onSync}
            syncing={syncing}
            onGenerateReport={onGenerateReport}
          />
        )}
        {tab === 'recommendations' && (
          <RecommendationsTab data={data} loading={loading} />
        )}
        {tab === 'actions' && (
          <ActionsTab
            data={data}
            notifications={notifications}
            onOperationExecuted={() => {
              onOperationExecuted();
              refreshLogs();
            }}
          />
        )}
        {tab === 'logs' && <LogsTab refreshTrigger={refreshLogs} />}
      </div>
    </>
  );
}

export default DashboardTabs;
