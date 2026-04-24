// App metrics stub - OpenTelemetry disabled due to Zone.js V8 OOM crashes
// See: https://github.com/Face-to-Face-IT/directus/issues/crash-85e937711a2f48b3

/**
 * Initialize custom Directus app metrics (stub)
 *
 * Note: OpenTelemetry disabled. Metrics are logged to console only.
 */
export function initAppMetrics() {
	console.log('[App Metrics] Custom metrics initialized (OpenTelemetry disabled)');
}

/**
 * Record an API request (logs to console)
 */
export function recordApiRequest(
	endpoint: string,
	method: string,
	statusCode: number,
	duration: number,
	error?: string,
) {
	const logData = {
		'http.endpoint': endpoint,
		'http.method': method,
		'http.status_code': statusCode,
		duration_ms: duration,
		...(error && { 'error.type': error }),
	};

	if (statusCode >= 400 || error) {
		console.warn('[API Error]', logData);
	} else {
		console.log('[API Request]', logData);
	}
}

/**
 * Record a user action (logs to console)
 */
export function recordUserAction(action: string, target?: string, metadata?: Record<string, string>) {
	console.log('[User Action]', {
		'action.type': action,
		'action.target': target || 'unknown',
		...metadata,
	});
}

/**
 * Record a route navigation (logs to console)
 */
export function recordNavigation(from: string, to: string) {
	console.log('[Navigation]', {
		'navigation.from': from,
		'navigation.to': to,
	});
}

/**
 * Record component render time (logs to console)
 */
export function recordRenderTime(componentName: string, duration: number) {
	console.log('[Render Time]', {
		'component.name': componentName,
		duration_ms: duration,
	});
}
