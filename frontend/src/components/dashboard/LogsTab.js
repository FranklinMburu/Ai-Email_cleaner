import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { useNotifications } from '../../hooks/useNotifications';
import { LoadingState } from '../common/LoadingState';
import { EmptyState } from '../common/EmptyState';
import { Pagination } from '../common/Pagination';
import { SearchInput } from '../common/SearchInput';
import { PresetManager } from './PresetManager';
import { formatDate } from '../../utils/formatters';
import { paginate, getTotalPages } from '../../utils/pagination';

const ITEMS_PER_PAGE = 20;

/**
 * LogsTab - Display operation logs with pagination, search, filtering, export, and undo
 */
export function LogsTab({ refreshTrigger }) {
  const notifications = useNotifications();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [undoing, setUndoing] = useState(null); // operationId being undone
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Advanced filters
  const [filters, setFilters] = useState({
    type: '',
    status: '',
    startDate: '',
    endDate: '',
  });
  
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger, filters]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const res = await api.operations.getLogs(filters);
      setLogs(res.data.logs || []);
      setCurrentPage(1);
    } catch (err) {
      console.error('Error loading logs:', err);
      notifications.error('Failed to load logs');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  // Filter logs based on search query
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) {
      return logs;
    }

    const query = searchQuery.toLowerCase();
    return logs.filter((log) => {
      return (
        (log.type && log.type.toLowerCase().includes(query)) ||
        (log.status && log.status.toLowerCase().includes(query)) ||
        (log.summary && log.summary.toLowerCase().includes(query))
      );
    });
  }, [logs, searchQuery]);

  const totalPages = getTotalPages(filteredLogs.length, ITEMS_PER_PAGE);
  const paginatedLogs = paginate(filteredLogs, currentPage, ITEMS_PER_PAGE);

  const handleExportLogs = async (format) => {
    try {
      setExporting(true);
      // eslint-disable-next-line no-unused-vars
      const response = await api.export.logs(format, 500);
      // The response is already configured as attachment/download
      notifications.success(`Logs exported as ${format.toUpperCase()}`);
    } catch (err) {
      console.error('Export failed:', err);
      notifications.error('Failed to export logs');
    } finally {
      setExporting(false);
    }
  };

  const handleExportReport = async (format) => {
    try {
      setExporting(true);
      // eslint-disable-next-line no-unused-vars
      const response = await api.export.report(format);
      // The response is already configured as attachment/download
      notifications.success(`Report exported as ${format.toUpperCase()}`);
    } catch (err) {
      console.error('Export failed:', err);
      notifications.error('Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const handleUndo = async (operationId) => {
    try {
      setUndoing(operationId);
      await api.operations.undo(operationId);
      notifications.success('Operation undone successfully');
      
      // Reload logs to reflect the undo
      await loadLogs();
    } catch (err) {
      console.error('Undo failed:', err);
      notifications.error(`Undo failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setUndoing(null);
    }
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    const updatedFilters = { ...filters, [name]: value };
    setFilters(updatedFilters);
  };

  const clearFilters = () => {
    setFilters({
      type: '',
      status: '',
      startDate: '',
      endDate: '',
    });
  };

  const handleLoadPreset = (preset) => {
    // Apply the saved filter preset
    if (preset && preset.filters) {
      setFilters(preset.filters);
      setCurrentPage(1); // Reset to first page
      notifications.success(`Loaded preset: ${preset.name}`);
    }
  };

  const getUndoTimeWindow = (log) => {
    if (!log.undoInfo) return null;
    
    if (log.undoInfo.canUndo) {
      const expiresAt = new Date(log.undoInfo.expiresAt);
      const now = new Date();
      const diffMs = expiresAt - now;
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      if (diffHours > 0) {
        return `${diffHours}h ${diffMinutes}m remaining`;
      } else if (diffMinutes > 0) {
        return `${diffMinutes}m remaining`;
      } else {
        return 'Expiring soon';
      }
    }
    return null;
  };

  const hasActiveFilters = Object.values(filters).some(v => v !== '');

  return (
    <div className="tab-pane">
      <PresetManager presetType="filters" onLoadPreset={handleLoadPreset} />

      <div className="logs-header">
        <h2>Execution Logs</h2>
        <div className="logs-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setShowFilters(!showFilters)}
            disabled={loading}
          >
            {showFilters ? '▼ Filters' : '▶ Filters'} {hasActiveFilters && '✓'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleExportLogs('json')}
            disabled={loading || exporting || logs.length === 0}
          >
            {exporting ? 'Exporting...' : 'Export JSON'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleExportLogs('csv')}
            disabled={loading || exporting || logs.length === 0}
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="logs-filters">
          <div className="filter-row">
            <div className="filter-group">
              <label>Operation Type</label>
              <select name="type" value={filters.type} onChange={handleFilterChange}>
                <option value="">All Types</option>
                <option value="ARCHIVE">Archive</option>
                <option value="TRASH">Trash</option>
                <option value="LABEL">Label</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Status</label>
              <select name="status" value={filters.status} onChange={handleFilterChange}>
                <option value="">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="partial_failure">Partial Failure</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            <div className="filter-group">
              <label>From Date</label>
              <input
                type="date"
                name="startDate"
                value={filters.startDate}
                onChange={handleFilterChange}
              />
            </div>

            <div className="filter-group">
              <label>To Date</label>
              <input
                type="date"
                name="endDate"
                value={filters.endDate}
                onChange={handleFilterChange}
              />
            </div>

            {hasActiveFilters && (
              <button className="btn btn-sm btn-secondary" onClick={clearFilters}>
                Clear Filters
              </button>
            )}
          </div>
        </div>
      )}

      {loading && <LoadingState message="Loading logs..." />}

      {!loading && logs.length === 0 && (
        <EmptyState
          title="No operations yet"
          message="Operations will appear here after they complete."
        />
      )}

      {!loading && logs.length > 0 && (
        <>
          <div className="logs-controls">
            <SearchInput
              onSearch={setSearchQuery}
              placeholder="Search logs by type, status, or details..."
            />
            <div className="logs-info">
              Showing {paginatedLogs.length} of {filteredLogs.length} logs
              {searchQuery && ` (filtered)`}
            </div>
          </div>

          {paginatedLogs.length === 0 ? (
            <EmptyState
              title="No matching logs"
              message="No logs match your search. Try a different query."
            />
          ) : (
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Affected</th>
                  <th>Details</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.map((log) => (
                  <tr key={log.id} className={`status-${log.status}`}>
                    <td>{formatDate(log.timestamp)}</td>
                    <td>
                      <strong>{log.type}</strong>
                    </td>
                    <td>
                      <span className={`status-badge status-${log.status.toLowerCase()}`}>
                        {log.status}
                      </span>
                    </td>
                    <td>{log.affectedCount || 0}</td>
                    <td className="logs-summary">{log.summary || '-'}</td>
                    <td className="logs-actions">
                      {log.undoInfo?.canUndo && (
                        <div className="undo-action">
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleUndo(log.id)}
                            disabled={undoing === log.id}
                            title={`${log.undoInfo.note} - ${getUndoTimeWindow(log)}`}
                          >
                            {undoing === log.id ? 'Undoing...' : '↶ Undo'}
                          </button>
                          <span className="undo-time" title={`Undoable until ${new Date(log.undoInfo.expiresAt).toLocaleString()}`}>
                            {getUndoTimeWindow(log)}
                          </span>
                        </div>
                      )}
                      {!log.undoInfo?.canUndo && (
                        <span className="text-muted" title={log.undoInfo?.reason}>
                          Expired {log.undoInfo?.reason ? `(${log.undoInfo.reason})` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              itemsPerPage={ITEMS_PER_PAGE}
            />
          )}
        </>
      )}
    </div>
  );
}

export default LogsTab;
