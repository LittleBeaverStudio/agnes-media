# agnes-media

A [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) plugin that registers
two host tools for the Agnes AI media models, so the agent can generate images
and videos during a conversation.

| Tool | Model | Endpoint | Notes |
|------|-------|----------|-------|
| `generate_image` | `agnes-image-2.1-flash` | `POST /v1/images/generations` | Returns public image URL(s) |
| `generate_video` | `agnes-video-v2.0` | `POST /v1/videos` | Async — submits a job, polls until ready (up to ~3 min) |

## Why this exists

The Agnes image and video models are served on dedicated endpoints, not the
standard chat-completions route. DSH's agent loop only routes through
`/v1/chat/completions`, so addressing these models directly as chat models
returns a 400:

> Model agnes-image-2.1-flash is an image model. Use /v1/images/generations.

This plugin registers them as **tools** instead, which makes the correct
endpoint calls on the agent's behalf.

## Requirements

- DeepSeek Harness `0.1.0-rc.7` or later (uses the `cordis.patch.yml` bundle
  format; the legacy inline `dsh.bundle.patch` object format is no longer
  accepted by the loader).
- An Agnes AI API key for the international service (`platform.agnes-ai.com`),
  exposed as an environment variable before starting `dsh web`:
  - `AGNES_MEDIA_API_KEY` (recommended), or
  - `AGNES_API_KEY` as a fallback.

  The key is read from the process environment at call time. It is never
  hardcoded, logged, or persisted by this plugin.

## Installation

From a local checkout:

```bash
dsh plugin --profile web add file:/absolute/path/to/agnes-media
```

Then restart the DSH web server. `generate_image` and `generate_video` appear
in the agent's tool catalog automatically.

## How results show up in the chat

- **Images**: the tool returns public HTTPS URLs, and its result instructs the
  model to reply with markdown image syntax (`![description](url)`). The DSH
  web UI renders absolute HTTPS images inline, so generated pictures appear
  directly in the conversation — no client-side plugin needed.
- **Videos**: the tool returns a direct video URL. The markdown renderer has no
  video block, so the agent presents the link; the browser plays it in place
  when opened.

## Security notes

- Never commit API keys. This repository intentionally contains no secrets;
  `.gitignore` excludes local artifacts and environment files.
- The key only leaves your machine as a `Bearer` header to the Agnes AI API.

## License

[MIT](LICENSE)
