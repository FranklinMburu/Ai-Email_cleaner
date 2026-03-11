import React, { useState } from 'react';
import { LoadingState } from '../common/LoadingState';
import { EmptyState } from '../common/EmptyState';
import { formatConfidence } from '../../utils/formatters';

/**
 * RecommendationsTab - Display categorized recommendations
 */
export function RecommendationsTab({ data, loading }) {
  const [expandedCategory, setExpandedCategory] = useState(null);
  const report = data.report;

  if (loading) {
    return (
      <div className="tab-pane">
        <LoadingState message="Loading recommendations..." />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="tab-pane">
        <EmptyState
          title="No recommendations yet"
          message="Sync your inbox and generate a report first."
        />
      </div>
    );
  }

  return (
    <div className="tab-pane">
      <h2>Recommendations</h2>
      <p>
        Total messages: <strong>{report.totalMessages}</strong> | Protected:{' '}
        <strong>{report.protectedMessages}</strong>
      </p>

      <div className="recommendations-list">
        {report.categories.map((cat) => (
          <div key={cat.categoryId} className="recommendation-card">
            <div className="card-header">
              <h3>{cat.name}</h3>
              <span className="badge">{cat.count} emails</span>
            </div>

            {expandedCategory === cat.categoryId && (
              <div className="card-body">
                <p>
                  <strong>Confidence:</strong> {formatConfidence(cat.confidence)}
                  <span className={`risk-badge risk-${cat.riskLevel.toLowerCase()}`}>
                    {cat.riskLevel}
                  </span>
                </p>
                <p>
                  <strong>Suggested Action:</strong> {cat.suggestedAction}
                  {cat.label && ` (label: ${cat.label})`}
                </p>

                {cat.samples && cat.samples.length > 0 && (
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
                )}

                {cat.topSenders && cat.topSenders.length > 0 && (
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
                )}
              </div>
            )}

            <div className="card-footer">
              <button
                className="btn btn-secondary btn-small"
                onClick={() =>
                  setExpandedCategory(
                    expandedCategory === cat.categoryId ? null : cat.categoryId
                  )
                }
              >
                {expandedCategory === cat.categoryId ? 'Hide Details' : 'Show Details'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RecommendationsTab;
