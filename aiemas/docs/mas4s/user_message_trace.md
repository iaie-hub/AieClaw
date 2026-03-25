# User Message Trace: masToken Verification & Message Persistence

This document traces the complete flow of how a user message is authenticated via masToken and persisted to the aiemas message database.

## 1. masToken Verification Flow

### 1.1 User Login → masToken Generation

```
User Login Request
    ↓
auth.login (gateway extraHandler)
    ├─ TenantService.login()
    │  ├─ Verify username/password
    │  ├─ Generate JWT token (masToken)
    │  └─ Return { ok: true, masToken, userId, tenantId, ... }
    ↓
Client receives masToken
```

**Location**: `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts` → `auth.login` handler

**Code**:

```typescript
"auth.login": async ({ params, respond }) => {
  const result = tenantService.login(loginParams);
  if (result.ok) {
    respond(true, result, undefined);  // Returns masToken
  }
}
```

### 1.2 WebSocket Connection with masToken

```
Client connects to WebSocket with masToken in URL
    ↓
URL: ws://gateway:port?masToken=<JWT>
    ↓
Gateway receives upgrade request
    ├─ Extract masToken from URL query params
    │  (Location: src/gateway/mas4s-integration.ts → extractMasTokenFromUrl)
    ├─ Verify masToken signature & expiry
    │  (Location: aiemas/src/gateway-bridge/context.js → verifyToken)
    └─ Extract { userId, tenantId, role } from JWT payload
```

**Location**: `src/gateway/mas4s-integration.ts` → `onClientConnected`

**Code**:

```typescript
const onClientConnected: Mas4sIntegration["onClientConnected"] = (client, upgradeReq) => {
  const masToken = integrationMod.extractMasTokenFromUrl(upgradeReq);
  if (masToken) {
    const auth = bridge.authenticateConnect(masToken);
    if (auth.ok) {
      contextMod.setMasAuth(client, {
        userId: auth.userId,
        tenantId: auth.tenantId,
        role: auth.role,
        ...
      });
    }
  }
};
```

### 1.3 Per-Request Auth Context Retrieval

```
Each gateway method call (e.g., chat.send)
    ↓
Extract masAuth from client object
    ├─ Location: src/gateway/mas4s-integration.ts
    ├─ Code: contextMod.getMasAuth(opts.client)
    └─ Returns: { userId, tenantId, role, displayName, ... }
```

**Location**: `src/gateway/mas4s-integration.ts` → `chat.send` wrapper

**Code**:

```typescript
const masAuth = opts.client
  ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
  : contextMod.NULL_MAS_AUTH;
```

---

## 2. User Message Persistence Flow

### 2.1 Message Capture Entry Point: chat.send

```
User sends message via WebSocket
    ↓
chat.send RPC method called
    ├─ params: { sessionKey, message, clientRunId, ... }
    ├─ client: WebSocket connection object (with masAuth attached)
    └─ context: Gateway request context
```

**Location**: `src/gateway/server-methods/chat.ts`

### 2.2 mas4s Integration Wrapper

```
chat.send wrapper (in mas4s-integration.ts)
    ↓
Step 1: Extract masAuth from client
    ├─ masAuth.userId (from masToken JWT)
    ├─ masAuth.tenantId (from masToken JWT)
    └─ masAuth.displayName (user's display name)
    ↓
Step 2: Extract sessionKey from params
    ├─ sessionKey: "agent:default:group:mas-9219ad00"
    └─ Validate: must be non-empty string
    ↓
Step 3: Record sender context (NEW FIX)
    ├─ Call: plugin.transcriptStore.recordSenderContext(sessionKey, {
    │    userId: masAuth.userId ?? null,
    │    tenantId: masAuth.tenantId ?? null
    │  })
    ├─ Effect: Store mapping in memory
    │  senderMap: Map<sessionKey, { userId, tenantId }>
    └─ Timing: BEFORE core handler runs
    ↓
Step 4: Call core chat.send handler
    ├─ Manages idempotency
    ├─ Persists to gateway JSONL
    ├─ Triggers agent run
    └─ Emits SessionTranscriptUpdate event
    ↓
Step 5: Broadcast to session members
    └─ Real-time collaboration event
```

**Location**: `src/gateway/mas4s-integration.ts` (lines 715-760)

**Code**:

