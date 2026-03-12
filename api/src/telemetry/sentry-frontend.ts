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
 */

/** Pinned SDK version — should match @sentry/node in the backend */
const SENTRY_SDK_VERSION = '10.42.0';

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
	const profilesSampleRate = Number.parseFloat(process.env['SENTRY_PROFILES_SAMPLE_RATE'] || '0.1');
	const enableLogs = process.env['SENTRY_ENABLE_LOGS'] !== 'false';

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
						maskAllText: false,
						maskAllInputs: true,
						blockAllMedia: false,
					}),
					Sentry.replayCanvasIntegration(),
					Sentry.browserProfilingIntegration(),
					Sentry.feedbackIntegration({
						colorScheme: "system",
						autoInject: false,
					}),
				],
				tracesSampleRate: ${tracesSampleRate},
				profilesSampleRate: ${profilesSampleRate},
				replaysSessionSampleRate: ${replaysSessionSampleRate},
				replaysOnErrorSampleRate: ${replaysOnErrorSampleRate},
				enableLogs: ${enableLogs},
			});
			${tenantName ? `Sentry.setTag("tenant_name", ${JSON.stringify(tenantName)});` : ''}
			${environmentName ? `Sentry.setTag("f2f_environment", ${JSON.stringify(environmentName)});` : ''}
		</script>
	`;
}
