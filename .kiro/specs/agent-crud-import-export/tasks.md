# Implementation Plan: Agent CRUD, Import & Export

## Overview

Incrementally implement agent create, delete, export, and import functionality. Backend RPC handlers are added first to `extraHandlers` in `mas4s-gateway-plugin.ts`, then frontend types and API functions, then UI components (dialogs), then wiring in `agents-view.ts` and `agent-card.ts`, and finally WebSocket API docs.

## Tasks

- [x] 1. Add backend RPC handlers to extraHandlers
  - [x] 1.1 Implement `aiemas.agents.preDelete` handler
    - Query `session_labels` table: `SELECT COUNT(*) AS count FROM session_labels WHERE currentAgentId = ?`
    - Return `{ ok: true }` when count is 0; return `AGENT_IN_USE` error with count when > 0
    - Return `INVALID_PARAMS` error when `agentId` is missing or empty
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 1.2 Implement `aiemas.fs.list` handler
    - Use `node:fs/promises` `readdir` with `withFileTypes` to list direct children of `dirPath`
    - Return `{ entries: Array<{ name, type, size }> }` where type is `"file"` or `"directory"`, size is 0 for directories
    - Return `INVALID_PARAMS` when `dirPath` is missing/empty; `NOT_FOUND` when directory doesn't exist
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 1.3 Implement `aiemas.agents.export` handler
    - Accept `agentId`, `workspace`, `items` params
    - Create temp directory `{workspace}/../{agentId}-export`, copy selected items, zip with `archiver` or system `zip`, return `{ archivePath }`
    - Clean up temp directory after compression; return `INVALID_PARAMS` / `NOT_FOUND` on bad input
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x] 1.4 Implement `aiemas.files.download` handler
    - Read file at `filePath` with `node:fs/promises`, base64-encode content
    - Return `{ data, fileName, mimeType }`; return `INVALID_PARAMS` / `NOT_FOUND` on bad input
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 1.5 Implement `aiemas.file.upload` handler
    - Accept `fileName` and `data` (base64), write decoded content to `os.tmpdir()/aiemas-upload-{randomId}/{fileName}`
    - Return `{ filePath }`; return `INVALID_PARAMS` when params missing
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 1.6 Implement `aiemas.agents.import` handler
    - Accept `archivePath`, call `gatewayDispatch("agents.create", ...)` to create agent
    - Extract zip into new agent's workspace directory, clean up temp archive
    - Return agent info matching `agents.create` response format
    - Return `INVALID_PARAMS` when archivePath missing/file doesn't exist; `EXTRACT_FAILED` on unzip failure; pass through `agents.create` errors
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

- [x] 2. Checkpoint — Backend handlers
  - Ensure all backend handlers compile and are registered in `extraHandlers`. Ask the user if questions arise.

- [x] 3. Add frontend types and API functions
  - [x] 3.1 Add new types to `agents-types.ts`
    - Add `WorkspaceEntry`, `WorkspaceListPayload`, `AgentExportPayload`, `FileDownloadPayload`, `FileUploadPayload` interfaces
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 3.2 Add API functions to `agents-api.ts`
    - Implement `createAgent(client, name, workspace)` → `agents.create`
    - Implement `deleteAgent(client, agentId)` → `agents.delete`
    - Implement `preDeleteAgent(client, agentId)` → `aiemas.agents.preDelete`
    - Implement `listWorkspaceFiles(client, dirPath)` → `aiemas.fs.list`
    - Implement `exportAgent(client, agentId, workspace, items)` → `aiemas.agents.export`
    - Implement `downloadFile(client, filePath)` → `aiemas.files.download`
    - Implement `uploadFile(client, fileName, data)` → `aiemas.file.upload`
    - Implement `importAgent(client, archivePath)` → `aiemas.agents.import`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x] 4. Create UI dialog components
  - [x] 4.1 Create `create-dialog.ts` LitElement component
    - Render name (required) and workspace directory (required) input fields
    - Disable confirm button when name or workspace is empty
    - Dispatch `confirm` event with `{ name, workspace }` detail and `cancel` event
    - Follow existing `confirm-dialog.ts` styling patterns
    - _Requirements: 1.2, 1.3, 1.5, 1.6_

  - [x] 4.2 Create `export-dialog.ts` LitElement component
    - Accept `entries: WorkspaceEntry[]` and `agentName: string` properties
    - Render checkbox list for each file/directory entry, default all selected
    - Provide select-all / deselect-all toggle
    - Dispatch `confirm` event with `{ items: string[] }` detail and `cancel` event
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 3.12_

  - [x] 4.3 Create `import-dialog.ts` LitElement component
    - Provide file input restricted to `.zip,.tar.gz,.tgz`
    - Dispatch `confirm` event with `{ file: File }` detail and `cancel` event
    - _Requirements: 4.2, 4.3, 4.8_

- [x] 5. Modify `agent-card.ts` — add delete and export icon buttons
  - Add delete and export icon buttons in card footer (right-aligned)
  - Call `stopPropagation()` on button clicks to prevent `agent-select` event
  - Dispatch `agent-delete` custom event with `{ agent: AgentEntry }` detail
  - Dispatch `agent-export` custom event with `{ agent: AgentEntry }` detail
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

- [x] 6. Wire everything in `agents-view.ts`
  - [x] 6.1 Add create agent flow
    - Render create button in header area (right-aligned, next to import button)
    - Show `create-dialog` on click; on confirm call `createAgent` API then refresh list
    - Show error toast on failure; close dialog on cancel
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 6.2 Add delete agent flow
    - Listen for `agent-delete` event on agent cards
    - Show `confirm-dialog` with danger variant; on confirm call `preDeleteAgent` then `deleteAgent`
    - Show `AGENT_IN_USE` error message when preDelete fails; refresh list on success
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [x] 6.3 Add export agent flow
    - Listen for `agent-export` event on agent cards
    - Call `listWorkspaceFiles` to get entries, show `export-dialog`
    - On confirm call `exportAgent`, then `downloadFile`, decode base64 and trigger browser download
    - Show error on failure; close dialog on cancel
    - _Requirements: 3.4, 3.5, 3.9, 3.10, 3.11, 3.12_

  - [x] 6.4 Add import agent flow
    - Render import button in header area (right-aligned)
    - Show `import-dialog` on click; on confirm read file as base64, call `uploadFile` then `importAgent`
    - Refresh agent list on success; show error on failure; close dialog on cancel
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 7. Checkpoint — Full UI integration
  - Ensure all components compile and render correctly. Ensure all dialog flows work end-to-end. Ask the user if questions arise.

- [x] 8. Update WebSocket API documentation
  - Add `aiemas.agents.preDelete`, `aiemas.fs.list`, `aiemas.agents.export`, `aiemas.agents.import`, `aiemas.files.download`, `aiemas.file.upload` to method tables in `websocket_api.md`
  - Add JSON request/response examples for each new method in section 三
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [x] 9. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All backend handlers are registered in `extraHandlers` within `mas4s-gateway-plugin.ts` — no changes to `src/gateway/server-methods-list.ts` needed
- `aiemas.agents.import` uses `plugin.gatewayDispatch` to call the existing `agents.create` method
- `aiemas.agents.preDelete` is a read-only query against the existing `session_labels` table
- File transfer uses base64 encoding over WebSocket JSON-RPC (no HTTP endpoints added)
- UI components use Lit (LitElement) + TypeScript, following existing `confirm-dialog.ts` patterns
