/**
 * Sentry Frontend Embed — generates <script> tags for the Directus admin app <head>.
 *
 * Injects the full Sentry Browser SDK via CDN to enable:
 * - Session replay (primary use case — CWIS child welfare data visibility)
 * - Browser error tracking
 * - Frontend performance monitoring (tracing)
 * - Browser profiling
 * - Frontend logs & metrics
 * - User feedback widget
 *
 * CDN bundle: bundle.tracing.replay.feedback.logs.metrics.min.js
 * Browser profiling loaded as a separate add-on script.
 *
 * Returns an empty string when SENTRY_FRONTEND_DSN is not set (no-op).
 *
 * ## PII / Replay Privacy
 *
 * Session replay masking is configured via environment variables so it can be
 * tuned per-tenant without cutting a new release. Selector lists are
 * comma-separated CSS selectors.
 *
 * | Variable | Type | Default | Description |
 * |----------|------|---------|-------------|
 * | SENTRY_REPLAY_MASK_ALL_TEXT | bool | false | Mask every text node in the DOM |
 * | SENTRY_REPLAY_MASK_ALL_INPUTS | bool | true | Mask all input/textarea values |
 * | SENTRY_REPLAY_BLOCK_ALL_MEDIA | bool | false | Block all img/svg/video/audio/etc. |
 * | SENTRY_REPLAY_MASK | csv | (see below) | CSS selectors whose text content is masked |
 * | SENTRY_REPLAY_UNMASK | csv | (empty) | CSS selectors exempted from maskAllText |
 * | SENTRY_REPLAY_BLOCK | csv | (see below) | CSS selectors replaced with a placeholder |
 * | SENTRY_REPLAY_UNBLOCK | csv | (empty) | CSS selectors exempted from blockAllMedia |
 */

/** Pinned SDK version — should match @sentry/node in the backend */
const SENTRY_SDK_VERSION = '10.42.0';

/**
 * Default mask selectors — targets the two primary data surfaces in Directus:
 *
 * 1. Item detail forms (.v-form) — wraps all field interfaces (inputs,
 *    relational dropdowns, textareas, WYSIWYG, file pickers, etc.)
 * 2. Collection list views — table cells, card titles/subtitles, and
 *    display-rendered values used across all layout types.
 */
const DEFAULT_MASK = [
	'.v-form',
	'.v-table .table-row .cell',
	'.layout-cards .card .title',
	'.layout-cards .card .subtitle',
	'.render-template',
].join(',');

/**
 * Default block selectors — blocks uploaded media (photos, scanned documents,
 * videos) served from the Directus asset pipeline.
 */
const DEFAULT_BLOCK = [
	'img[src*="/assets/"]',
	'video[src*="/assets/"]',
	'audio[src*="/assets/"]',
].join(',');

/** Parse a comma-separated env var into a JS array literal string for embedding. */
function csvToJsArray(envKey: string, fallback: string): string {
	const raw = process.env[envKey] ?? fallback;
	if (!raw) return '[]';

	const selectors = raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	return JSON.stringify(selectors);
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
	const value = process.env[key];
	if (value === undefined || value === '') return defaultValue;
	return value === 'true' || value === '1';
}

export function getSentryFrontendEmbed(): string {
	const dsn = process.env['SENTRY_FRONTEND_DSN'];

	if (!dsn) return '';

	const environment = process.env['SENTRY_ENVIRONMENT'] || 'development';
	const release = process.env['SENTRY_RELEASE'] || '';
	const tenantName = process.env['F2F_TENANT_NAME'] || '';
	const environmentName = process.env['F2F_ENVIRONMENT_NAME'] || '';

	const replaysSessionSampleRate = Number.parseFloat(process.env['SENTRY_REPLAYS_SESSION_SAMPLE_RATE'] || '0.1');
	const replaysOnErrorSampleRate = Number.parseFloat(process.env['SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE'] || '1.0');
	const tracesSampleRate = Number.parseFloat(process.env['SENTRY_TRACES_SAMPLE_RATE'] || '0.1');
	const profileSessionSampleRate = Number.parseFloat(process.env['SENTRY_PROFILE_SESSION_SAMPLE_RATE'] || '0.1');
	const enableLogs = process.env['SENTRY_ENABLE_LOGS'] !== 'false';

	// Replay privacy — all configurable via env vars, no release required.
	const maskAllText = getEnvBool('SENTRY_REPLAY_MASK_ALL_TEXT', false);
	const maskAllInputs = getEnvBool('SENTRY_REPLAY_MASK_ALL_INPUTS', true);
	const blockAllMedia = getEnvBool('SENTRY_REPLAY_BLOCK_ALL_MEDIA', false);
	const mask = csvToJsArray('SENTRY_REPLAY_MASK', DEFAULT_MASK);
	const unmask = csvToJsArray('SENTRY_REPLAY_UNMASK', '');
	const block = csvToJsArray('SENTRY_REPLAY_BLOCK', DEFAULT_BLOCK);
	const unblock = csvToJsArray('SENTRY_REPLAY_UNBLOCK', '');

	const cdnBase = `https://browser.sentry-cdn.com/${SENTRY_SDK_VERSION}`;

	return `
		<!-- Sentry Browser SDK (F2F fork) -->
		<script
			src="${cdnBase}/bundle.tracing.replay.feedback.logs.metrics.min.js"
			crossorigin="anonymous"
		></script>
		<script
			src="${cdnBase}/browserprofiling.min.js"
			crossorigin="anonymous"
		></script>
		<script
			src="${cdnBase}/replay-canvas.min.js"
			crossorigin="anonymous"
		></script>
		<script>
			Sentry.init({
				dsn: ${JSON.stringify(dsn)},
				environment: ${JSON.stringify(environment)},
				${release ? `release: ${JSON.stringify(release)},` : ''}
				integrations: [
					Sentry.browserTracingIntegration(),
					Sentry.replayIntegration({
						maskAllText: ${maskAllText},
						maskAllInputs: ${maskAllInputs},
						blockAllMedia: ${blockAllMedia},
						mask: ${mask},
						unmask: ${unmask},
						block: ${block},
						unblock: ${unblock},
					}),
					Sentry.replayCanvasIntegration(),
					Sentry.browserProfilingIntegration(),
					Sentry.feedbackIntegration({
						colorScheme: "system",
						autoInject: false,
					}),
				],
				tracesSampleRate: ${tracesSampleRate},
				profileSessionSampleRate: ${profileSessionSampleRate},
				profileLifecycle: "trace",
				replaysSessionSampleRate: ${replaysSessionSampleRate},
				replaysOnErrorSampleRate: ${replaysOnErrorSampleRate},
				enableLogs: ${enableLogs},
			});
			${tenantName ? `Sentry.setTag("tenant_name", ${JSON.stringify(tenantName)});` : ''}
			${environmentName ? `Sentry.setTag("f2f_environment", ${JSON.stringify(environmentName)});` : ''}
		</script>
	`;
}