```typescript
const coreChatSend = chatHandlers["chat.send"];
if (coreChatSend) {
  extraHandlers["chat.send"] = async (opts) => {
    const masAuth = opts.client
      ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
      : contextMod.NULL_MAS_AUTH;
    const sessionKey =
      typeof opts.params["sessionKey"] === "string" ? opts.params["sessionKey"] : "";

    // ✅ Record sender context BEFORE core handler
    if (sessionKey) {
      plugin.transcriptStore.recordSenderContext(sessionKey, {
        userId: masAuth.userId ?? null,
        tenantId: masAuth.tenantId ?? null,
      });
    }

    // Run core handler
    await coreChatSend(opts);

    // Broadcast to members
    if (masAuth.userId && sessionKey && message) {
      opts.context.broadcast("chat", { ... });
    }
  };
}
```

### 2.3 Message Capture: SessionTranscriptUpdate Event

```
Core chat.send handler emits SessionTranscriptUpdate event
    ↓
Event: onSessionTranscriptUpdate
    ├─ Payload: {
    │    sessionKey: "agent:default:group:mas-9219ad00",
    │    message: {
    │      role: "user",
    │      content: "你好",
    │      timestamp: 1774401872064,
    │      sessionId: "8e1f65cf-34e5-4181-897d-352ff5618412"
    │    }
    │  }
    └─ Triggered by: src/sessions/transcript-events.ts
    ↓
SessionTranscriptStore.handleUpdate() called
    ├─ Subscriber: registered in transcriptStore.start()
    ├─ Location: aiemas/src/session-history/session-transcript-store.ts
    └─ Timing: ~0-2 seconds after chat.send
```

**Location**: `aiemas/src/session-history/session-transcript-store.ts` (lines 157-165)

**Code**:

```typescript
start(): void {
  this.unsubscribe = onSessionTranscriptUpdate((update) =>
    this.handleUpdate(update)
  );
  this.flushTimer = setInterval(() => {
    this.flush();
  }, this.flushIntervalMs);
}
```

### 2.4 Message Processing: handleUpdate

```
handleUpdate(update: SessionTranscriptUpdate)
    ↓
Step 1: Extract message fields
    ├─ sessionKey: from update.sessionKey
    ├─ role: from message.role (normalize: user/assistant/tool/summary)
    ├─ content: from message.content (extract text from arrays)
    ├─ timestamp: from message.timestamp
    └─ sessionId: from message.sessionId
    ↓
Step 2: Look up sender context from senderMap
    ├─ Key: sessionKey
    ├─ Value: { userId, tenantId }
    ├─ Fallback: { userId: null, tenantId: null }
    └─ ✅ FIX: senderMap now populated by chat.send wrapper
    ↓
Step 3: Generate message record
    ├─ id: UUID
    ├─ sessionKey: from update
    ├─ sessionId: from message
    ├─ userId: from senderMap lookup ✅
    ├─ tenantId: from senderMap lookup ✅
    ├─ role: normalized
    ├─ content: extracted text
    ├─ timestamp: from message
    ├─ seq: incremented per sessionId
    └─ archivedDate: null (active message)
    ↓
Step 4: Buffer message
    ├─ Push to in-memory buffer
    ├─ Check: buffer.length >= maxBufferSize (default 100)
    └─ If yes: trigger immediate flush()
```

**Location**: `aiemas/src/session-history/session-transcript-store.ts` (lines 197-256)

**Code**:

```typescript
private handleUpdate(update: SessionTranscriptUpdate): void {
  try {
    if (update.message == null) return;

    const msg = update.message as Record<string, unknown>;
    const content = extractContent(msg["content"]);
    const timestamp = typeof msg["timestamp"] === "number"
      ? msg["timestamp"]
      : Date.now();
    const sessionId = typeof msg["sessionId"] === "string"
      ? msg["sessionId"]
      : (update.sessionKey ?? "");
    const sessionKey = update.sessionKey ?? "";

    if (!sessionKey) return;

    const role = normaliseRole(msg["role"]);

    // ✅ Look up sender context from senderMap
    const sender = this.senderMap.get(sessionKey) ?? {
      userId: null,
      tenantId: null
    };

    // Accumulate seq per sessionId
    const prevSeq = this.seqMap.get(sessionId) ?? 0;
    const seq = prevSeq + 1;
    this.seqMap.set(sessionId, seq);

    const stored: StoredMessage = {
      id: crypto.randomUUID(),
      sessionKey,
      sessionId,
      userId: sender.userId,        // ✅ From senderMap
      tenantId: sender.tenantId,    // ✅ From senderMap
      role,
      content,
      timestamp,
      seq,
      archivedDate: null,
    };

    this.buffer.push(stored);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  } catch (err) {
    console.error("[mas4s:transcript-store] handleUpdate error:", err);
  }
}
```

