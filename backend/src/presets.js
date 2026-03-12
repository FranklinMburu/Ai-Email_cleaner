import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database.js';

/**
 * Filter Presets - Save and load filter configurations
 */

export function saveFilterPreset(userEmail, name, description, filters) {
  const db = getDatabase();
  const id = `preset_${uuidv4()}`;
  
  db.prepare(
    `INSERT OR REPLACE INTO filter_presets (id, user_email, name, description, filters, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    id,
    userEmail,
    name,
    description || null,
    JSON.stringify(filters)
  );
  
  return {
    id,
    name,
    description,
    filters,
    created: new Date().toISOString(),
  };
}

export function getFilterPresets(userEmail) {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM filter_presets WHERE user_email = ? ORDER BY updated_at DESC')
    .all(userEmail)
    .map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      filters: JSON.parse(row.filters),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

export function getFilterPreset(userEmail, presetId) {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM filter_presets WHERE id = ? AND user_email = ?')
    .get(presetId, userEmail);
  
  if (!row) return null;
  
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    filters: JSON.parse(row.filters),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteFilterPreset(userEmail, presetId) {
  const db = getDatabase();
  db.prepare('DELETE FROM filter_presets WHERE id = ? AND user_email = ?')
    .run(presetId, userEmail);
}

/**
 * Operation Presets - Save and load operation configurations
 */

export function saveOperationPreset(userEmail, name, description, operationType, config) {
  const db = getDatabase();
  const id = `op_preset_${uuidv4()}`;
  
  db.prepare(
    `INSERT OR REPLACE INTO operation_presets (id, user_email, name, description, operation_type, config, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    id,
    userEmail,
    name,
    description || null,
    operationType,
    JSON.stringify(config)
  );
  
  return {
    id,
    name,
    description,
    operationType,
    config,
    created: new Date().toISOString(),
  };
}

export function getOperationPresets(userEmail, operationType = null) {
  const db = getDatabase();
  let query = 'SELECT * FROM operation_presets WHERE user_email = ?';
  const params = [userEmail];
  
  if (operationType) {
    query += ' AND operation_type = ?';
    params.push(operationType);
  }
  
  query += ' ORDER BY updated_at DESC';
  
  return db
    .prepare(query)
    .all(...params)
    .map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      operationType: row.operation_type,
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

export function getOperationPreset(userEmail, presetId) {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM operation_presets WHERE id = ? AND user_email = ?')
    .get(presetId, userEmail);
  
  if (!row) return null;
  
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    operationType: row.operation_type,
    config: JSON.parse(row.config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteOperationPreset(userEmail, presetId) {
  const db = getDatabase();
  db.prepare('DELETE FROM operation_presets WHERE id = ? AND user_email = ?')
    .run(presetId, userEmail);
}
