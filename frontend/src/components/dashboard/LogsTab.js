import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { LoadingState } from '../common/LoadingState';
import { EmptyState } from '../common/EmptyState';
import { Pagination } from '../common/Pagination';
import { SearchInput } from '../common/SearchInput';
import { formatDate } from '../../utils/formatters';
import { paginate, getTotalPages } from '../../utils/pagination';

const ITEMS_PER_PAGE = 20;

/**
 * LogsTab - Display operation logs with pagination and search
 */
export function LogsTab({ refreshTrigger }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadLogs();
  }, [refreshTrigger]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const res = await api.operations.getLogs();
      setLogs(res.data.logs || []);
      setCurrentPage(1);
    } catch (err) {
      console.error('Error loading logs:', err);
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

  return (
    <div className="tab-pane">
      <h2>Execution Logs</h2>

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
