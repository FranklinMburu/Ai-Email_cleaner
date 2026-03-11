import React from 'react';

/**
 * Toast - Display notifications at the top of the screen
 */
export const Toast = ({ notifications, onRemove }) => {
  if (!notifications || notifications.length === 0) return null;

  const getTypeIcon = (type) => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      default:
        return 'ℹ';
    }
  };

  return (
    <div className="toast-container">
      {notifications.map((notification) => (
        <div key={notification.id} className={`toast toast-${notification.type}`}>
          <span className="toast-icon">{getTypeIcon(notification.type)}</span>
          <span className="toast-message">{notification.message}</span>
          <button
            className="toast-close"
            onClick={() => onRemove(notification.id)}
            aria-label="Close notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default Toast;
