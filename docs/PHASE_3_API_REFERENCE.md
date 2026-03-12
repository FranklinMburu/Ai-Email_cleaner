# Phase 3 API Reference

## Export Endpoints

### Export Operation Logs
```
GET /api/export/logs?format=json|csv&limit=500
Authorization: x-session-id header required
Content-Disposition: attachment; filename="logs_{date}.{format}"
```

**Query Parameters:**
- `format` (required): `json` or `csv`
- `limit` (optional): Number of records to export (default: 500)

**Response:** File download (JSON or CSV)

**Example:**
```bash
curl -H "x-session-id: abc123" \
  'http://localhost:3001/api/export/logs?format=csv&limit=100'
```

---

### Export Report Data
```
GET /api/export/report?format=json|csv
Authorization: x-session-id header required
Content-Disposition: attachment; filename="report_{date}.{format}"
```

**Query Parameters:**
- `format` (required): `json` or `csv`

**Response:** File download (JSON or CSV)

**Example:**
```bash
curl -H "x-session-id: abc123" \
  'http://localhost:3001/api/export/report?format=json'
```

---

## Undo Endpoint

### Undo Operation
```
POST /api/operation/undo
Authorization: x-session-id header required
Content-Type: application/json
```

**Request Body:**
```json
{
  "operationId": "op_12345..."
}
```

**Response (Success):**
```json
{
  "undoOperationId": "undo_67890...",
  "originalOperationId": "op_12345...",
  "operationType": "ARCHIVE",
  "status": "success",
  "summary": {
    "succeeded": 145,
    "failed": 0,
    "errors": []
  },
  "timestamp": "2026-03-12T14:30:00Z"
}
```

**Response (Error):**
```json
{
  "error": "Operation type LABEL cannot be undone"
}
```

**Example:**
```bash
curl -X POST \
  -H "x-session-id: abc123" \
  -H "Content-Type: application/json" \
  -d '{"operationId":"op_12345..."}' \
  'http://localhost:3001/api/operation/undo'
```

---

## Enhanced Logs Endpoint

### Get Operation Logs (with Filtering)
```
GET /api/logs?type=ARCHIVE&status=completed&startDate=2026-03-01&endDate=2026-03-12&limit=50&offset=0
Authorization: x-session-id header required
```

**Query Parameters (all optional):**
- `type`: `ARCHIVE`, `TRASH`, `LABEL`, or `UNDO_*`
- `status`: `pending`, `executing`, `completed`, `partial_failure`
- `startDate`: ISO date string (e.g., `2026-03-01`)
- `endDate`: ISO date string (e.g., `2026-03-12`)
- `limit`: Pagination limit (default: 50)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "logs": [
    {
      "id": "op_12345...",
      "type": "ARCHIVE",
      "status": "completed",
      "timestamp": "2026-03-12T14:30:00Z",
      "affectedCount": 145,
      "results": {
        "succeeded": 145,
        "failed": 0,
        "errors": []
      },
      "undoInfo": {
        "canUndo": true,
        "operationType": "ARCHIVE",
        "timeLimit": "24 hours",
        "note": "This operation can be undone for up to 24 hours"
      }
    }
  ]
}
```

**Example:**
```bash
curl -H "x-session-id: abc123" \
  'http://localhost:3001/api/logs?type=ARCHIVE&status=completed&startDate=2026-03-01&limit=20'
