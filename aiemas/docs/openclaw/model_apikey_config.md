# openclaw configure --section models 的 apiKey 配置实现方案

## 概述

`openclaw configure --section models` 命令用于配置 LLM 模型提供商。apiKey 的存储采用**双文件分离**设计：真实密钥存入 `auth-profiles.json`，`openclaw.json` 只保存引用指针。

---

## 完整调用链

```
openclaw configure --section models
  └─ configureCommandFromSectionsArg()          [src/commands/configure.commands.ts]
       └─ runConfigureWizard({ sections: ["model"] })
            └─ promptAuthConfig()               [src/commands/configure.gateway-auth.ts]
                 └─ applyAuthChoice("vllm-custom")
                      └─ ensureApiKeyFromOptionEnvOrPrompt()
                           └─ setVllmApiKey(apiKey, agentDir)
                                └─ upsertAuthProfile({
                                     profileId: "vllm:default",
                                     credential: buildApiKeyCredential("vllm", key)
                                   })           [src/agents/auth-profiles/profiles.ts]
                                        └─ saveAuthProfileStore()
```

---

## apiKey 存储位置

### 1. auth-profiles.json（真实密钥）

路径：`~/.openclaw/agents/default/agent/auth-profiles.json`

```json
{
  "version": 1,
  "profiles": {
    "vllm:default": {
      "type": "api_key",
      "provider": "vllm",
      "key": "sk-CtnMctv3u7hGpFaTN88ltg"
    },
    "ollama:default": {
      "type": "api_key",
      "provider": "ollama",
      "key": "ollama-local"
    }
  },
  "usageStats": {
    "vllm:default": {
      "errorCount": 0,
      "lastUsed": 1774280660298
    }
  }
}
```

- `key` 字段存储明文 apiKey（默认 `secretInputMode = "inline"`）
- 若配置了 `keyRef`（SecretRef 引用），则只保存引用，不落盘明文

### 2. openclaw.json（引用指针 + 模型配置）

路径：`~/.openclaw/openclaw.json`

```json
{
  "auth": {
    "profiles": {
      "vllm:default": {
        "provider": "vllm",
        "mode": "api_key"
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "vllm": {
        "baseUrl": "http://122.224.78.210:18180/v1",
        "apiKey": "none",
        "api": "openai-completions",
        "models": [
          {
            "id": "Qwen3.5-122B-A10B",
            "name": "Qwen3.5-122B-A10B",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 128000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

- `auth.profiles["vllm:default"]` 是指向 auth-profiles.json 的指针
- `models.providers.vllm.apiKey` 为占位符 `"none"`，不含真实密钥
- 自托管服务（vLLM、Ollama 等）通常不需要真实鉴权，`"none"` 即可

---

## saveAuthProfileStore 的写入逻辑

```typescript
// src/agents/auth-profiles/store.ts
export function saveAuthProfileStore(store: AuthProfileStore, agentDir?: string): void {
  const profiles = Object.fromEntries(
    Object.entries(store.profiles).map(([profileId, credential]) => {
      // 若同时有 keyRef（引用）和 key（明文），只保存引用，删除明文
      if (credential.type === "api_key" && credential.keyRef && credential.key !== undefined) {
        const sanitized = { ...credential };
        delete sanitized.key;
        return [profileId, sanitized];
      }
      return [profileId, credential];
    }),
  );
  saveJsonFile(authPath, { version, profiles, ... });
}
```

---

## chat.send 的 apiKey 解析优先级

`resolveApiKeyForProvider("vllm", cfg)` 按以下顺序查找，命中即返回：

| 优先级 | 来源                         | 实现                                                  |
| ------ | ---------------------------- | ----------------------------------------------------- |
| 1      | 显式 profileId 指定          | `resolveApiKeyForProfile(profileId, store)`           |
| 2      | auth profile 顺序列表        | 遍历 `resolveAuthProfileOrder()` 结果                 |
| 3      | 环境变量                     | `resolveEnvApiKey("vllm")` → 查 `VLLM_API_KEY`        |
| 4      | models.providers.vllm.apiKey | `resolveUsableCustomProviderApiKey()`                 |
| 5      | 合成本地鉴权                 | `resolveSyntheticLocalProviderAuth()`（仅 localhost） |

正常情况下优先级 1/2 命中 `auth-profiles.json` 中的真实 key，后续步骤不执行。

---

## mas4s 摘要生成的 apiKey 解析（resolveLlmKey）

`mas4s-integration.ts` 中的 `resolveLlmKey` 独立于 chat.send 链路，解析顺序如下：

```
1. resolveSecretInputString()     处理 ${VAR} 格式的 secret 引用
2. 准备 mergedEnv                 process.env + config.env.vars
3. auth profile store（新增）     读 auth-profiles.json → profiles[provider:default].key
4. resolveEnvApiKey()             查 process.env.VLLM_API_KEY 等候选变量
5. 纯字符串占位符处理             isValidEnvSecretRefId() 判断
   └─ 自托管兜底                  vllm/ollama/sglang/litellm/lmstudio → 返回 "none"
```

步骤 3 是关键修复点：原实现完全绕过了 auth profile 系统，导致真实 key 无法被读取。

---

## apiKey 格式说明

`models.providers[provider].apiKey` 支持以下格式：

| 格式         | 示例                                    | 处理方式                                          |
| ------------ | --------------------------------------- | ------------------------------------------------- |
| 真实密钥     | `"sk-abc123"`                           | 直接使用                                          |
| 占位符       | `"none"`                                | 直接使用（自托管服务）                            |
| 环境变量名   | `"VLLM_API_KEY"`                        | `isKnownEnvApiKeyMarker()` 识别后查 `process.env` |
| 环境变量引用 | `"${VLLM_API_KEY}"`                     | `resolveSecretInputString()` 展开                 |
| SecretRef    | `{ source: "env", id: "VLLM_API_KEY" }` | 通过 SecretRef 解析链处理                         |

**推荐**：自托管服务（vLLM、Ollama）将 `apiKey` 设为 `"none"`，真实鉴权信息通过 `openclaw configure --section models` 写入 `auth-profiles.json`。

---

## 相关文件索引

| 文件                                     | 职责                                          |
| ---------------------------------------- | --------------------------------------------- |
| `src/commands/configure.commands.ts`     | CLI 入口，解析 `--section` 参数               |
| `src/commands/configure.wizard.ts`       | wizard 主流程，分发各 section                 |
| `src/commands/configure.gateway-auth.ts` | model section 的认证配置交互                  |
| `src/commands/auth-choice.apply.ts`      | 应用用户选择的认证方式                        |
| `src/plugins/provider-auth-storage.ts`   | `setVllmApiKey` 等各 provider 存储函数        |
| `src/agents/auth-profiles/profiles.ts`   | `upsertAuthProfile` 写入 auth profile         |
| `src/agents/auth-profiles/store.ts`      | `saveAuthProfileStore` 文件写入               |
| `src/agents/auth-profiles/oauth.ts`      | `resolveApiKeyForProfile` 读取                |
| `src/agents/model-auth.ts`               | `resolveApiKeyForProvider` 完整解析链         |
| `src/agents/model-auth-markers.ts`       | 特殊标记定义（`CUSTOM_LOCAL_AUTH_MARKER` 等） |
| `src/gateway/mas4s-integration.ts`       | mas4s 摘要的 `resolveLlmKey`                  |
