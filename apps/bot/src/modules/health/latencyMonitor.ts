import { monitorEventLoopDelay, IntervalHistogram } from "node:perf_hooks";

const MAX_SAMPLES = 300; // ~5 min at 1 sample/sec

/**
 * Bounded rolling latency monitor.
 * Tracks Discord gateway ping, event-loop delay, and reconnection events.
 */
export class LatencyMonitor {
    private gatewaySamples: number[] = [];
    private eventLoopHistogram: IntervalHistogram;
    public reconnectCount = 0;
    public resumeCount = 0;

    constructor() {
        this.eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
        this.eventLoopHistogram.enable();
    }

    /** Record a new gateway heartbeat ping value (ms). */
    recordGatewayPing(pingMs: number): void {
        if (pingMs < 0 || !Number.isFinite(pingMs)) return;
        this.gatewaySamples.push(pingMs);
        if (this.gatewaySamples.length > MAX_SAMPLES) {
            this.gatewaySamples.shift();
        }
    }

    recordReconnect(): void {
        this.reconnectCount++;
    }

    recordResume(): void {
        this.resumeCount++;
    }

    getGatewayStats(): LatencyStats {
        return computeStats(this.gatewaySamples);
    }

    getEventLoopStats(): { mean: number; min: number; max: number; p95: number; p99: number } {
        const h = this.eventLoopHistogram;
        return {
            mean: round(h.mean / 1e6),
            min: round(h.min / 1e6),
            max: round(h.max / 1e6),
            p95: round(h.percentile(95) / 1e6),
            p99: round(h.percentile(99) / 1e6),
        };
    }

    destroy(): void {
        this.eventLoopHistogram.disable();
    }
}

export interface LatencyStats {
    current: number | null;
    min: number | null;
    max: number | null;
    average: number | null;
    median: number | null;
    p95: number | null;
    p99: number | null;
    samples: number;
}

function computeStats(samples: number[]): LatencyStats {
    if (samples.length === 0) {
        return { current: null, min: null, max: null, average: null, median: null, p95: null, p99: null, samples: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const len = sorted.length;

    return {
        current: sorted[len - 1]!,
        min: sorted[0]!,
        max: sorted[len - 1]!,
        average: round(sorted.reduce((a, b) => a + b, 0) / len),
        median: sorted[Math.floor(len * 0.5)]!,
        p95: sorted[Math.floor(len * 0.95)]!,
        p99: sorted[Math.floor(len * 0.99)]!,
        samples: len,
    };
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