```

---

## Backend Implementation Details

### Supported Undo Operations

| Type | Support | Notes |
|------|---------|-------|
| ARCHIVE | ✅ Yes | Restores messages to INBOX |
| TRASH | ✅ Yes | Restores messages to INBOX |
| LABEL | ❌ No | Future: needs label ID tracking |

### Export Formats

**JSON:** Structured data with proper typing
```json
{
  "operationId": "op_12345",
  "type": "ARCHIVE",
  "status": "completed",
  "timestamp": "2026-03-12T14:30:00Z",
  "affectedCount": 145,
  "results": { "succeeded": 145, "failed": 0 }
}
```

**CSV:** Flattened with proper escaping
```
Operation ID,Type,Status,Timestamp,Affected Count,Succeeded,Failed
op_12345,ARCHIVE,completed,2026-03-12T14:30:00Z,145,145,0
```

### Audit Logging

Every undo operation creates:
1. **New operation record**: type = `UNDO_ARCHIVE` or `UNDO_TRASH`
2. **Audit log entry**: event_type = `UNDO`, metadata includes:
   - `originalOperationId`: ID of operation being undone
   - `undoType`: Operation type that was undone
   - `results`: Success/failure counts

**Example audit_log entry:**
```json
{
  "id": "audit_xyz",
  "user_email": "user@gmail.com",
  "operation_id": "undo_67890",
  "event_type": "UNDO",
  "summary": "Undid ARCHIVE operation op_12345: 145/145 succeeded",
  "metadata": {
    "originalOperationId": "op_12345",
    "undoType": "ARCHIVE",
    "results": {
      "succeeded": 145,
      "failed": 0,
      "errors": []
    }
  },
  "created_at": "2026-03-12T14:31:00Z"
}
```

---

## Error Handling

### Common Errors

**Operation not found:**
```json
{
  "error": "Operation not found"
}
```

**Operation still executing:**
```json
{
  "error": "Cannot undo operation that is currently executing"
}
```

**Operation type not supported:**
```json
{
  "error": "Operation type LABEL cannot be undone"
}
```

**No messages found:**
```json
{
  "error": "No messages found for this operation"
}
```

**Partial failure during undo:**
```json
{
  "undoOperationId": "undo_xyz",
  "originalOperationId": "op_12345",
  "status": "partial_failure",
  "summary": {
    "succeeded": 140,
    "failed": 5,
    "errors": [
      {
        "batch": 0,
        "error": "Rate limit exceeded",
        "count": 5
      }
    ]
  }
}
```

---

## Rate Limiting & Constraints

- Export limit: 500 logs per request (configurable)
- Undo batch size: 500 messages per API call (matches execute)
- Undo time limit: Enforced by Gmail (24h for ARCHIVE, 30d for TRASH)
- Session required: All endpoints require valid x-session-id header

---

## Frontend Integration

### Export Usage
```javascript
// Export logs as JSON
const client = axios.create({
  baseURL: 'http://localhost:3001',
  responseType: 'blob'
});

const response = await client.get('/api/export/logs?format=json&limit=500');
// Browser automatically downloads file with proper headers
```

### Filtering Usage
```javascript
// Filter logs in LogsTab
const filters = {
  type: 'ARCHIVE',
  status: 'completed',
  startDate: '2026-03-01',
  endDate: '2026-03-12',
  limit: 20
};

const res = await api.operations.getLogs(filters);
// Returns logs with undoInfo enriched
```

### Undo Usage
```javascript
// Undo operation
try {
  const result = await api.operations.undo(operationId);
  console.log('Undo successful:', result.undoOperationId);
} catch (err) {
  console.error('Undo failed:', err.response?.data?.error);
}
```

---

## Testing the New Features

### Test Export
```bash
# Export logs as CSV
curl -H "x-session-id: YOUR_SESSION_ID" \
  'http://localhost:3001/api/export/logs?format=csv' \
  > logs.csv

# Export report as JSON
curl -H "x-session-id: YOUR_SESSION_ID" \
  'http://localhost:3001/api/export/report?format=json' \
  > report.json
```

### Test Filtering
```bash
# Get ARCHIVE operations from March 1-12
curl -H "x-session-id: YOUR_SESSION_ID" \
  'http://localhost:3001/api/logs?type=ARCHIVE&startDate=2026-03-01&endDate=2026-03-12'

# Get only completed operations
curl -H "x-session-id: YOUR_SESSION_ID" \
  'http://localhost:3001/api/logs?status=completed'
```

### Test Undo
```bash
# Undo an ARCHIVE operation
curl -X POST \
  -H "x-session-id: YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"operationId":"op_12345..."}' \
  'http://localhost:3001/api/operation/undo'
```
