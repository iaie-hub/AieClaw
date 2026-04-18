# 实现方案：Agent CRUD、导入与导出

## 概览

在智能体页面（agents-view）新增创建、删除、导出、导入四大功能，实现智能体完整生命周期管理。所有后端逻辑闭环在 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 中，前端 RPC 封装统一在 `agents-api.ts`。

---

## 一、后端改动

### 文件：`aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`

在 `extraHandlers` 对象末尾（`session.agent.update` 之后）新增 6 个 RPC 处理器，均为 async 函数，复用文件内已有的 `str()`、`errorShape()`、`db` 等工具。

#### `aiemas.agents.preDelete`

- 权限：`admin | member`（在 `GLOBAL_ROLE_PERMISSIONS` 中显式注册）
- 参数：`agentId: string`
- 查询 `session_labels` 表：`SELECT COUNT(*) AS count FROM session_labels WHERE currentAgentId = ?`
- count === 0 → 返回 `{ ok: true }`
- count > 0 → 返回 `AGENT_IN_USE` 错误，消息含关联会话数量
- agentId 缺失 → 返回 `INVALID_PARAMS`

#### `aiemas.fs.list`

- 权限：`admin | member | viewer`（在 `GLOBAL_ROLE_PERMISSIONS` 中显式注册）
- 参数：`dirPath: string`
- 使用 `node:fs/promises` `readdir({ withFileTypes: true })` 列出直接子项
- 每个条目返回 `{ name, type: "file"|"directory", size }`（目录 size 为 0）
- dirPath 缺失 → `INVALID_PARAMS`；目录不存在（ENOENT）→ `NOT_FOUND`

#### `aiemas.agents.export`

- 权限：`admin | member`（在 `GLOBAL_ROLE_PERMISSIONS` 中显式注册）
- 参数：`agentId: string`、`workspace: string`、`items: string[]`
- 在 `path.dirname(workspace)` 下创建 `{agentId}-export` 临时目录
- 将 `items` 中的文件/目录从 workspace 复制到临时目录（`fs/promises` cp，recursive）
- 压缩前先检查 `{agentId}-export.zip` 是否已存在，若存在则用 `fs/promises rm({ force: true })` 删除，确保每次导出都是全量新建而非追加更新
- 使用系统 `zip` 命令（`child_process.execFile` + `promisify`）将临时目录压缩为 `{agentId}-export.zip`
- 压缩完成后删除临时目录（finally 块保证清理）
- 返回 `{ archivePath }`
- 参数缺失 → `INVALID_PARAMS`；workspace 不存在 → `NOT_FOUND`

#### `aiemas.files.download`

- 权限：`admin | member`（在 `GLOBAL_ROLE_PERMISSIONS` 中显式注册）
- 参数：`filePath: string`
- 读取文件内容，base64 编码后返回 `{ data, fileName, mimeType: "application/octet-stream" }`
- `fileName` 取自 `path.basename(filePath)`，保留原始扩展名（例如 `{agentId}-export.zip`）
- filePath 缺失 → `INVALID_PARAMS`；文件不存在 → `NOT_FOUND`

#### `aiemas.file.upload`

- 权限：`admin | member`（在 `GLOBAL_ROLE_PERMISSIONS` 中显式注册）
- 参数：`fileName: string`、`data: string`（base64）
- 生成随机 ID，写入 `os.tmpdir()/aiemas-upload-{randomId}/{fileName}`
- 返回 `{ filePath }`
- 参数缺失 → `INVALID_PARAMS`

#### `aiemas.agents.import`

- 权限：`admin` only（等同于 `agents.create`，在 `GLOBAL_ROLE_PERMISSIONS` 中显式注册）
- 参数：`archivePath: string`
- 验证文件存在后，通过 `plugin.gatewayDispatch("agents.create", { name }, client)` 创建新智能体
- 使用 `unzip -o` 将压缩包解压到新智能体的 workspace 目录
- 解压完成后删除临时压缩包
- 返回与 `agents.create` 相同格式的智能体信息
- archivePath 缺失/不存在 → `INVALID_PARAMS`；解压失败 → `EXTRACT_FAILED`；agents.create 失败 → 透传错误

---

## 二、前端类型改动

