/**
 * agnes-media – DeepSeek Harness (dsh) bundle plugin.
 *
 * Registers two host tools that route through the Agnes AI media endpoints
 * (the standard chat-completions route rejects these models with a 400):
 *
 *   - generate_image  → POST /v1/images/generations  (agnes-image-2.1-flash)
 *   - generate_video  → POST /v1/videos + polling     (agnes-video-v2.0)
 *
 * Auth: AGNES_MEDIA_API_KEY (or AGNES_API_KEY fallback).
 * The key is read from the process environment at call time — never hardcode it.
 * Also supports DSH credentials system for secure key storage.
 *
 * Endpoints:
 *   - International: https://apihub.agnes-ai.com    (default; needs proxy in mainland CN)
 *   - Domestic (CN): https://apihub.agnes-ai.cn     (set AGNES_MEDIA_DOMAIN=cn to switch)
 *   - Custom:        set AGNES_MEDIA_BASE_URL to any OpenAI-compatible Agnes endpoint
 *
 * This file is plain ESM loaded by the dsh Loader: it must not import any
 * package that is not already resolvable from the running dsh installation,
 * so it uses only the injected context (`ctx.tools`, `ctx.credentials`) plus Node builtins.
 */

export const name = 'agnes-media';
export const inject = ['tools', 'credentials'];
export const exports = [name];

/* ------------------------------------------------------------------ */
/*  Configurable endpoint — default .com; override via env vars       */
/* ------------------------------------------------------------------ */
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_COUNT = 60; // ~3 minutes of polling

let _baseURL = null;

