import { defineStore } from 'pinia';

export interface LatencyMeasurement {
	timestamp: Date;
	latency: number;
}

export const useLatencyStore = defineStore('latencyStore', {
	state: () => ({
		measurements: [] as LatencyMeasurement[],
		maxMeasurements: 100,
	}),
	getters: {
		latestMeasurements(): LatencyMeasurement[] {
			return this.measurements.slice(-10);
		},
		averageLatency(): number {
			if (this.measurements.length === 0) return 0;
			const sum = this.measurements.reduce((acc, m) => acc + m.latency, 0);
			return sum / this.measurements.length;
		},
	},
	actions: {
		save(measurement: LatencyMeasurement) {
			this.measurements.push(measurement);

			// Keep only the most recent measurements to prevent memory bloat
			if (this.measurements.length > this.maxMeasurements) {
				this.measurements = this.measurements.slice(-this.maxMeasurements);
			}
		},
		clear() {
			this.measurements = [];
		},
	},
});
