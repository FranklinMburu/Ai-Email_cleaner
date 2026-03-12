import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotifications } from '../../hooks/useNotifications';

/**
 * SenderControls - Manage sender whitelists, blacklists, and ignores
 */
export function SenderControls() {
  const notifications = useNotifications();
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedSender, setExpandedSender] = useState(null);
  const [editingControl, setEditingControl] = useState(null);
  const [controlReason, setControlReason] = useState('');

  useEffect(() => {
    loadSenderStats();
  }, []);

  const loadSenderStats = async () => {
    try {
      setLoading(true);
      const res = await api.senders.getStats(50);
      setSenders(res.data.senders || []);
    } catch (err) {
      console.error('Failed to load sender stats:', err);
      notifications.error('Failed to load sender statistics');
    } finally {
      setLoading(false);
    }
  };

  const handleSetControl = async (senderEmail, controlType) => {
    try {
      await api.senders.setControl(senderEmail, controlType, controlReason);
      notifications.success(`${controlType} set for ${senderEmail}`);
      setEditingControl(null);
      setControlReason('');
      await loadSenderStats();
    } catch (err) {
      console.error('Failed to set control:', err);
      notifications.error(`Failed to set control: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleRemoveControl = async (senderEmail) => {
    try {
      await api.senders.removeControl(senderEmail);
      notifications.success(`Control removed for ${senderEmail}`);
      await loadSenderStats();
    } catch (err) {
      console.error('Failed to remove control:', err);
      notifications.error('Failed to remove control');
    }
  };

  const getControlBadge = (control) => {
    if (!control) return null;
    
    const colors = {
      WHITELIST: '#28a745', // green
      BLACKLIST: '#dc3545', // red
      IGNORE: '#ffc107',     // yellow
    };
    
    return (
      <span
        className="control-badge"
        style={{ backgroundColor: colors[control.controlType] }}
        title={control.reason}
      >
        {control.controlType}
      </span>
    );
  };

  return (
    <div className="sender-controls card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Manage Senders</h3>
          <p className="card-subtitle">Whitelist, blacklist, or ignore specific senders</p>
        </div>
      </div>

      <div className="card-content">
        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner"></div>
            <p>Loading senders...</p>
          </div>
        ) : senders.length === 0 ? (
          <div className="empty-state">
            <p>No senders found</p>
          </div>
        ) : (
          <div className="sender-list">
          {senders.map((sender) => (
            <div key={sender.senderEmail} className="sender-item">
              <div className="sender-info">
                <strong>{sender.senderEmail}</strong>
                <span className="sender-count">{sender.messageCount} emails</span>
                {sender.control && getControlBadge(sender.control)}
              </div>

              <div className="sender-controls-buttons">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setExpandedSender(
                    expandedSender === sender.senderEmail ? null : sender.senderEmail
                  )}
                >
                  {expandedSender === sender.senderEmail ? '▼' : '▶'}
                </button>
              </div>

              {expandedSender === sender.senderEmail && (
                <div className="sender-expanded">
                  <div className="control-options">
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => setEditingControl(
                        editingControl === 'WHITELIST' ? null : 'WHITELIST'
                      )}
                    >
                      {sender.control?.controlType === 'WHITELIST' ? '✓ ' : ''}Whitelist
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => setEditingControl(
                        editingControl === 'BLACKLIST' ? null : 'BLACKLIST'
                      )}
                    >
                      {sender.control?.controlType === 'BLACKLIST' ? '✓ ' : ''}Blacklist
                    </button>
                    <button
                      className="btn btn-sm btn-warning"
                      onClick={() => setEditingControl(
                        editingControl === 'IGNORE' ? null : 'IGNORE'
                      )}
                    >
                      {sender.control?.controlType === 'IGNORE' ? '✓ ' : ''}Ignore
                    </button>
                    {sender.control && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleRemoveControl(sender.senderEmail)}
                      >
                        Remove Control
                      </button>
                    )}
                  </div>

                  {editingControl && (
                    <div className="control-form">
                      <input
                        type="text"
                        placeholder="Reason (optional)"
                        value={controlReason}
                        onChange={(e) => setControlReason(e.target.value)}
                        className="control-input"
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleSetControl(sender.senderEmail, editingControl)}
                      >
                        Apply {editingControl}
                      </button>
                    </div>
                  )}

                  {sender.control && (
                    <div className="control-details">
                      <strong>Current:</strong> {sender.control.controlType}
                      {sender.control.reason && <p>{sender.control.reason}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}

export default SenderControls;
