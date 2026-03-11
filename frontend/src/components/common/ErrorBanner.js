import React from 'react';

/**
 * ErrorBanner - Display error message prominently
 */
export const ErrorBanner = ({ error, onClose }) => {
  if (!error) return null;

  return (
    <div className="error-banner">
      <div className="error-content">
        <span className="error-icon">✕</span>
        <span className="error-message">{error}</span>
        {onClose && (
          <button className="error-close" onClick={onClose} aria-label="Close error">
            ×
          </button>
        )}
      </div>
    </div>
  );
};

export default ErrorBanner;
