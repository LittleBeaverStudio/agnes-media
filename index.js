/**
 * agnes-media — DeepSeek Harness (dsh) bundle plugin.
 *
 * Registers two host tools that route through the Agnes AI media endpoints
 * (the standard chat-completions route rejects these models with a 400):
 *
 *   - generate_image → POST /v1/images/generations  (agnes-image-2.1-flash)
 *   - generate_video → POST /v1/videos + polling     (agnes-video-v2.0)
 *
 * Auth: AGNES_MEDIA_API_KEY (international service, platform.agnes-ai.com),
 * falling back to AGNES_API_KEY. The key is read from the process
 * environment at call time — never hardcode it.
 *
 * This file is plain ESM loaded by the dsh Loader: it must not import any
 * package that is not already resolvable from the running dsh installation,
 * so it uses only the injected context (`ctx.tools`) plus Node builtins.
 */

export const name = 'agnes-media';
export const inject = ['tools'];

const BASE_URL = 'https://apihub.agnes-ai.com/v1';
const POLL_ENDPOINT = 'https://apihub.agnes-ai.com/agnesapi';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_COUNT = 60; // ~3 minutes of polling

function apiKey() {
  return process.env.AGNES_MEDIA_API_KEY || process.env.AGNES_API_KEY;
}

/** AbortSignal-aware sleep used by the video polling loop. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function assertSignal(exec) {
  if (exec.signal?.aborted) throw exec.signal.reason ?? new Error('aborted');
}

/**
 * The plugin apply hook, invoked by the Loader when the `agnes-media` entry
 * mounts. Registers both media tools into the host tool registry.
 * @param ctx - host context providing the `tools` registry.
 */
export function apply(ctx) {
  // ── generate_image ────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'generate_image',
    description:
      'Generate image(s) from a text prompt using the agnes-image-2.1-flash model. ' +
      'Returns public image URL(s). After a successful call, show the image(s) to the user ' +
      'by including markdown image syntax ![description](url) in your reply.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed text description of the image to generate.',
        },
        size: {
          type: 'string',
          description: 'Output size like "1024x1024" or "1920x1080". Default 1024x1024.',
        },
        n: {
          type: 'integer',
          description: 'Number of images to generate. Default 1.',
        },
      },
      required: ['prompt'],
    },
    output: {
      // Raw JSON Schema (this definition is registered directly via
      // ctx.tools.register, so no DSL `required: true` annotations — the
      // object root owns the `required` array instead).
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string' },
          },
          prompt: { type: 'string' },
        },
        required: ['urls', 'prompt'],
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            `Generated ${value.urls.length} image(s) for prompt: ${value.prompt}\n` +
            value.urls.map((u) => `![${value.prompt}](${u})`).join('\n') +
            '\n\nPresent the image(s) above to the user by copying the markdown image line(s) into your reply so they render inline.',
        },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const key = apiKey();
      if (!key) {
        throw new Error(
          'AGNES_MEDIA_API_KEY (or AGNES_API_KEY) is not set — configure the Agnes AI media API key first.',
        );
      }
      const res = await fetch(`${BASE_URL}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'agnes-image-2.1-flash',
          prompt: args.prompt,
          size: args.size ?? '1024x1024',
          ...(typeof args.n === 'number' ? { n: args.n } : {}),
          extra_body: { response_format: 'url' },
        }),
        signal: exec.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `Image generation failed (${res.status}): ${data.error?.message || JSON.stringify(data)}`,
        );
      }
      assertSignal(exec);
      const urls = [];
      const items = data.data || data;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.url) urls.push(item.url);
          else if (item.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`);
        }
      } else if (items && items.url) {
        urls.push(items.url);
      }
      if (urls.length === 0) {
        throw new Error(`Unexpected image API response format: ${JSON.stringify(data)}`);
      }
      return { urls, prompt: args.prompt };
    },
  });

  // ── generate_video ────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'generate_video',
    description:
      'Generate a short video from a text prompt using the agnes-video-v2.0 model. ' +
      'Asynchronous: submits a job then polls until the video URL is ready (up to ~3 minutes).',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed text description of the video to generate.',
        },
        duration: {
          type: 'integer',
          description: 'Video duration in seconds. Default 4.',
        },
        size: {
          type: 'string',
          description: 'Video resolution like "1280x720". Default 1280x720.',
        },
      },
      required: ['prompt'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          prompt: { type: 'string' },
        },
        required: ['url', 'prompt'],
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            `Video generated for prompt: ${value.prompt}\n` +
            `Watch/download: ${value.url}\n\n` +
            'Present this video to the user with the direct link above.',
        },
      ],
    },
    // Polling can take ~3 minutes; declare a budget above the worst case so
    // the timeout-policy wrapper (when active) does not cut a running poll.
    timeoutMs: MAX_POLL_COUNT * POLL_INTERVAL_MS + 30000,
    async execute(args, exec) {
      const key = apiKey();
      if (!key) {
        throw new Error(
          'AGNES_MEDIA_API_KEY (or AGNES_API_KEY) is not set — configure the Agnes AI media API key first.',
        );
      }
      const submitRes = await fetch(`${BASE_URL}/videos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'agnes-video-v2.0',
          prompt: args.prompt,
          duration: args.duration ?? 4,
          size: args.size ?? '1280x720',
        }),
        signal: exec.signal,
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          `Video submission failed (${submitRes.status}): ${submitData.error?.message || JSON.stringify(submitData)}`,
        );
      }
      const videoId =
        (submitData.data && submitData.data.video_id) ||
        submitData.data?.id ||
        submitData.video_id ||
        submitData.id;
      if (!videoId) {
        throw new Error(`Unexpected video submission response: ${JSON.stringify(submitData)}`);
      }

      for (let i = 0; i < MAX_POLL_COUNT; i++) {
        await sleep(POLL_INTERVAL_MS, exec.signal);
        assertSignal(exec);
        const statusRes = await fetch(
          `${POLL_ENDPOINT}?video_id=${encodeURIComponent(videoId)}`,
          { headers: { Authorization: `Bearer ${key}` }, signal: exec.signal },
        );
        const statusData = await statusRes.json();
        if (!statusRes.ok) {
          throw new Error(
            `Video status check failed (${statusRes.status}): ${JSON.stringify(statusData)}`,
          );
        }
        const status = (statusData.data && statusData.data.status) || statusData.status;
        if (status === 'completed' || status === 'succeeded') {
          const url =
            (statusData.data && statusData.data.video_url) ||
            statusData.data?.url ||
            statusData.video_url ||
            statusData.url;
          if (!url) throw new Error(`Video completed but no URL: ${JSON.stringify(statusData)}`);
          return { url, prompt: args.prompt };
        }
        if (status === 'failed' || status === 'error') {
          const msg =
            (statusData.data && statusData.data.error) || statusData.error || 'Unknown error';
          throw new Error(`Video generation failed: ${msg}`);
        }
      }
      throw new Error(
        `Video generation timed out after ${(MAX_POLL_COUNT * POLL_INTERVAL_MS) / 1000}s (video_id: ${videoId})`,
      );
    },
  });
}
