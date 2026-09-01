/**
 * agnes-media – DeepSeek Harness (dsh) bundle plugin.
 *
 * Registers two host tools that route through the Agnes AI media endpoints
 * (the standard chat-completions route rejects these models with a 400):
 *
 *   - generate_image  → POST /v1/images/generations  (agnes-image-2.1-flash)
 *   - generate_video  → POST /v1/videos + polling     (agnes-video-2.5-flash)
 *
 * Auth: AGNES_MEDIA_API_KEY (or AGNES_API_KEY fallback, or DSH credentials).
 * The key is read from the process environment or DSH credentials system at call time — never hardcode it.
 *
 * Endpoints:
 *   - Measured result: the old api.agnes-ai.com/.cn nodes all 404/401;
 *     only https://apihub.agnes-ai.cn is reachable from mainland China.
 *     Both branches of getBaseURL() therefore point at it by default.
 *   - Custom: set AGNES_MEDIA_BASE_URL to any OpenAI-compatible Agnes endpoint
 *     (international users can restore https://apihub.agnes-ai.com/v1 that way).
 *
 * This file is plain ESM loaded by the dsh Loader: it must not import any
 * package that is not already resolvable from the running dsh installation,
 * so it uses only the injected context (`ctx.tools`) plus Node builtins.
 */

export const name = 'agnes-media';
export const inject = ['tools', 'credentials'];
export const exports = [name];

/* ------------------------------------------------------------------ */
/*  Configurable endpoint — default .com; override via env vars       */
/* ------------------------------------------------------------------ */
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_COUNT = 120; // ~10 minutes of polling (excluding backoff pauses)

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
			_baseURL = 'https://apihub.agnes-ai.cn/v1';
			break;
	}
	return _baseURL;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Get API key from environment or DSH credentials system.
 * Priority: process.env.AGNES_MEDIA_API_KEY > process.env.AGNES_API_KEY > credentials store
 */
