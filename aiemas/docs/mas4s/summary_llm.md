# Session Summary LLM Configuration

The `aiemas` module uses an LLM to generate concise summaries for multi-agent collaboration sessions. This feature requires an OpenAI-compatible LLM endpoint.

## Configuration Hierarchy

The system looks for LLM configuration in the following order of priority:

### 1. Plugin Specific Configuration

You can configure the LLM specifically for the `aiemas` (or `mas4s`) plugin in your `openclaw.json` file. This is the recommended way if you want to use a model or provider dedicated to summarization.

```json
{
  "plugins": {
    "entries": {
      "aiemas": {
        "config": {
          "llm": {
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "sk-...",
            "model": "gpt-4o-mini"
          }
        }
      }
    }
  }
}
```

### 2. Global Model Provider Fallback

If the plugin-specific configuration is missing, the system automatically attempts to reuse a suitable provider from the global `models.providers` section in `openclaw.json`.

It searches for providers named `openai`, `deepseek`, or any provider where the `api` type starts with `openai-`. It will use the `baseUrl`, `apiKey` (if provided as a direct string), and the first available model from that provider.

```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-...",
        "models": [{ "id": "gpt-4o-mini" }]
      }
    }
  }
}
```

### 3. Environment Variables

As a final fallback, the system checks for the following environment variables:

- `MAS4S_LLM_BASE_URL` – e.g., `https://api.openai.com/v1`
- `MAS4S_LLM_API_KEY` – Your API key
- `MAS4S_LLM_MODEL` – e.g., `gpt-4o-mini`

## Technical Details

- **API Compatibility**: The LLM endpoint must support the standard OpenAI Chat Completions API (`/chat/completions`).
- **Permissions**: Summary generation requires the caller to have the appropriate RBAC permissions (typically `admin`, `owner`, or `participant` roles).
- **Auto-Archive Summary**: A summary is automatically generated when a session is archived.
