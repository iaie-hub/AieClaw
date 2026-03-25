# Message Flow Diagram: User Authentication & Message Persistence

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WebSocket Client                                   │
│                                                                               │
│  1. Login: POST /auth/login → masToken (JWT)                                │
│  2. Connect: ws://gateway?masToken=<JWT>                                    │
│  3. Send: chat.send({ sessionKey, message })                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Gateway (src/gateway/)                                │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ WebSocket Connection Handler                                        │   │
│  │                                                                      │   │
│  │ onClientConnected(client, upgradeReq)                              │   │
│  │  ├─ Extract masToken from URL                                      │   │
│  │  ├─ Verify JWT signature                                           │   │
│  │  └─ setMasAuth(client, { userId, tenantId, role, ... })           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ chat.send Wrapper (mas4s-integration.ts)                           │   │
│  │                                                                      │   │
│  │ 1. Extract masAuth from client                                     │   │
│  │    └─ masAuth = { userId, tenantId, displayName, ... }            │   │
│  │                                                                      │   │
│  │ 2. Extract sessionKey from params                                  │   │
│  │    └─ sessionKey = "agent:default:group:mas-9219ad00"             │   │
│  │                                                                      │   │
│  │ 3. ✅ Record sender context (FIX)                                  │   │
│  │    └─ transcriptStore.recordSenderContext(sessionKey, {            │   │
│  │         userId: masAuth.userId,                                    │   │
│  │         tenantId: masAuth.tenantId                                 │   │
│  │       })                                                            │   │
│  │       └─ senderMap.set(sessionKey, { userId, tenantId })          │   │
│  │                                                                      │   │
│  │ 4. Call core chat.send handler                                     │   │
│  │    └─ Emit SessionTranscriptUpdate event                           │   │
│  │                                                                      │   │
│  │ 5. Broadcast to session members                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                    aiemas Module (aiemas/src/)                               │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SessionTranscriptStore (session-history/)                          │   │
│  │                                                                      │   │
│  │ start()                                                             │   │
│  │  └─ Subscribe to onSessionTranscriptUpdate event                   │   │
│  │     └─ handleUpdate(update) called when event fires                │   │
│  │                                                                      │   │
│  │ handleUpdate(update)                                               │   │
│  │  ├─ Extract: sessionKey, role, content, timestamp, sessionId       │   │
│  │  ├─ ✅ Look up senderMap[sessionKey]                               │   │
│  │  │   └─ Get: { userId, tenantId }                                  │   │
│  │  ├─ Create StoredMessage with userId/tenantId                      │   │
│  │  └─ Push to buffer                                                 │   │
│  │                                                                      │   │
│  │ Periodic flush (500ms) or buffer full (100 msgs)                   │   │
│  │  ├─ Drain buffer                                                   │   │
│  │  ├─ Check archive dates (daily boundary)                           │   │
│  │  └─ persistBatch(msgs)                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SQLite Database (mas4s.db)                                         │   │
│  │                                                                      │   │
│  │ session_messages table                                             │   │
│  │  ├─ id: UUID                                                       │   │
│  │  ├─ sessionKey: "agent:default:group:mas-9219ad00"                │   │
│  │  ├─ sessionId: "8e1f65cf-34e5-4181-897d-352ff5618412"             │   │
│  │  ├─ userId: "user-123" ✅ (from masToken)                         │   │
│  │  ├─ tenantId: "tenant-456" ✅ (from masToken)                     │   │
│  │  ├─ role: "user"                                                   │   │
│  │  ├─ content: "你好"                                                │   │
│  │  ├─ timestamp: 1774401872064                                       │   │
│  │  ├─ seq: 1                                                         │   │
│  │  └─ archivedDate: null (active message)                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Detailed Sequence Diagram

```
Client                Gateway              aiemas              Database
  │                     │                    │                    │
  ├─ Login ────────────→│                    │                    │
  │                     ├─ auth.login ──────→│                    │
  │                     │                    ├─ Generate JWT      │
  │                     │←─ masToken ────────┤                    │
  │←─ masToken ─────────┤                    │                    │
  │                     │                    │                    │
  ├─ Connect ──────────→│ (masToken in URL)  │                    │
  │                     ├─ onClientConnected │                    │
  │                     ├─ Verify JWT ──────→│                    │
  │                     │←─ { userId, ... }──┤                    │
  │                     ├─ setMasAuth(client)│                    │
  │                     │                    │                    │
  ├─ chat.send ────────→│ (sessionKey, msg)  │                    │
  │                     ├─ Extract masAuth   │                    │
  │                     ├─ recordSenderContext────────────────────→│
  │                     │  (sessionKey, {userId, tenantId})       │
  │                     │                    ├─ senderMap.set()   │
  │                     ├─ Core handler      │                    │
  │                     ├─ Emit event ──────→│                    │
  │                     │                    ├─ handleUpdate()    │
  │                     │                    ├─ Look up senderMap │
  │                     │                    ├─ Create message    │
  │                     │                    ├─ Buffer message    │
  │                     │                    │                    │
  │                     │                    ├─ [500ms later]     │
  │                     │                    ├─ flush() ─────────→│
  │                     │                    │  INSERT messages   │
  │                     │                    │  with userId ✅    │
  │                     │                    │←─ OK ──────────────┤
  │                     │                    │                    │
  │←─ Response ────────┤                    │                    │
  │                     │                    │                    │
```