async function apiKey(ctx) {
	// First try environment variables
	const envKey = process.env.AGNES_MEDIA_API_KEY || process.env.AGNES_API_KEY;
	if (envKey) return envKey;

	// Fall back to DSH credentials system
	try {
		const credentials = ctx?.get?.('credentials');
		if (credentials) {
			// Try AGNES_MEDIA_API_KEY first
			const mediaKey = await credentials.resolve?.('AGNES_MEDIA_API_KEY');
			if (mediaKey?.value) return mediaKey.value;

			// Fallback to AGNES_API_KEY
			const apiKey = await credentials.resolve?.('AGNES_API_KEY');
			if (apiKey?.value) return apiKey.value;
		}
	} catch (e) {
		// Ignore credential resolution errors
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

/** Map aspect ratio string to width/height and size string. */
const ASPECT_RATIOS = {
	'16:9': { w: 1280, h: 720, size: '720P' },
	'9:16': { w: 720, h: 1280, size: '720P' },
	'1:1': { w: 720, h: 720, size: '720P' },
	'4:3': { w: 960, h: 720, size: '720P' },
	'3:4': { w: 720, h: 960, size: '720P' },
	'21:9': { w: 1680, h: 720, size: '720P' },
};

function parseAspectRatio(value) {
	if (!value || typeof value !== 'string') return '16:9';
	const ratio = value.trim().replace(/\s/g, '');
	return ASPECT_RATIOS[ratio] ? ratio : '16:9';
}

/** Validate duration is between 4 and 12 seconds. */
function validateDuration(seconds) {
	const n = Number(seconds);
	if (isNaN(n)) return 5;
	return Math.max(4, Math.min(12, n));
}

/** Describe current endpoint configuration (for error messages). */
function describeEndpoint() {
	const url = getBaseURL();
	if (url.includes('.cn')) return 'domestic node (cn)';
	return 'international node (com)';
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
					'Configure the Agnes AI media API key as an environment variable before starting DSH,\n' +
					'or store it in ~/.dsh/.credentials.yaml under refs.\n' +
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
						'Check your network; the default node is apihub.agnes-ai.cn (domestic).\n' +
						'You can override the endpoint with AGNES_MEDIA_BASE_URL.',
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
			'Generate a short video from a text prompt using the agnes-video-2.5-flash model.\n\n' +
			'Asynchronous: submits a job then polls until the video URL is ready (up to ~6 min).\n\n' +
			'**Duration** — 4 to 12 seconds. Default 5.\n\n' +
			'**Aspect ratios** — "16:9" (default), "9:16", "1:1", "4:3", "3:4", "21:9".\n' +
			'**Resolution** — Fixed at 720p for all aspect ratios.\n' +
			'**References** — optional `reference_image_url` (1 张) 或 `reference_image_urls`\n' +
			'(数组，1–5 张，支持 https 或 data:URI)；提供任一即启用 reference 模式。\n',
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
					description: 'Target video duration in seconds. Range 4-12. Default 5.',
				},
				size: {
					type: 'string',
					description:
						'Resolution string (optional, 720p is default). Also accepts "WxH" or structured format.',
				},
				aspect_ratio: {
					type: 'string',
					description:
						'Aspect ratio: "16:9" (default), "9:16", "1:1", "4:3", "3:4", "21:9".',
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
				reference_image_url: {
					type: 'string',
					description:
						'Optional publicly accessible HTTPS image URL used as the character reference in reference mode. Local file paths are not accepted by Agnes. (Deprecated: use reference_image_urls for multiple images)',
				},
				reference_image_urls: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Optional list of 1-5 reference image URLs (https or data:URI). First image is the primary character/style anchor; extras add props or UI references.',
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
					'Configure the Agnes AI media API key as an environment variable before starting DSH,\n' +
					'or store it in ~/.dsh/.credentials.yaml under refs.\n' +
					'This key comes from Agnes AI — see platform.agnes-ai.com or platform.agnes-ai.cn.',
				);
			}

			/* Resolve aspect ratio and dimensions */
			const ratioKey = parseAspectRatio(args.aspect_ratio);
			const ratioConfig = ASPECT_RATIOS[ratioKey];
			const width = ratioConfig.w;
			const height = ratioConfig.h;
			const size = ratioConfig.size;

			/* Resolve duration */
			const duration = validateDuration(args.duration);

			/* Collect reference images (single param kept for backwards compat). */
			const refUrls = [];
			if (typeof args.reference_image_url === 'string' && args.reference_image_url.trim()) {
				refUrls.push(args.reference_image_url.trim());
			}
			if (Array.isArray(args.reference_image_urls)) {
				for (const u of args.reference_image_urls) {
					if (typeof u === 'string' && u.trim()) refUrls.push(u.trim());
				}
			}
			if (refUrls.length > 5) refUrls.length = 5; // Agnes caps reference images at 5

			/* Build request body for Agnes Video 2.5 Flash. */
			const requestBody = {
				model: 'agnes-video-2.5-flash',
				prompt: args.prompt,
				seconds: String(duration),
				mode: refUrls.length > 0 ? 'reference' : 'text',
				size: '720P',
				aspect_ratio: ratioKey,
				n: 1,
			};
			if (refUrls.length > 0) {
				requestBody.images = refUrls;
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
						'Check your network; the default node is apihub.agnes-ai.cn (domestic).\n' +
						'You can override the endpoint with AGNES_MEDIA_BASE_URL.',
					);
				}
				throw new Error(`Video submission failed (${submitRes.status}): ${msg}`);
			}

			/* Agnes status API requires video_id, especially for reference mode. */
			const videoId =
				submitData.video_id ??
				submitData.data?.video_id;
			if (!videoId) {
				throw new Error(`Unexpected video submission response: ${JSON.stringify(submitData)}`);
			}

			/* Step 2 — poll /agnesapi with video_id and model_name. */
			for (let i = 0; i < MAX_POLL_COUNT; i++) {
				await sleep(POLL_INTERVAL_MS, exec.signal);
				assertSignal(exec);

				/* 429 rate limits, 5xx and network hiccups are transient: back off and retry. */
				let statusData = null;
				let transient = false;
				try {
					const statusRes = await fetch(
						`${getBaseURL().replace('/v1', '')}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=agnes-video-2.5-flash`,
						{
							headers: { Authorization: `Bearer ${key}` },
							signal: exec.signal,
						},
					);
					statusData = await statusRes.json();
					if (!statusRes.ok) {
						if (statusRes.status === 429 || statusRes.status >= 500) {
							transient = true;
						} else {
							throw new Error(
								`Video status check failed (${statusRes.status}): ${JSON.stringify(statusData)}`,
							);
						}
					}
				} catch (e) {
					if (e instanceof Error && e.message?.startsWith('Video status check failed')) throw e;
					transient = true; // network error or invalid JSON body
				}
				if (transient) {
					await sleep(10_000, exec.signal);
					continue;
				}

				const status = statusData.status ?? statusData.data?.status;

				if (status === 'completed' || status === 'succeeded') {
					const url =
						statusData.metadata?.url ??
						statusData.url ??
						statusData.video_url ??
						statusData.data?.url ??
						statusData.data?.video_url;
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
				`Video generation timed out after ${(MAX_POLL_COUNT * POLL_INTERVAL_MS) / 1000}s (video_id: ${videoId})`,
			);
		},
	});
}
