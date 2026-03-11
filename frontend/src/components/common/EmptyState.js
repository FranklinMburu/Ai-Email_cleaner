import React from 'react';

/**
 * EmptyState - Display when no data is available
 */
export const EmptyState = ({ title = 'No data', message = 'There is nothing to display yet.', action }) => {
  return (
    <div className="empty-state">
      <div className="empty-icon">∅</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && (
        <button className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