### 2.5 Batch Persistence: flush() & persistBatch()

```
Periodic flush (every 500ms by default) OR buffer full
    ↓
flush()
    ├─ Drain buffer: splice(0, buffer.length)
    ├─ Call: persistBatch(msgs)
    └─ Clear buffer
    ↓
persistBatch(msgs)
    ├─ Group messages by sessionKey
    ├─ For each sessionKey group:
    │  ├─ Check archive date (daily boundary)
    │  ├─ If day changed: UPDATE old messages with archivedDate
    │  └─ Log archive event
    ├─ Single SQLite transaction:
    │  ├─ BEGIN
    │  ├─ UPDATE archived messages (if needed)
    │  ├─ INSERT all new messages
    │  └─ COMMIT
    └─ On error: ROLLBACK
```

**Location**: `aiemas/src/session-history/session-transcript-store.ts` (lines 258-342)

**Code**:

```typescript
private persistBatch(msgs: StoredMessage[]): void {
  const byKey = new Map<string, StoredMessage[]>();
  for (const m of msgs) {
    let group = byKey.get(m.sessionKey);
    if (!group) {
      group = [];
      byKey.set(m.sessionKey, group);
    }
    group.push(m);
  }

  const insertStmt = this.db.prepare(
    `INSERT INTO session_messages
       (id, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  this.db.exec("BEGIN");
  try {
    for (const [sessionKey, group] of byKey) {
      const minTs = group.reduce(
        (min, m) => (m.timestamp < min ? m.timestamp : min),
        group[0].timestamp,
      );
      const newMsgDate = toDateStr(minTs);
      const archiveDate = this.checkArchiveDate(sessionKey, newMsgDate);

      if (archiveDate !== null) {
        const updateStmt = this.db.prepare(
          `UPDATE session_messages
             SET archivedDate = ?
           WHERE sessionKey = ? AND archivedDate IS NULL`
        );
        const result = updateStmt.run(archiveDate, sessionKey) as { changes: number };
        console.info(
          `[mas4s:transcript-store] archived sessionKey=${sessionKey} date=${archiveDate} rows=${result.changes}`,
        );
      }
    }

    for (const m of msgs) {
      insertStmt.run(
        m.id,
        m.sessionKey,
        m.sessionId,
        m.userId,           // ✅ Persisted to DB
        m.tenantId,         // ✅ Persisted to DB
        m.role,
        m.content,
        m.timestamp,
        m.seq,
        m.archivedDate,
      );
    }

    this.db.exec("COMMIT");
  } catch (err) {
    this.db.exec("ROLLBACK");
    throw err;
  }
}
```

### 2.6 Database Schema

```sql
CREATE TABLE session_messages (
  id TEXT PRIMARY KEY,
  sessionKey TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  userId TEXT,                    -- ✅ From masToken JWT
  tenantId TEXT,                  -- ✅ From masToken JWT
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool', 'summary')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  archivedDate TEXT,              -- yyyy-mm-dd format, NULL = active

  UNIQUE(sessionId, seq)
);

CREATE INDEX idx_session_messages_key_ts
  ON session_messages(sessionKey, timestamp);
CREATE INDEX idx_session_messages_session_id
  ON session_messages(sessionId);
```

**Location**: `aiemas/src/store/database.ts` → `ensureMas4sSchema()`

---

## 3. Complete Message Flow Timeline

```
T+0ms:   User sends message via WebSocket
         └─ chat.send RPC called with { sessionKey, message, ... }

T+0ms:   mas4s wrapper intercepts
         ├─ Extract masAuth from client (userId, tenantId from masToken)
         ├─ Call recordSenderContext(sessionKey, { userId, tenantId })
         │  └─ senderMap.set(sessionKey, { userId, tenantId })
         └─ Call core chat.send handler

T+0ms:   Core handler processes message
         ├─ Validate & sanitize
         ├─ Persist to gateway JSONL
         ├─ Trigger agent run
         └─ Emit SessionTranscriptUpdate event

T+0-2s:  SessionTranscriptUpdate event fires
         └─ handleUpdate() called

T+0-2s:  handleUpdate processes message
         ├─ Extract message fields
         ├─ Look up senderMap[sessionKey] → { userId, tenantId }
         ├─ Create StoredMessage with userId/tenantId
         └─ Push to buffer

