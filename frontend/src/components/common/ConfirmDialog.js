import React, { useState } from 'react';

/**
 * ConfirmDialog - Modal confirmation dialog replacing alert()
 */
export const useConfirmDialog = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState(null);
  const [result, setResult] = useState(null);

  const confirm = (message, onConfirm, onCancel, title = 'Confirm') => {
    return new Promise((resolve) => {
      setConfig({
        title,
        message,
        onConfirm: () => {
          setIsOpen(false);
          if (onConfirm) onConfirm();
          resolve(true);
        },
        onCancel: () => {
          setIsOpen(false);
          if (onCancel) onCancel();
          resolve(false);
        },
      });
      setIsOpen(true);
    });
  };

  return { isOpen, config, confirm };
};

export const ConfirmDialog = ({ isOpen, title = 'Confirm', message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', isDangerous = false }) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-dialog-overlay">
      <div className="confirm-dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-dialog-buttons">
          <button className="btn btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={isDangerous ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
