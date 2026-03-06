# Gmail Inbox Cleanup Tool

A safe, AI-assisted, human-controlled tool for organizing Gmail inboxes with 40,000+ emails.

## Features

- ✅ **Safe by Default**: No destructive actions without explicit user approval
- ✅ **Incremental Sync**: Efficient metadata fetching for large inboxes
- ✅ **AI Categorization**: Metadata-first rules engine to group emails
- ✅ **Dry-Run Preview**: See exactly what will happen before execution
- ✅ **Protected Emails**: Starred and important messages never touched without override
- ✅ **Full Audit Logging**: Every action logged immutably
- ✅ **Reversible Actions**: Archive and label preferred; trash reversible; delete blocked

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: React
- **Database**: SQLite (local, encrypted at rest)
- **OAuth**: Google Gmail API v1 with minimal scopes

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Google OAuth credentials (see section below)

### 1. Clone & Install

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Desktop App)
5. Download credentials JSON

### 3. Configure Backend

```bash
cd backend

# Copy example env file
cp .env.example .env

# Edit .env with your OAuth credentials and generate encryption key
nano .env

# Generate encryption key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Run Backend

```bash
cd backend
npm run dev
# Server runs on http://localhost:3001
```

### 5. Run Frontend

```bash
cd frontend
REACT_APP_API_URL=http://localhost:3001 npm start
# App opens at http://localhost:3000
```

## Usage

### 1. Connect Gmail

- Click "Connect Gmail"
- Authorize the app (minimal scopes: metadata + modify)
- You'll be redirected to dashboard

### 2. Sync Metadata

- Click "Sync Now" on the Overview tab
- Wait for sync to complete (large inboxes may take 5-30 minutes)

### 3. Generate Report

- Click "Generate Report"
- AI categorizes emails into: newsletters, notifications, promotions, receipts, old emails, etc.
- Each category shows count, confidence, samples, and top senders

### 4. Compose & Dry-Run Action

- Go to Actions tab
- Select a category
- Choose action (Archive, Label, or Trash)
- Click "Preview (Dry Run)"
- Review counts, samples, and risks

### 5. Execute with Approval

- Review dry-run results
- Click "Start Cleanup" (requires explicit click)
- Monitor progress
- Execution logged immutably in Logs tab

### 6. View Logs

- Logs tab shows all operations
- Each log entry immutable
- Shows counts, status, recovery options

## Architecture

### Data Flow

```
OAuth → Fetch Metadata → Categorize → Recommend → Dry-Run → Execute → Audit Log
```

### Database Schema

- `oauth_tokens`: Encrypted refresh tokens
- `message_metadata`: Cached email metadata (id, from, subject, date, labels, etc.)
- `sync_state`: Last sync timestamp and historyId for incremental sync
- `categorization_cache`: Email → category mapping
- `operations`: Each operation record (user approval required)
- `audit_log`: Immutable operation audit trail

### Incremental Sync Strategy

- Uses Gmail's `historyId` to fetch only changed messages
- Falls back to full sync if historyId invalid
- Stores `history_id` and `last_sync_at` per user

### Safety Rails (Invariants)

1. **No action without explicit UI click** — operation_id approval flow
2. **Dry-run mandatory** — preview before execution
3. **Protected labels exempt** — STARRED, IMPORTANT never modified without override toggle
4. **Immutable logs** — audit trail cannot be edited
5. **Reversibility ensured** — archive/label preferred; delete blocked by default
6. **AI non-binding** — recommendations are suggestions only

## API Endpoints

### Auth

- `GET /api/auth/init` — Get OAuth URL
- `POST /api/auth/callback` — Exchange code for tokens
- `POST /api/auth/disconnect` — Revoke and clear session

### Sync

- `POST /api/sync` — Sync metadata (incremental or full)
- `POST /api/sync/clear` — Clear local cache

### Report

- `GET /api/report` — Generate AI recommendations
- `GET /api/inbox-overview` — Get inbox statistics

### Operations

- `POST /api/operation/dryrun` — Dry-run an operation
- `POST /api/operation/execute` — Execute approved operation
- `GET /api/logs` — Get operation audit log

## Testing

### Unit Tests (Categorization)

```bash
cd backend
npm test
```

### Integration Test (Manual Smoke)

```bash
# Terminal 1: Start backend
cd backend && npm run dev

# Terminal 2: Start frontend
cd frontend && REACT_APP_API_URL=http://localhost:3001 npm start

# In browser:
# 1. Connect (or use mocked auth)
# 2. Sync metadata
# 3. Generate report
# 4. Dry-run archive on "newsletters" category
# 5. Execute if preview looks good
# 6. Check logs
```

## Security

### Token Management

- Refresh tokens encrypted AES-256 at rest
- Access tokens kept in memory only
- Tokens revoked on disconnect

### Data Privacy

- No email bodies stored (except transient deep analysis samples)
- Only metadata cached locally
- No raw email content in audit logs, only message IDs

### OAuth Scopes

- `gmail.metadata` — Read message metadata only
- `gmail.modify` — Apply labels, archive, trash
- `userinfo.profile` — Session management
- No `gmail` or `gmail.readonly` (would enable body access by default)

## Development

### Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── database.js          (SQLite schema + init)
│   │   ├── encryption.js        (Token encryption)
│   │   ├── oauth.js             (OAuth + token management)
│   │   ├── sync.js              (Gmail metadata sync + incremental)
│   │   ├── categorize.js        (Rule-based categorization)
│   │   ├── operations.js        (Dry-run + execute + logs)
│   │   ├── routes.js            (Express endpoints)
│   │   └── server.js            (Express app)
│   ├── tests/
│   │   └── categorize.test.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.js     (Main UI + tabs)
│   │   │   └── Dashboard.css
│   │   ├── services/
│   │   │   └── api.js           (API client)
│   │   ├── App.js
│   │   └── index.js
│   ├── public/
│   │   └── index.html
│   └── package.json
└── docs/
    └── design/
        └── gmail-inbox-cleanup.md
```

### Adding a New Categorization Rule

1. Edit `backend/src/categorize.js`
2. Add a rule object to the `RULES` array:
   ```javascript
   {
     id: 'my_category',
     name: 'My Category Name',
     rules: [
       (email) => email.subject.includes('keyword'),
       (email) => email.from_addr.includes('domain'),
     ],
     confidence: 0.80,
     suggestedAction: 'archive',
   }
   ```
3. Test with `npm test`

## Limitations & Future Work

### Current Scope

- Single user per session
- Local database only (no backup)
- Metadata-only analysis (deep analysis opt-in, not implemented yet)
- Manual execution (no scheduled cleanup)

### Future Enhancements

- Deep content analysis (optional, opt-in)
- Scheduled/recurring cleanups
- Export/import categorization rules
- Multi-device sync
- Team/shared folder support

## Troubleshooting

### "Token expired" Error

- Click "Disconnect" and reconnect to Gmail
- Refresh tokens are automatically rotated

### Sync hangs or rate-limited

- Gmail API has quotas; wait 60+ seconds before retrying
- Backend auto-backs off exponentially
- Try smaller batch size if needed

### Database locked

- Backend uses WAL mode for concurrent access
- If corrupted, delete `data/app.sqlite*` and resync

## Contributing

1. Keep commits small and focused
2. Test changes with `npm test` and smoke flow
3. Maintain safety invariants (no action without approval)
4. Update docs if adding features

## License

MIT

## Support

For issues or questions, check the design doc at `docs/design/gmail-inbox-cleanup.md`

---

**Status**: Alpha (feature-complete for MVP)  
**Last Updated**: March 2026