/** Compute BASE_URL once. Order: explicit full URL > domain shorthand > default. */
function getBaseURL() {
	if (_baseURL !== null) return _baseURL;

	const customFull = process.env.AGNES_MEDIA_BASE_URL;
	if (customFull && typeof customFull === 'string') {
		_baseURL = customFull.replace(/\/+$/, '') + '/v1';
		return _baseURL;
	}

	const domain = (process.env.AGNES_MEDIA_DOMAIN || '').toLowerCase();
	switch (domain) {
		case 'cn':
			_baseURL = 'https://apihub.agnes-ai.cn/v1';
			break;
		default:
			// .com, empty string, or anything else
			_baseURL = 'https://apihub.agnes-ai.com/v1';
			break;
	}
	return _baseURL;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Resolve the Agnes API key: env > credentials store. Caches result after first resolution. */
async function apiKey(ctx) {
	// Try environment variables first
	const envKey = process.env.AGNES_MEDIA_API_KEY || process.env.AGNES_API_KEY;
	if (envKey) {
		return envKey;
	}

	// Fall back to DSH credentials system
	try {
		const credentials = ctx?.get?.('credentials');
		if (credentials) {
			// Try AGNES_MEDIA_API_KEY
			const mediaResult = await credentials.resolve('AGNES_MEDIA_API_KEY');
			if (mediaResult?.value) {
				return mediaResult.value;
			}
			// Fallback to AGNES_API_KEY
			const apiResult = await credentials.resolve('AGNES_API_KEY');
			if (apiResult?.value) {
				return apiResult.value;
			}
		}
	} catch (e) {
		// Ignore credential resolution errors, fall through to error
	}

	return null;
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

/** Clamp n to 1..4 because the image model caps batch size at 4. */
function clampImages(n) {
	if (typeof n !== 'number') return 1;
	return Math.max(1, Math.min(4, Math.round(n)));
}

/** Parse "WxH" string or "{width,W},{height,H}" into width/height ints. */
function parseSize(value, fallbackW, fallbackH) {
	if (!value || typeof value !== 'string') return { width: fallbackW, height: fallbackH };
	// Try WxH format first
	const xhMatch = value.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
	if (xhMatch) return { width: parseInt(xhMatch[1], 10), height: parseInt(xhMatch[2], 10) };
	// Try structured format {width,W},{height,H}
	const wMatch = value.match(/\bwidth\s*[:;,]?\s*(\d+)/i);
	const hMatch = value.match(/\bheight\s*[:;,]?\s*(\d+)/i);
	return {
		width: wMatch ? parseInt(wMatch[1], 10) : fallbackW,
		height: hMatch ? parseInt(hMatch[1], 10) : fallbackH,
	};
}

/** Round duration (seconds) to nearest valid num_frames satisfying 8n+1 ≤ 441. */
function durationToFrames(seconds, fps) {
	fps = fps || 24;
	let rawFrames = Math.ceil(seconds * fps);
	rawFrames = Math.max(81, Math.min(441, rawFrames));
	// Find closest 8n+1 >= rawFrames
	const n = Math.ceil((rawFrames - 1) / 8);
	return Math.min(441, 8 * n + 1);
}

/** Describe current endpoint configuration (for error messages). */
function describeEndpoint() {
	const url = getBaseURL();
	if (url.includes('.cn')) return 'domestic node (.cn)';
	return 'international node (.com)';
}

/* ------------------------------------------------------------------ */
/*  Plugin apply hook                                                  */
/* ------------------------------------------------------------------ */

export function apply(ctx) {

	/* ── generate_image ──────────────────────────────────────── */
	ctx.tools.register({
		name: 'generate_image',
		description:
			'Generate image(s) from a text prompt using the agnes-image-2.1-flash model.\n\n' +
			'Returns public image URL(s). After a successful call, show the image(s) to the user\nby including markdown image syntax `![description](url)` in your reply.',
		parameters: {
			type: 'object',
			properties: {
				prompt: {
					type: 'string',
					description:
						'Detailed text description of the image to generate. Include subject, scene, composition, style, lighting, camera/framing, color palette, mood, and quality cues for best results.',
				},
				size: {
					type: 'string',
					description:
						'Output dimensions. Accept "WxH" (e.g. "1920x1080") or structured "{width,1920},{height,1080}". Default 1024x1024.',
				},
				n: {
					type: 'integer',
					description: 'Number of images to generate. Default 1, max 4.',
				},
			},
			required: ['prompt'],
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					urls: { type: 'array', items: { type: 'string' } },
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
			const key = await apiKey(ctx);
			if (!key) {
				throw new Error(
					'AGNES_MEDIA_API_KEY (or AGNES_API_KEY) is not set.\n' +
					'Configure the Agnes AI media API key as an environment variable before starting DSH.\n' +
					'This key comes from Agnes AI — see platform.agnes-ai.com or platform.agnes-ai.cn.',
				);
			}

			const { width, height } = parseSize(args.size, 1024, 1024);
			const n = clampImages(args.n);
			const sizeStr = `${width}x${height}`;

			const body = {
				model: 'agnes-image-2.1-flash',
				prompt: args.prompt,
				size: sizeStr,
			};
			if (n > 1) body.n = n;

			const res = await fetch(`${getBaseURL()}/images/generations`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${key}`,
				},
				body: JSON.stringify(body),
				signal: exec.signal,
			});

			const data = await res.json();
			if (!res.ok) {
				const msg = data.error?.message || JSON.stringify(data);
				if (msg.includes('timeout') || msg.includes('connect')) {
					throw new Error(
						`Connection failed while calling Agnes AI (${describeEndpoint()}): ${msg}.\n` +
						'If you are in mainland China and experiencing slow / timed-out requests,\n' +
						'set AGNES_MEDIA_DOMAIN=cn to use the domestic API node.',
					);
				}
				throw new Error(`Image generation failed (${res.status}): ${msg}`);
			}

			assertSignal(exec);

			// Extract URLs — works with OpenAI-compatible wrapper format or bare array
			const urls = [];
			const items = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [data];
			for (const item of items) {
				if (item?.url) urls.push(item.url);
				else if (item?.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`);
			}
			if (urls.length === 0) {
				throw new Error(`Unexpected image API response format: ${JSON.stringify(data)}`);
			}

			return { urls, prompt: args.prompt };
		},
	});

	/* ── generate_video ──────────────────────────────────────── */
	ctx.tools.register({
		name: 'generate_video',
		description:
			'Generate a short video from a text prompt using the agnes-video-v2.0 model.\n\n' +
			'Asynchronous: submits a job then polls until the video URL is ready (up to ~3 min).\n\n' +
			'**Frame constraints** — `num_frames` must equal **8 × n + 1** and be ≤ 441. Valid values:\n81, 121, 161, 201, 241, 281, 321, 361, 401, 441.\nIf you pass `duration` instead, it will be converted automatically at 24 fps.\n\n' +
			'**Resolution** — use the `size` parameter as "W×H" string, e.g. "1280x720". Default 1280x720.\n' +
			'Alternatively specify `{width,1280},{height,720}`.',
		parameters: {
			type: 'object',
			properties: {
				prompt: {
					type: 'string',
					description:
						'Detailed text description of the video to generate. Include subject, action, scene, camera movement/pans/zooms, lighting, and style.',
				},
				duration: {
					type: 'integer',
					description:
						'Target video duration in seconds. Will be rounded to a valid frame count at 24 fps. Default 5 (~121 frames, 5 s).',
				},
				size: {
					type: 'string',
					description:
						'Video resolution like "1280x720". Default 1280x720. Also accepts "{width,W},{height,H}".',
				},
				frame_rate: {
					type: 'integer',
					description:
						'Frames per second. Supported 1–60. Default 24.',
				},
				num_frames: {
					type: 'integer',
					description:
						'Explicit frame count override. Must satisfy 8n + 1 and be ≤ 441. If provided, ignores `duration`. Valid: 81, 121, 161, 201, 241, 281, 321, 361, 401, 441.',
				},
				negative_prompt: {
					type: 'string',
					description:
						'Description of things to avoid in the generated video. E.g. "blurry, shaky camera, low quality".',
				},
				seed: {
					type: 'integer',
					description:
						'Random seed for reproducible generation. Omit for randomness.',
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
		isConcurrencySafe: () => true,
		timeoutMs: MAX_POLL_COUNT * POLL_INTERVAL_MS + 30_000,
		async execute(args, exec) {
			const key = await apiKey(ctx);
			if (!key) {
				throw new Error(
					'AGNES_MEDIA_API_KEY (or AGNES_API_KEY) is not set.\n' +
					'Configure the Agnes AI media API key as an environment variable before starting DSH.\n' +
					'This key comes from Agnes AI — see platform.agnes-ai.com or platform.agnes-ai.cn.',
				);
			}

			/* Resolve dimensions */
			const { width, height } = parseSize(args.size, 1280, 720);
			const frameRate =
				args.frame_rate != null
					? Math.max(1, Math.min(60, Number(args.frame_rate)))
					: 24;

			/* Resolve frame count: explicit num_frames wins, otherwise convert duration */
			let numFrames;
			if (args.num_frames != null) {
				numFrames = Math.round(Number(args.num_frames));
				if (numFrames <= 0 || numFrames > 441 || (numFrames - 1) % 8 !== 0) {
					throw new Error(
						`Invalid num_frames: ${numFrames}. Must satisfy 8n + 1 and be ≤ 441. Valid values: 81, 121, 161, 201, 241, 281, 321, 361, 401, 441.`,
					);
				}
			} else {
				const secs = args.duration != null ? Math.max(1, Number(args.duration)) : 5;
				numFrames = durationToFrames(secs, frameRate);
			}

			/* Build request body matching Agnes Video V2.0 spec */
			const requestBody = {
				model: 'agnes-video-v2.0',
				prompt: args.prompt,
				width,
				height,
				num_frames: numFrames,
				frame_rate: frameRate,
			};

			if (args.negative_prompt && typeof args.negative_prompt === 'string') {
				requestBody.negative_prompt = args.negative_prompt.trim();
			}
			if (args.seed != null && typeof args.seed === 'number') {
				requestBody.seed = Math.floor(args.seed);
			}

			/* Step 1 — submit job via POST /v1/videos */
			const submitRes = await fetch(`${getBaseURL()}/videos`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${key}`,
				},
				body: JSON.stringify(requestBody),
				signal: exec.signal,
			});

			const submitData = await submitRes.json();
			if (!submitRes.ok) {
				const msg = submitData.error?.message || JSON.stringify(submitData);
				if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('connect')) {
					throw new Error(
						`Connection failed while calling Agnes AI (${describeEndpoint()}): ${msg}.\n` +
						'If you are in mainland China and experiencing slow / timed-out requests,\n' +
						'set AGNES_MEDIA_DOMAIN=cn to use the domestic API node.',
					);
				}
				throw new Error(`Video submission failed (${submitRes.status}): ${msg}`);
			}

			/* Extract task_id — API returns it at top level */
			const taskId =
				submitData.task_id ??
				submitData.id ??
				submitData.data?.id ??
				submitData.data?.task_id;
			if (!taskId) {
				throw new Error(`Unexpected video submission response: ${JSON.stringify(submitData)}`);
			}

			/* Step 2 — poll GET /v1/videos/{task_id} until completed/failed/timed-out */
			for (let i = 0; i < MAX_POLL_COUNT; i++) {
				await sleep(POLL_INTERVAL_MS, exec.signal);
				assertSignal(exec);

				const statusRes = await fetch(`${getBaseURL()}/videos/${encodeURIComponent(taskId)}`, {
					headers: { Authorization: `Bearer ${key}` },
					signal: exec.signal,
				});

				const statusData = await statusRes.json();
				if (!statusRes.ok) {
					throw new Error(
						`Video status check failed (${statusRes.status}): ${JSON.stringify(statusData)}`,
					);
				}

				const status = statusData.status ?? statusData.data?.status;

				if (status === 'completed' || status === 'succeeded') {
					const url =
						statusData.remixed_from_video_id ??
						statusData.video_url ??
						statusData.url ??
						statusData.data?.video_url ??
						statusData.data?.url;
					if (!url) {
						throw new Error(`Video completed but no URL found: ${JSON.stringify(statusData)}`);
					}
					return { url, prompt: args.prompt };
				}

				if (status === 'failed' || status === 'error') {
					const msg =
						statusData.error ??
						statusData.data?.error ??
						'Unknown error';
					throw new Error(`Video generation failed: ${msg}`);
				}
			}

			throw new Error(
				`Video generation timed out after ${(MAX_POLL_COUNT * POLL_INTERVAL_MS) / 1000}s (task_id: ${taskId})`,
			);
		},
	});
}