## Key Data Structures

### masAuth (from masToken JWT)

```typescript
interface MasAuthContext {
  userId: string; // User ID from JWT
  tenantId: string; // Tenant ID from JWT
  role: "admin" | "user"; // User role
  displayName: string; // User's display name
  masRole?: string; // Additional role info
}
```

### senderMap (in SessionTranscriptStore)

```typescript
senderMap: Map<string, SenderContext>;

// Example:
senderMap.set("agent:default:group:mas-9219ad00", {
  userId: "user-123",
  tenantId: "tenant-456",
});
```

### StoredMessage (persisted to DB)

```typescript
interface StoredMessage {
  id: string; // UUID
  sessionKey: string; // "agent:default:group:mas-9219ad00"
  sessionId: string; // "8e1f65cf-34e5-4181-897d-352ff5618412"
  userId: string | null; // ✅ From masToken
  tenantId: string | null; // ✅ From masToken
  role: "user" | "assistant" | "tool" | "summary";
  content: string; // Message text
  timestamp: number; // Unix ms
  seq: number; // Sequence per sessionId
  archivedDate: string | null; // "yyyy-mm-dd" or null
}
```

## Timeline: From User Input to Database

```
T+0ms:
  └─ User sends message via WebSocket
     └─ chat.send RPC called

T+0ms:
  └─ mas4s wrapper intercepts
     ├─ Extract masAuth from client
     ├─ recordSenderContext(sessionKey, { userId, tenantId })
     │  └─ senderMap.set(sessionKey, { userId, tenantId })
     └─ Call core handler

T+0ms:
  └─ Core handler processes
     ├─ Validate & sanitize
     ├─ Persist to gateway JSONL
     └─ Emit SessionTranscriptUpdate event

T+0-2s:
  └─ SessionTranscriptUpdate event fires
     └─ handleUpdate() called

T+0-2s:
  └─ handleUpdate processes
     ├─ Extract message fields
     ├─ Look up senderMap[sessionKey] → { userId, tenantId }
     ├─ Create StoredMessage with userId/tenantId
     └─ Push to buffer

T+500ms:
  └─ Periodic flush triggered
     ├─ Drain buffer
     ├─ Check archive dates
     └─ INSERT to SQLite

T+500ms:
  └─ Message persisted to database ✅
     ├─ userId: "user-123" ✅
     ├─ tenantId: "tenant-456" ✅
     └─ All other fields populated
```

## The Bug & The Fix

### Before Fix (Bug)

```
chat.send wrapper
  ├─ Extract masAuth ✅
  ├─ Call core handler ✅
  └─ Broadcast ✅

  ❌ recordSenderContext NOT called

handleUpdate (2 seconds later)
  ├─ Look up senderMap[sessionKey]
  ├─ senderMap is EMPTY ❌
  └─ userId = null, tenantId = null ❌

Database
  └─ INSERT with userId=null, tenantId=null ❌
```

### After Fix (Correct)

```
chat.send wrapper
  ├─ Extract masAuth ✅
  ├─ recordSenderContext(sessionKey, { userId, tenantId }) ✅
  │  └─ senderMap.set(sessionKey, { userId, tenantId })
  ├─ Call core handler ✅
  └─ Broadcast ✅

handleUpdate (2 seconds later)
  ├─ Look up senderMap[sessionKey]
  ├─ senderMap HAS entry ✅
  └─ userId = "user-123", tenantId = "tenant-456" ✅

Database
  └─ INSERT with userId="user-123", tenantId="tenant-456" ✅
```

## Code Changes Summary

### File: `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`

1. **Exposed transcriptStore** in `Mas4sGatewayPlugin` interface
2. **Returned transcriptStore** from `createMas4sGatewayPlugin()`
3. **Simplified chat.send handler** (now replaced by wrapper)

### File: `src/gateway/mas4s-integration.ts`

1. **Added recordSenderContext call** in chat.send wrapper
2. **Timing**: Before core handler runs
3. **Effect**: Populates senderMap with userId/tenantId

### File: `aiemas/src/session-history/session-history.test.ts`

1. **Added test**: `recordSenderContext: userId and tenantId are associated with sessionKey and used in handleUpdate`
2. **Verifies**: userId/tenantId are correctly persisted to database

## Testing

```bash
# Run all session history tests
pnpm test -- aiemas/src/session-history/session-history.test.ts

# Run specific test
pnpm test -- aiemas/src/session-history/session-history.test.ts -t "recordSenderContext"
```

**Result**: All 19 tests pass ✅
