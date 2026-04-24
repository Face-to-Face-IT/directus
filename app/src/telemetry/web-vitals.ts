import type { Metric } from 'web-vitals';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';

/**
 * Initialize Web Vitals collection
 *
 * Collects Core Web Vitals:
 * - LCP (Largest Contentful Paint): Loading performance
 * - INP (Interaction to Next Paint): Interactivity
 * - CLS (Cumulative Layout Shift): Visual stability
 * - FCP (First Contentful Paint): Initial paint time
 * - TTFB (Time to First Byte): Server response time
 *
 * Note: OpenTelemetry disabled due to Zone.js V8 OOM crashes
 * Web Vitals are logged to console only
 */
export function initWebVitals() {
	// Helper function to report metrics
	const reportMetric = (metric: Metric) => {
		const logData = {
			'web_vitals.name': metric.name,
			'web_vitals.rating': metric.rating,
			'web_vitals.id': metric.id,
			'web_vitals.navigation_type': metric.navigationType,
			'web_vitals.value': metric.value,
			'page.url': window.location.href,
			'page.path': window.location.pathname,
		};

		// Log all metrics
		console.log('[Web Vitals]', logData);

		// Warn on poor metrics
		if (metric.rating === 'poor') {
			console.warn(`[Web Vitals] Poor ${metric.name}: ${metric.value}`, {
				rating: metric.rating,
				threshold: getThreshold(metric.name),
			});
		}
	};

	// Register Web Vitals observers
	onLCP((metric) => reportMetric(metric));
	onINP((metric) => reportMetric(metric));
	onCLS((metric) => reportMetric(metric));
	onFCP((metric) => reportMetric(metric));
	onTTFB((metric) => reportMetric(metric));

	console.log('[Web Vitals] Monitoring initialized (OpenTelemetry disabled)');
}

/**
 * Get the "good" threshold for a Web Vital metric
 */
function getThreshold(metric: string): string {
	const thresholds: Record<string, string> = {
		LCP: '2.5s',
		INP: '200ms',
		CLS: '0.1',
		FCP: '1.8s',
		TTFB: '800ms',
	};

	return thresholds[metric] || 'unknown';
}