### 文件：`aiemas/ui/mas4s/src/types/agents-types.ts`

末尾新增 5 个接口：

| 接口名                 | 用途                                                     |
| ---------------------- | -------------------------------------------------------- |
| `WorkspaceEntry`       | `aiemas.fs.list` 响应中的单个条目（name、type、size）    |
| `WorkspaceListPayload` | `aiemas.fs.list` 响应（entries 数组）                    |
| `AgentExportPayload`   | `aiemas.agents.export` 响应（archivePath）               |
| `FileDownloadPayload`  | `aiemas.files.download` 响应（data、fileName、mimeType） |
| `FileUploadPayload`    | `aiemas.file.upload` 响应（filePath）                    |

---

## 三、前端 API 改动

### 文件：`aiemas/ui/mas4s/src/gateway/agents-api.ts`

imports 中新增 `AgentEntry`、`WorkspaceListPayload`、`AgentExportPayload`、`FileDownloadPayload`、`FileUploadPayload` 类型引用。

末尾新增 8 个导出函数：

| 函数名               | 调用方法                  | 参数                      |
| -------------------- | ------------------------- | ------------------------- |
| `createAgent`        | `agents.create`           | name, workspace           |
| `deleteAgent`        | `agents.delete`           | agentId                   |
| `preDeleteAgent`     | `aiemas.agents.preDelete` | agentId                   |
| `listWorkspaceFiles` | `aiemas.fs.list`          | dirPath                   |
| `exportAgent`        | `aiemas.agents.export`    | agentId, workspace, items |
| `downloadFile`       | `aiemas.files.download`   | filePath                  |
| `uploadFile`         | `aiemas.file.upload`      | fileName, data            |
| `importAgent`        | `aiemas.agents.import`    | archivePath               |

---

## 四、新增 UI 组件

所有新增对话框组件位于 `aiemas/ui/mas4s/src/components/agent/` 目录，文件名和自定义元素名均带 `agent-` 前缀，以便未来 `skill/` 目录扩展时避免命名冲突。

### `agent/agent-create-dialog.ts`

- 自定义元素：`agent-create-dialog`
- 两个必填输入：名称（`_name`）、工作区目录（`_workspace`）
- 任一为空时禁用确认按钮
- 确认触发 `confirm` 事件，detail：`{ name, workspace }`
- 取消触发 `cancel` 事件；点击遮罩层同等于取消

### `agent/agent-export-dialog.ts`

- 自定义元素：`agent-export-dialog`
- 属性：`entries: WorkspaceEntry[]`（文件列表）、`agentName: string`（标题显示）
- 内部状态：`_selected: Set<string>`，`willUpdate` 时默认全选所有条目
- 复选框列表展示每个条目（图标区分文件/目录，显示文件大小）
- 全选 / 取消全选按钮
- 无选中项时禁用确认按钮
- 确认触发 `confirm` 事件，detail：`{ items: string[], fileName: string }`（`fileName` 由 `agentName` 生成，格式为 `{agentName}.zip`，确保带 `.zip` 后缀）

### `agent/agent-import-dialog.ts`

- 自定义元素：`agent-import-dialog`
- 隐藏的 `<input type="file" accept=".zip,.tar.gz,.tgz">`，通过点击 drop-zone 触发
- 选中文件后 drop-zone 变为绿色已选状态，显示文件名
- 未选文件时禁用确认按钮
- 确认触发 `confirm` 事件，detail：`{ file: File }`

---

## 五、改动现有组件

### `aiemas/ui/mas4s/src/components/agent-card.ts`

新增样式：

- `.card-footer`：flex 右对齐容器，`border-top` 分隔线
- `.icon-btn`：30×30 图标按钮基础样式
- `.icon-btn.danger:hover`：红色悬停效果

新增方法：

- `_onDelete(e)`：`e.stopPropagation()` + 触发 `agent-delete` 事件，detail：`{ agent }`
- `_onExport(e)`：`e.stopPropagation()` + 触发 `agent-export` 事件，detail：`{ agent }`

render 末尾新增 `.card-footer`，包含导出（📤）和删除（🗑️）两个 `.icon-btn`。

---

## 六、改动视图

