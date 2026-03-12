import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotifications } from '../../hooks/useNotifications';

/**
 * PresetManager - Save and load filter/operation presets
 */
export function PresetManager({ onLoadPreset, presetType = 'filters' }) {
  const notifications = useNotifications();
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);

  useEffect(() => {
    loadPresets();
  }, [presetType]);

  const loadPresets = async () => {
    try {
      setLoading(true);
      if (presetType === 'filters') {
        const res = await api.presets.filters.list();
        setPresets(res.data.presets || []);
      } else {
        const res = await api.presets.operations.list();
        setPresets(res.data.presets || []);
      }
    } catch (err) {
      console.error('Failed to load presets:', err);
      notifications.error('Failed to load presets');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePreset = async (presetConfig) => {
    if (!newPresetName.trim()) {
      notifications.warning('Preset name is required');
      return;
    }

    try {
      setSavingPreset(true);
      if (presetType === 'filters') {
        await api.presets.filters.save(newPresetName, newPresetDesc, presetConfig);
      } else {
        // For operations, config needs operationType which should be stored elsewhere
        notifications.info('Operation preset save not fully configured yet');
        return;
      }
      
      notifications.success(`Preset "${newPresetName}" saved`);
      setNewPresetName('');
      setNewPresetDesc('');
      setShowSave(false);
      await loadPresets();
    } catch (err) {
      console.error('Failed to save preset:', err);
      notifications.error(`Failed to save preset: ${err.response?.data?.error || err.message}`);
    } finally {
      setSavingPreset(false);
    }
  };

  const handleLoadPreset = async (presetId) => {
    try {
      let preset;
      if (presetType === 'filters') {
        const res = await api.presets.filters.get(presetId);
        preset = res.data;
      } else {
        const res = await api.presets.operations.get(presetId);
        preset = res.data;
      }
      
      onLoadPreset(preset);
      notifications.success(`Preset "${preset.name}" loaded`);
    } catch (err) {
      console.error('Failed to load preset:', err);
      notifications.error('Failed to load preset');
    }
  };

  const handleDeletePreset = async (presetId) => {
    if (!window.confirm('Delete this preset?')) return;
    
    try {
      if (presetType === 'filters') {
        await api.presets.filters.delete(presetId);
      } else {
        await api.presets.operations.delete(presetId);
      }
      
      notifications.success('Preset deleted');
      await loadPresets();
    } catch (err) {
      console.error('Failed to delete preset:', err);
      notifications.error('Failed to delete preset');
    }
  };

  return (
    <div className="preset-manager">
      <div className="preset-header">
        <h4>Saved Presets</h4>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => setShowSave(!showSave)}
        >
          {showSave ? '✕ Cancel' : '+ New Preset'}
        </button>
      </div>

      {showSave && (
        <div className="preset-save-form">
          <input
            type="text"
            placeholder="Preset name"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            className="preset-input"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newPresetDesc}
            onChange={(e) => setNewPresetDesc(e.target.value)}
            className="preset-input"
          />
          {/* Note: The actual save will be triggered by parent component passing presetConfig */}
        </div>
      )}

      {loading ? (
        <div className="text-muted">Loading presets...</div>
      ) : presets.length === 0 ? (
        <div className="text-muted">No presets saved yet</div>
      ) : (
        <div className="preset-list">
          {presets.map((preset) => (
            <div key={preset.id} className="preset-item">
              <div className="preset-info">
                <strong>{preset.name}</strong>
                {preset.description && <p className="text-muted">{preset.description}</p>}
              </div>
              <div className="preset-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleLoadPreset(preset.id)}
                >
                  Load
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDeletePreset(preset.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PresetManager;
