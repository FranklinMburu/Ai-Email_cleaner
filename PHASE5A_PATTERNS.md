# Phase 5A: Implementation Patterns & Best Practices

## Patterns Implemented

### Pattern 1: Timeout-Protected Async Operations

**Problem:** External API calls (Google OAuth) can hang indefinitely

**Solution:** Promise.race() with timeout

```javascript
// Pattern for timeout-protected async operations
async function protectedAsyncCall(promise, timeoutMs = 10000) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Operation timeout')), timeoutMs);
  });
  
  return await Promise.race([promise, timeoutPromise]);
}

// Use case: OAuth token refresh
export async function refreshTokensWithTimeout(refreshToken, timeoutMs = 10000) {
  const refreshPromise = client.refreshAccessToken();
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Token refresh timeout...')), timeoutMs);
  });
  
  const { credentials } = await Promise.race([refreshPromise, timeoutPromise]);
  return credentials;
}
```

**Benefits:**
- Prevents indefinite hangs
- Clear timeout error messages
- Applies to any external API call

**Usage Guidelines:**
- API calls to external services: 10-30 second timeout
- Internal database calls: 5 second timeout
- UI/UX operations: 30-60 second timeout

---

### Pattern 2: Separated Error Boundaries

**Problem:** Auth failures silently propagate, making root cause unclear

**Solution:** Explicit try-catch blocks at each stage

```javascript
// Before: Single catch block for entire operation
try {
  const client = await getGmailClient(email);  // Hangs if auth fails
  const data = await client.fetch(...);        // Never reached
  await db.insert(data);                        // Never reached
} catch (error) {  // Difficult to know which stage failed
  throw error;
}

// After: Separated error boundaries
try {
  let client;
  try {
    client = await getGmailClient(email);  // Auth errors caught here
  } catch (authError) {
    console.error('[Sync] Auth failed:', authError.message);
    throw authError;  // Re-throw with context
  }

  const data = await client.fetch(...);     // Data fetch errors caught here
  
  try {
    await db.insert(data);                  // DB errors caught here
  } catch (dbError) {
    console.error('[Sync] DB insert failed:', dbError.message);
    throw dbError;
  }
} catch (error) {
  // Context about which stage failed is now clear
  throw error;
}
```

**Benefits:**
- Errors caught at source with clear context
- Side effects (like sync_state updates) only happen on success
- Easier debugging and logging

---

### Pattern 3: State Update Guard

**Problem:** State updates happen before confirming operation success

**Solution:** Only update state after all success criteria met

```javascript
// Before: sync_state updated before data persistence confirmed
async function syncMetadata(userEmail) {
  const gmail = await getGmailClient(userEmail);
  const messageIds = await gmail.list(...);
  
  // sync_state updated here
  db.prepare('UPDATE sync_state SET last_sync_at = ?').run(Date.now());
  
  // If DB insert fails, sync_state still shows success
  await insertMessages(messageIds);  // Could fail!
}

// After: sync_state updated only after complete success
async function syncMetadata(userEmail) {
  const gmail = await getGmailClient(userEmail);
  const messageIds = await gmail.list(...);
  
  // Insert messages and count how many succeeded
  const insertedCount = await insertMessages(messageIds);
  
  // Only update sync_state if we know data actually persisted
  if (insertedCount > 0 || messageIds.length === 0) {
    db.prepare('UPDATE sync_state SET last_sync_at = ?').run(Date.now());
  }
  
  return { status: 'completed', messageCount: insertedCount };
}
```

**Benefits:**
- System state accurately reflects reality
- No false success indicators
- Can verify success before committing state

---

### Pattern 4: Clear Error Messages with Recovery Path

**Problem:** Generic errors leave users confused about what to do

**Solution:** Categorize errors and provide specific guidance

```javascript
// Before: Generic error message
catch (error) {
  throw new Error('Failed to refresh authentication token');
}

// After: Categorized errors with recovery guidance
catch (error) {
  const errorMsg = error.code === 'ENOTFOUND' 
    ? 'Network error - cannot reach Google authentication servers. Check your internet connection.'
    : error.message?.includes('invalid_grant')
    ? 'Authentication failed - refresh token is invalid or revoked. Please reconnect your Gmail account.'
    : error.message?.includes('timeout')
    ? 'Authentication took too long. Please reconnect your Gmail account.'
    : error.message || 'Unknown authentication error';
  
  console.error('[OAuth] Token refresh failed:', errorMsg);
  throw new Error(errorMsg);
}

// Frontend enhancement: User-facing messages
// (converts error message to actionable guidance)
catch (err) {
  if (err.message.includes('invalid') || err.message.includes('revoked')) {
    showError('Gmail authentication expired. Please disconnect and reconnect your account.');
  } else if (err.message.includes('timeout')) {
    showError('Sync took too long. Please try again or check your network.');
  } else if (err.message.includes('Network')) {
    showError('Cannot reach Gmail. Check your internet connection and try again.');
  } else {
    showError('Sync failed: ' + err.message);
  }
}
```

**Benefits:**
- Users understand what went wrong
- Clear recovery path
- Reduces support burden

---

### Pattern 5: Pre-Flight Validation

**Problem:** Operations fail deep in execution path after delayed detection

**Solution:** Validate prerequisites before starting operation

```javascript
// Before: Validation happens during execution
async function syncMetadata(userEmail) {
  const gmail = await getGmailClient(userEmail);  // ← Fails here, after time spent
  // ... rest of sync
}

// After: Validation happens upfront
async function syncMetadata(userEmail) {
  // Check token validity BEFORE starting expensive operation
  const tokenValidity = validateTokenValidity(userEmail);
  if (!tokenValidity.isValid) {
    console.warn('[Sync] Pre-flight validation failed:', tokenValidity.message);
    // Can return early or warn user
  }

  // Now proceed with operation
  const gmail = await getGmailClient(userEmail);
  // ... rest of sync
}
```

