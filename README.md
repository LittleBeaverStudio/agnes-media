# agnes-media

A [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) plugin that registers
two host tools for the Agnes AI media models, so the agent can generate images
and videos during a conversation.

| Tool | Model | Endpoint | Notes |
|------|-------|----------|-------|
| `generate_image` | `agnes-image-2.1-flash` | `POST /v1/images/generations` | Returns public image URL(s) |
| `generate_video` | `agnes-video-v2.0` | `POST /v1/videos + GET polling` | Async, polls until ready (~3 min) |

## Why this exists

The Agnes image and video models are served on dedicated endpoints, not the
standard chat-completions route. DSH's agent loop only routes through
`/v1/chat/completions`, so addressing these models directly as chat models
returns a 400:

> Model agnes-image-2.1-flash is an image model. Use /v1/images/generations.

This plugin registers them as **tools** instead, which makes the correct
endpoint calls on the agent's behalf.

## ⚠️ Getting Your API Key (Important!)

### Platform URL

| Region | URL |
|--------|-----|
| Mainland China | [platform.agnes-ai.cn](https://platform.agnes-ai.cn) |
| International | [platform.agnes-ai.com](https://platform.agnes-ai.com) |

Both sites use the **same API Key** — only the endpoint URL differs.

### Step-by-step

1. Log in to the platform that matches your region.
2. Go to **Settings → API Keys** (or **我的 → API 密钥** in Chinese UI).
3. Click **"Create New Key"** (创建新密钥).
4. **IMPORTANT**: The key is shown **ONCE ONLY** — copy it immediately!
5. The key format is `sk-xxxxxxxx...` (starts with `sk-`, ~50+ characters).

### Troubleshooting: "无效的令牌" (Invalid Token / 401)

If you get a `401` error saying the token is invalid:

| Check | Action |
|-------|--------|
| **Copied completely?** | Make sure the full `sk-...` string is pasted, no truncation |
| **Extra spaces/newlines?** | Trim whitespace — make sure no extra spaces at start or end |
| **Key deleted?** | Go to Settings → API Keys and check if the key still exists |
| **Wrong key?** | Create a new key and use it instead |
| **Regional mismatch?** | `.cn` keys work on `.cn` endpoints, `.com` keys work on `.com` endpoints |

### Test your key manually

```bash
# 用 curl 直接测试，排除插件配置问题
curl -s https://apihub.agnes-ai.cn/v1/models \
  -H "Authorization: Bearer YOUR_KEY_HERE" | head -c 500
```

If this returns model data, your key is valid and the problem is elsewhere.
If this returns `{"error":{"message":"无效的令牌"...}}`, regenerate the key.

---

## ⚠️ Important: API Key & Node Selection

### Getting your API Key

1. Register at **[Agnes AI platform](https://platform.agnes-ai.cn)** (domestic China node) or **[international node](https://platform.agnes-ai.com)**.
   - **Mainland China users**: use `.cn` platform — faster, no proxy needed.
   - **Overseas users**: use `.com` platform.
2. Create an API key in console settings → API Keys.
3. The same key works on both `.cn` and `.com` nodes.

### Choosing the right endpoint

By default, this plugin connects to the **international node** (`apihub.agnes-ai.com`).

| If you… | Do this |
|---------|---------|
| Are in mainland China | Set `AGNES_MEDIA_DOMAIN=cn` before starting DSH to use the domestic node (`apihub.agnes-ai.cn`) — much faster, no proxy needed |
| Need to override the base URL completely | Set `AGNES_MEDIA_BASE_URL=https://your-custom-endpoint/v1` |
| Want to keep international defaults | No extra config needed; just set your API key |

#### Windows PowerShell
```powershell
$env:AGNES_API_KEY = "sk-xxxxxxxx..."
$env:AGNES_MEDIA_DOMAIN = "cn"   # mainland users add this line
dsh web
```

#### macOS / Linux
```bash
export AGNES_API_KEY="sk-xxxxxxxx..."
export AGNES_MEDIA_DOMAIN=cn     # mainland users uncomment this line
dsh web
```

---

## Requirements

- DeepSeek Harness `0.1.0-rc.7` or later (uses the `cordis.patch.yml` bundle
  format).
- An Agnes AI API key (free), exposed via `AGNES_MEDIA_API_KEY` or `AGNES_API_KEY`.

## Installation

From a local checkout:

```bash
dsh plugin --profile web add github:LittleBeaverStudio/agnes-media
```

Then restart the DSH web server. `generate_image` and `generate_video` appear
in the agent's tool catalog automatically.

## Tools

### `generate_image`

Generate image(s) from a text prompt using `agnes-image-2.1-flash`.

**Parameters:**
- `prompt` (required): Detailed text description of the image.
- `size` (optional): Output dimensions as `"WxH"` (e.g. `"1920x1080"`) or `"{width,1920},{height,1080}"`. Default: `1024x1024`.
- `n` (optional): Number of images to generate. Default: `1`, max: `4`.

**Returns:** Public HTTPS URL(s) in an array. The tool renders the result as markdown images so the DSH web UI shows them inline.

### `generate_video`

Generate a short video from a text prompt using `agnes-video-v2.0`.

Asynchronous: submits a job, then polls the status endpoint every 3 seconds
until the video is ready (up to ~3 minutes).

**Parameters:**
- `prompt` (required): Detailed text description of the video. Include subject, action, scene, camera movement, lighting, and style.
- `duration` (optional): Target duration in seconds. Auto-converted to a valid `num_frames` at 24 fps. Default: `5`.
- `num_frames` (optional): Explicit frame count override. Must satisfy `8n + 1` and be ≤ 441. Valid values: 81, 121, 161, 201, 241, 281, 321, 361, 401, 441. If provided, `duration` is ignored.
- `size` (optional): Resolution as `"WxH"` (e.g. `"1280x720"`) or `"{width,W},{height,H}"`. Default: `1280x720`.
- `frame_rate` (optional): Frames per second. Range: 1–60. Default: `24`.
- `negative_prompt` (optional): Things to avoid in the output (e.g. `"blurry, shaky camera"`).
- `seed` (optional): Random seed for reproducible generation.

**Returns:** A direct video URL.

## Frame count validation

Agnes Video V2.0 requires `num_frames` to be in the set `{8n + 1 | n ≥ 1, 8n+1 ≤ 441}`:

```
81, 121, 161, 201, 241, 281, 321, 361, 401, 441
```

If you pass `duration` instead, the plugin computes the nearest valid frame
count automatically. If you pass `num_frames` directly, it is validated
before submission — an invalid value is rejected immediately with a clear
error message.

## Environment variables reference

| Variable | Description | Default |
|----------|-------------|---------|
| `AGNES_MEDIA_API_KEY` | Agnes API key (preferred) | _(must be set)_ |
| `AGNES_API_KEY` | Fallback API key | — |
| `AGNES_MEDIA_DOMAIN` | Node selector: `cn` for domestic, anything else for international | `com` |
| `AGNES_MEDIA_BASE_URL` | Full custom base URL (overrides domain). Must end in `/v1`. | _(auto from domain)_ |

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
- The plugin reads the key from the process environment at call time; it is
  never persisted or logged.

## License

[MIT](LICENSE)