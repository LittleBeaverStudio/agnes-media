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

**Returns:** A direct video URL. The DSH web UI does not render `<video>` tags, so the agent presents the link to the user.

## Frame count validation

Agnes Video V2.0 requires `num_frames` to be in the set `{8n + 1 | n ≥ 1, 8n+1 ≤ 441}`:

```
81, 121, 161, 201, 241, 281, 321, 361, 401, 441
```

If you pass `duration` instead, the plugin computes the nearest valid frame
count automatically. If you pass `num_frames` directly, it is validated
before submission — an invalid value is rejected immediately with a clear
error message.

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