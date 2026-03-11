import React from 'react';

/**
 * LoadingState - Display loading indicator with optional message
 */
export const LoadingState = ({ message = 'Loading...', size = 'medium' }) => {
  return (
    <div className="loading-state">
      <div className={`spinner spinner-${size}`}></div>
      <p>{message}</p>
    </div>
  );
};

export default LoadingState;
