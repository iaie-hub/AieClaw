部署 **aiemas/ui/mas4s** 和 **gateway** 主要分为构建（Build）和运行（Runtime）两个阶段。以下是详细的操作步骤：

### 1. 前置准备

确保你的环境中已安装 **Node.js (>= 22)** 和 **pnpm**。

---

### 2. 构建阶段

#### A. 构建 Gateway (OpenClaw Core)

在项目根目录下执行以下命令：

```bash
# 安装依赖
pnpm install

# 执行全局构建（会产出 dist/ 目录）
pnpm run build
```

- **产出物**：根目录下的 `dist/` 文件夹以及 `openclaw.mjs` 入口文件。

#### B. 构建 MAS4S UI

进入 UI 模块目录进行构建：

```bash
cd aiemas/ui/mas4s

# 安装 UI 依赖
pnpm install

# 执行构建
pnpm run build
```

- **产出物**：`aiemas/ui/mas4s/dist/` 文件夹。

---

### 3. 配置与部署阶段

你可以选择让 Gateway 直接托管（Host）MAS4S 的前端静态资源，这样只需启动一个进程即可。

#### A. 修改配置文件 (`openclaw.json`)

在你的 OpenClaw 配置文件（默认通常在 `~/.openclaw/openclaw.json` 或项目指定的路径）中，添加或修改 `gateway.controlUi` 配置：

```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "controlUi": {
      "enabled": true,
      "root": "/你的绝对路径/AieClaw/aiemas/ui/mas4s/dist",
      "basePath": "/"
    }
  }
}
```

#### B. 启动 Gateway

在根目录下运行：

```bash
# 使用 node 启动
node openclaw.mjs gateway

# 或者如果你已经全局安装/链接了 openclaw
openclaw gateway
```

---

### 4. 生产环境持久化 (可选)

如果你在服务器上部署，可以使用 OpenClaw 自带的服务安装命令：

```bash
# 安装为系统服务 (支持 macOS launchd, Linux systemd, Windows SchTasks)
openclaw gateway install

# 启动服务
openclaw gateway start

# 查看状态
openclaw gateway status
```

### 总结

1.  **Gateway 构建**：根目录 `pnpm run build`。
2.  **UI 构建**：`aiemas/ui/mas4s` 目录下 `pnpm run build`。
3.  **打通部署**：在 Gateway 配置中通过 `gateway.controlUi.root` 指向 UI 的 `dist` 目录。
4.  **访问**：浏览器访问 `http://localhost:18789` 即可看到 MAS4S 界面。

**注意**：MAS4S 运行时需要连接 Gateway 的 WebSocket。默认情况下，它会尝试连接当前访问的 Host 地址。如果你的 Gateway 开启了权限，需要配置 `OPENCLAW_GATEWAY_TOKEN` 环境变量。
