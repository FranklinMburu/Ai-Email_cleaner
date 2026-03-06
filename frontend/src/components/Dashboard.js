import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './Dashboard.css';

export function Dashboard() {
  const [tab, setTab] = useState('overview');
  const [userEmail, setUserEmail] = useState(localStorage.getItem('userEmail') || '');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (userEmail) {
      loadOverview();
    }
  }, [userEmail]);

  const loadOverview = async () => {
    try {
      setLoading(true);
      const res = await api.inbox.getOverview();
      setData((prev) => ({ ...prev, overview: res.data }));
    } catch (err) {
      console.error('Error loading overview:', err);
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
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleGenerateReport = async () => {
    try {
      setLoading(true);
      const res = await api.report.generate();
      setData((prev) => ({ ...prev, report: res.data }));
      setTab('recommendations');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.auth.disconnect();
      localStorage.removeItem('sessionId');
      localStorage.removeItem('userEmail');
      setUserEmail('');
      setData({});
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  if (!userEmail) {
    return <LoginPage onLogin={setUserEmail} />;
  }

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

      {error && <div className="error-banner">{error}</div>}

      <div className="tabs">
        <button className={tab === 'overview' ? 'tab active' : 'tab'} onClick={() => setTab('overview')}>
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
        {tab === 'overview' && <OverviewTab data={data} loading={loading} onSync={handleSync} syncing={syncing} onGenerateReport={handleGenerateReport} />}
        {tab === 'recommendations' && <RecommendationsTab data={data} loading={loading} />}
        {tab === 'actions' && <ActionsTab data={data} />}
        {tab === 'logs' && <LogsTab data={data} />}
      </div>
    </div>
  );
}

function OverviewTab({ data, loading, onSync, syncing, onGenerateReport }) {
  return (
    <div className="tab-pane">
      <h2>Inbox Overview</h2>

      {data.overview && (
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

function RecommendationsTab({ data, loading }) {
  const report = data.report;

  if (loading) {
    return <div className="tab-pane"><p>Loading recommendations...</p></div>;
  }

  if (!report) {
    return <div className="tab-pane"><p>No recommendations yet. Sync and generate a report first.</p></div>;
  }

  return (
    <div className="tab-pane">
      <h2>AI Recommendations</h2>
      <p>Total messages: {report.totalMessages} | Protected: {report.protectedMessages}</p>

      <div className="recommendations-list">
        {report.categories.map((cat) => (
          <div key={cat.categoryId} className="recommendation-card">
            <div className="card-header">
              <h3>{cat.name}</h3>
              <span className="badge">{cat.count} emails</span>
            </div>
            <div className="card-body">
              <p>
                <strong>Confidence:</strong> {Math.round(cat.confidence * 100)}%
                <span className={`risk-badge risk-${cat.riskLevel.toLowerCase()}`}>
                  {cat.riskLevel}
                </span>
              </p>
              <p>
                <strong>Suggested Action:</strong> {cat.suggestedAction}
                {cat.label && ` (label: ${cat.label})`}
              </p>

              <div className="samples">
                <strong>Sample emails:</strong>
                <ul>
                  {cat.samples.slice(0, 3).map((s) => (
                    <li key={s.id}>
                      <em>{s.subject}</em> from <strong>{s.from}</strong>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="top-senders">
                <strong>Top senders:</strong>
                <ul>
                  {cat.topSenders.slice(0, 3).map((s) => (
                    <li key={s.domain}>
                      {s.domain} ({s.count})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionsTab({ data }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [actionType, setActionType] = useState('ARCHIVE');
  const [dryRunResult, setDryRunResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const report = data.report;

  const handleDryRun = async () => {
    if (!selectedCategory) {
      alert('Select a category first');
      return;
    }

    try {
      setLoading(true);
      const res = await api.operations.dryRun(actionType, [selectedCategory], null);
      setDryRunResult(res.data);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!dryRunResult) {
      alert('Run dry-run first');
      return;
    }

    if (!window.confirm(`Execute ${actionType} on ${dryRunResult.totalAffected} emails?`)) {
      return;
    }

    try {
      setLoading(true);
      await api.operations.execute(
        dryRunResult.operationId,
        actionType,
        [selectedCategory],
        null,
        dryRunResult.approvalToken
      );
      alert('Operation completed!');
      setDryRunResult(null);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  if (!report) {
    return <div className="tab-pane"><p>Generate recommendations first.</p></div>;
  }

  return (
    <div className="tab-pane">
      <h2>Action Composer</h2>

      <div className="composer-section">
        <label>
          <strong>Select Category:</strong>
          <select value={selectedCategory || ''} onChange={(e) => setSelectedCategory(e.target.value)}>
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

        <button onClick={handleDryRun} disabled={!selectedCategory || loading} className="btn btn-primary">
          {loading ? 'Loading...' : 'Preview (Dry Run)'}
        </button>
      </div>

      {dryRunResult && (
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
                    <li>⚠ {dryRunResult.riskAssessment.protectedEmailConflict} protected emails (starred/important)</li>
                  )}
                  {dryRunResult.riskAssessment.recentEmailConflict > 0 && (
                    <li>ℹ {dryRunResult.riskAssessment.recentEmailConflict} recent emails</li>
                  )}
                  {dryRunResult.riskAssessment.unreadEmailConflict > 0 && (
                    <li>ℹ {dryRunResult.riskAssessment.unreadEmailConflict} unread emails</li>
                  )}
                </ul>
              </div>
            )}

            <div className="samples-preview">
              <strong>Sample emails:</strong>
              <ul>
                {dryRunResult.sampleAffected.map((s) => (
                  <li key={s.id}>
                    {s.subject} from {s.from}
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={handleExecute}
              disabled={!dryRunResult.canProceed || loading}
              className="btn btn-success"
            >
              {loading ? 'Executing...' : 'Start Cleanup'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LogsTab({ data }) {
  const [logs, setLogs] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const loadLogs = async () => {
      try {
        setLoading(true);
        const res = await api.operations.getLogs();
        setLogs(res.data.logs);
      } catch (err) {
        console.error('Error loading logs:', err);
      } finally {
        setLoading(false);
      }
    };

    loadLogs();
  }, []);

  return (
    <div className="tab-pane">
      <h2>Execution Log</h2>

      {loading && <p>Loading logs...</p>}

      {!loading && logs.length === 0 && <p>No operations yet.</p>}

      {!loading && logs.length > 0 && (
        <table className="logs-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Status</th>
              <th>Affected</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className={`status-${log.status}`}>
                <td>{new Date(log.timestamp).toLocaleString()}</td>
                <td>{log.type}</td>
                <td>{log.status}</td>
                <td>{log.affectedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [loading, setLoading] = React.useState(false);

  const handleConnect = async () => {
    try {
      setLoading(true);
      const res = await api.auth.initOAuth();
      const { authUrl } = res.data;

      // Open OAuth window
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl,
        'Gmail Auth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Listen for callback (in real app, would use window location)
      window.handleOAuthCallback = async (code) => {
        popup.close();
        try {
          const callbackRes = await api.auth.callback(code);
          localStorage.setItem('sessionId', callbackRes.data.sessionId);
          localStorage.setItem('userEmail', callbackRes.data.userEmail);
          onLogin(callbackRes.data.userEmail);
        } catch (err) {
          alert('Auth error: ' + (err.response?.data?.error || err.message));
        }
      };
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <h1>Gmail Inbox Cleanup Tool</h1>
        <p>Safe, AI-assisted organization of your inbox with 40,000+ emails</p>
        <button onClick={handleConnect} disabled={loading} className="btn btn-primary btn-large">
          {loading ? 'Connecting...' : 'Connect Gmail'}
        </button>
        <div className="features">
          <h3>Features</h3>
          <ul>
            <li>✓ Incremental sync of all messages</li>
            <li>✓ AI-powered categorization</li>
            <li>✓ Dry-run preview before action</li>
            <li>✓ Full audit logging</li>
            <li>✓ Protected emails never touched</li>
            <li>✓ Archive, label, or trash emails safely</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