### `aiemas/ui/mas4s/src/views/agents-view.ts`

**imports 新增：**

- 8 个 API 函数（createAgent、deleteAgent、preDeleteAgent、listWorkspaceFiles、exportAgent、downloadFile、uploadFile、importAgent）
- 类型 `WorkspaceEntry`
- 3 个新对话框组件的 side-effect import

**新增状态字段：**

- `_dialog: DialogState`：判别联合类型，kind 为 `none | create | delete | export | import`
- `_toastMsg: string`、`_toastError: boolean`：toast 通知
- `_toastTimer`：toast 自动清除定时器

**新增方法：**

| 方法                       | 触发时机               | 行为                                                                                                                  |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `_showToast(msg, isError)` | 内部调用               | 设置 toast，3 秒后自动清除                                                                                            |
| `_onCreateConfirm(e)`      | create-dialog confirm  | 调 createAgent，成功刷新列表，失败 toast                                                                              |
| `_onDeleteEvent(e)`        | agent-delete 事件      | 设置 dialog 为 delete 状态                                                                                            |
| `_onDeleteConfirm()`       | confirm-dialog confirm | 调 preDeleteAgent → deleteAgent，成功刷新，失败 toast                                                                 |
| `_onExportEvent(e)`        | agent-export 事件      | 调 listWorkspaceFiles，成功后设置 dialog 为 export 状态                                                               |
| `_onExportConfirm(e)`      | export-dialog confirm  | 调 exportAgent → downloadFile，解码 base64 触发浏览器下载；下载文件名取自响应的 `fileName`，若不含扩展名则追加 `.zip` |
| `_onImportConfirm(e)`      | import-dialog confirm  | FileReader 读取为 base64，调 uploadFile → importAgent，成功刷新                                                       |

**render 改动：**

- `.header-area` 改为 flex 布局，右侧新增 `.header-actions` 区域，包含"导入"（btn-secondary）和"+ 创建"（btn-primary）按钮
- `agent-card` 新增监听 `@agent-delete` 和 `@agent-export` 事件
- 末尾渲染 `_renderDialogs()` 和 toast 元素

**`_renderDialogs()` 方法：**

- `kind === "create"` → `<agent-create-dialog>`
- `kind === "delete"` → `<confirm-dialog confirmVariant="danger">`
- `kind === "export"` → `<agent-export-dialog .entries .agentName>`
- `kind === "import"` → `<agent-import-dialog>`

---

## 七、文档改动

### `aiemas/docs/openclaw/websocket_api.md`

**表格 4（Agent 与插件管理）** 新增 5 行：

| 方法                      | 说明                         |
| ------------------------- | ---------------------------- |
| `aiemas.agents.preDelete` | 删除前检查关联会话           |
| `aiemas.agents.export`    | 导出 Agent 工作区为 zip      |
| `aiemas.agents.import`    | 导入 Agent 压缩包            |
| `aiemas.files.download`   | 下载服务端文件（base64）     |
| `aiemas.file.upload`      | 上传文件到临时目录（base64） |

**表格 5（系统、配置与治理）** 新增 1 行：

| 方法             | 说明             |
| ---------------- | ---------------- |
| `aiemas.fs.list` | 列出目录直接子项 |

**第三节** 新增 6 个方法的 JSON 请求/响应示例（3–8）。

---

## 八、文件变更汇总

| 状态 | 文件路径                                                      |
| ---- | ------------------------------------------------------------- |
| 修改 | `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`           |
| 修改 | `aiemas/ui/mas4s/src/types/agents-types.ts`                   |
| 修改 | `aiemas/ui/mas4s/src/gateway/agents-api.ts`                   |
| 修改 | `aiemas/ui/mas4s/src/components/agent-card.ts`                |
| 修改 | `aiemas/ui/mas4s/src/views/agents-view.ts`                    |
| 修改 | `aiemas/docs/openclaw/websocket_api.md`                       |
| 新增 | `aiemas/ui/mas4s/src/components/agent/agent-create-dialog.ts` |
| 新增 | `aiemas/ui/mas4s/src/components/agent/agent-export-dialog.ts` |
| 新增 | `aiemas/ui/mas4s/src/components/agent/agent-import-dialog.ts` |