**Benefits:**
- Early failure detection
- Reduced wasted resources
- Better user feedback (can warn before starting)

---

### Pattern 6: Request Timeout at Multiple Layers

**Problem:** Single point of failure (backend) can hang entire system

**Solution:** Timeout protection at each layer

```
API Request Flow with Timeouts:
┌─────────────────────────────────────────────────┐
│ Frontend Axios Request Timeout: 30 seconds      │
├──────────────────────────────────┬──────────────┤
│ Backend /api/sync endpoint       │              │
├───────────────────────────────────┼──────────────┤
│ getGmailClient() Timeout: 10s    │  <-- Token   │
│ (OAuth API call)                 │     Refresh  │
├───────────────────────────────────┼──────────────┤
│ Gmail API call (batchGet)        │  <-- API     │
│ (implicit Google timeout ~30s)   │     Call     │
└───────────────────────────────────┴──────────────┘
```

**Implementation:**
```javascript
// Frontend layer
const client = axios.create({ timeout: 30000 });

// Backend OAuth layer  
async refreshTokensWithTimeout(token, 10000)  // 10s max

// Backend Gmail API layer
gmail.users.messages.batchGet({...})  // Uses Google's default timeout
```

**Benefits:**
- Failure at any layer doesn't cascade
- Multiple bailout opportunities
- Clear responsibility at each level

---

## Configuration Patterns

### Environment Variable Validation

```javascript
// In config.js or startup
const requiredEnv = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
const missing = requiredEnv.filter(key => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
```

### Timeout Configuration Matrix

```javascript
// Different timeouts for different operations
const TIMEOUTS = {
  AUTH: 10000,      // OAuth token operations
  API: 30000,       // Google Gmail API calls
  REQUEST: 30000,   // General HTTP requests
  DB: 5000,         // Database operations
  BATCH: 15000,     // Batch operations
};
```

---

## Testing Patterns

### Token Validation Testing

```javascript
// Test token validation endpoint
curl -H "x-session-id: [SESSION]" \
  http://localhost:3001/api/auth/token-status

// Expected responses:
// {
//   "isValid": false,
//   "expiresIn": 0,
//   "message": "Authentication token expired..."
// }

// OR

// {
//   "isValid": true,
//   "expiresIn": 180,
//   "message": "Token is valid"
// }
```

### Timeout Testing

```javascript
// Test that endpoint doesn't hang (use timeout wrapper)
timeout 15 curl -X POST http://localhost:3001/api/sync ...

# If hangs: No response after 15 seconds (FAIL)
# If works: Response within 15 seconds (PASS)

# Verify error response is valid JSON
curl ... | jq .  # Should parse successfully
```

---

## Error Message Taxonomy

### Backend Error Types

| Type | Cause | Message Pattern | Recovery |
|------|-------|-----------------|----------|
| **NETWORK** | Cannot reach external API | "Network error - cannot reach..." | Check internet, retry |
| **AUTH** | Invalid/revoked credentials | "Authentication failed - ..." | Reconnect account |
| **TIMEOUT** | Operation too slow | "...took too long" | Retry or optimize |
| **NOTFOUND** | Missing token/session | "No tokens found..." | Re-authenticate |
| **INVALID_GRANT** | Token revoked or expired | "...invalid or revoked..." | Reconnect account |

### Frontend Error Display

```javascript
// Map backend errors to user-friendly messages
const errorMap = {
  'invalid_grant': {
    title: '🔐 Authentication Expired',
    message: 'Your Gmail connection expired. Please disconnect and reconnect.',
    action: 'Reconnect Gmail'
  },
  'timeout': {
    title: '⏱️ Took Too Long',
    message: 'Sync is taking longer than expected. Please try again.',
    action: 'Retry'
  },
  'Network': {
    title: '📡 Network Error',
    message: 'Cannot reach Gmail. Check your internet connection.',
    action: 'Retry'
  },
};
```

---

## Debugging Patterns

### Logging Best Practices

```javascript
// Use consistent prefixes for tracing
[OAuth] Token refresh attempt
[Sync] Starting sync operation
[Sync.incremental] Using historyId: 123
[Sync.full] Fetching metadata
[Sync.metadata] Batch 1 processing
[Sync] Complete

// Log context at each stage
console.log(`[Sync] Starting for ${userEmail}, mode: ${mode}`);
console.log(`[OAuth] Options: timeout=${timeoutMs}ms, method=${method}`);
```

### Error Context Logging

```javascript
// Log full error chain for debugging
catch (error) {
  console.error('[Sync] Error at metadata fetch:', {
    message: error.message,
    code: error.code,
    stack: error.stack,
    userId: userEmail,
    stage: 'fetchMessageMetadata',
    timestamp: new Date().toISOString(),
  });
}
```

---

## Conclusion

Phase 5A implementations demonstrate these key principles:

1. **Timeout Protection** - External calls must have escape routes
2. **Error Boundaries** - Catch errors at source with context
3. **State Consistency** - Only update state on verified success
4. **User Guidance** - Clear error messages with recovery steps
5. **Early Validation** - Check prerequisites before expensive operations
6. **Layered Timeouts** - Protection at frontend, backend, and API layers

These patterns make the system:
- More resilient to failures
- Easier to debug
- Better user experience
- Maintainable long-term

---

**Reference Implementation:** Phase 5A - Sync Recovery and Authentication Reliability  
**Date:** March 12, 2026