T+500ms: Periodic flush (or buffer full)
         ├─ Drain buffer
         ├─ Check archive dates
         └─ INSERT all messages to SQLite with userId/tenantId

T+500ms: Message persisted to database
         └─ SELECT * FROM session_messages WHERE id = ?
            ├─ userId: "user-123" ✅
            ├─ tenantId: "tenant-456" ✅
            └─ ... other fields
```

---

## 4. Key Fix: senderMap Population

### Before Fix (Bug)

```
chat.send wrapper
    ├─ Extract masAuth ✅
    ├─ Call core handler ✅
    └─ Broadcast ✅

    ❌ recordSenderContext NOT called

handleUpdate (2 seconds later)
    ├─ Look up senderMap[sessionKey]
    ├─ senderMap is EMPTY
    └─ userId = null, tenantId = null ❌
```

### After Fix (Correct)

```
chat.send wrapper
    ├─ Extract masAuth ✅
    ├─ Call recordSenderContext(sessionKey, { userId, tenantId }) ✅
    │  └─ senderMap.set(sessionKey, { userId, tenantId })
    ├─ Call core handler ✅
    └─ Broadcast ✅

handleUpdate (2 seconds later)
    ├─ Look up senderMap[sessionKey]
    ├─ senderMap HAS entry ✅
    └─ userId = "user-123", tenantId = "tenant-456" ✅
```

---

## 5. Error Handling & Fallbacks

### Null masAuth (Unauthenticated)

```
If masToken missing or invalid:
    ├─ masAuth = NULL_MAS_AUTH
    ├─ userId = null
    ├─ tenantId = null
    └─ Message still captured (compatibility mode)
```

### Empty sessionKey

```
If sessionKey is empty string:
    ├─ recordSenderContext skipped
    ├─ handleUpdate returns early
    └─ Message not captured
```

### senderMap Lookup Miss

```
If sessionKey not in senderMap:
    ├─ Fallback: { userId: null, tenantId: null }
    ├─ Message still captured
    └─ userId/tenantId fields are NULL in DB
```

---

## 6. Related Code Locations

| Component             | File                                                     | Purpose                         |
| --------------------- | -------------------------------------------------------- | ------------------------------- |
| masToken Verification | `aiemas/src/gateway-bridge/context.js`                   | JWT verification & extraction   |
| masAuth Attachment    | `src/gateway/mas4s-integration.ts`                       | Attach auth to client object    |
| chat.send Wrapper     | `src/gateway/mas4s-integration.ts` (lines 715-760)       | Record sender context           |
| Message Capture       | `aiemas/src/session-history/session-transcript-store.ts` | Buffer & persist messages       |
| Database Schema       | `aiemas/src/store/database.ts`                           | session_messages table          |
| Event Subscription    | `src/sessions/transcript-events.ts`                      | SessionTranscriptUpdate event   |
| Query API             | `aiemas/src/session-history/session-history-query.ts`    | Retrieve messages by time range |

---

## 7. Testing

**Test File**: `aiemas/src/session-history/session-history.test.ts`

**Key Test**: `recordSenderContext: userId and tenantId are associated with sessionKey and used in handleUpdate`

```typescript
it("recordSenderContext: userId and tenantId are associated with sessionKey and used in handleUpdate", () => {
  // Record sender context for a session
  store.recordSenderContext("sk-sender", {
    userId: "user-123",
    tenantId: "tenant-456",
  });

  const handleUpdate = (
    store as unknown as { handleUpdate: (u: unknown) => void }
  ).handleUpdate.bind(store);

  // Trigger handleUpdate with a message for that sessionKey
  handleUpdate({
    sessionKey: "sk-sender",
    message: { role: "user", content: "hello", sessionId: "sid-sender", timestamp: 1000 },
  });

  // Flush to persist
  (store as unknown as { flush: () => void }).flush();

  // Verify the message was persisted with the correct userId and tenantId
  const row = db
    .prepare("SELECT userId, tenantId FROM session_messages WHERE sessionKey = ?")
    .get("sk-sender") as { userId: string | null; tenantId: string | null } | undefined;

  expect(row).toBeDefined();
  expect(row!.userId).toBe("user-123");
  expect(row!.tenantId).toBe("tenant-456");
});
```

**Run Tests**:

```bash
pnpm test -- aiemas/src/session-history/session-history.test.ts
```

All 19 tests pass ✅
