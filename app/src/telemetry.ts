// OpenTelemetry removed - using Sentry only for observability
// Zone.js caused V8 OOM crashes with infinite promise chains
// See: https://github.com/Face-to-Face-IT/directus/issues/crash-85e937711a2f48b3

let loggerProvider: unknown = null;
let meterProvider: unknown = null;

export function initTelemetry() {
	// OpenTelemetry disabled - using Sentry for observability
	// This prevents Zone.js from patching Promise.prototype.then
	console.log('[Telemetry] OpenTelemetry disabled, using Sentry for observability');
}

/**
 * Stub logger for compatibility (logs to console only)
 */
export function getLogger(name = 'directus-app') {
	return {
		error: (message: string, ...args: unknown[]) => console.error(`[${name}]`, message, ...args),
		warn: (message: string, ...args: unknown[]) => console.warn(`[${name}]`, message, ...args),
		info: (message: string, ...args: unknown[]) => console.info(`[${name}]`, message, ...args),
		debug: (message: string, ...args: unknown[]) => console.debug(`[${name}]`, message, ...args),
	};
}

export { initWebVitals } from './telemetry/web-vitals';
export { initAppMetrics, recordApiRequest, recordUserAction, recordNavigation, recordRenderTime } from './telemetry/app-metrics';

/**
 * Stub meter for compatibility
 */
export function getMeter(name = 'directus-app') {
	return meterProvider?.getMeter?.(name) ?? null;
}

/**
 * Emit a log record (logs to console only)
 */
export function emitLog(
	severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
	body: string,
	attributes: Record<string, string | number | boolean> = {},
) {
	const logData = { severity, body, attributes: { ...attributes, 'browser.url': window.location.href } };
	switch (severity) {
		case 'ERROR':
			console.error('[Telemetry]', logData);
			break;
		case 'WARN':
			console.warn('[Telemetry]', logData);
			break;
		case 'DEBUG':
			console.debug('[Telemetry]', logData);
			break;
		default:
			console.log('[Telemetry]', logData);
	}
}
