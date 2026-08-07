import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

const MAX_SAMPLES = 300;
const DEFAULT_GATEWAY_SAMPLE_MAX_AGE_MS = 30_000;

interface GatewaySample {
    value: number;
    recordedAt: number;
}

export interface LatencyMonitorOptions {
    gatewaySampleMaxAgeMs?: number;
    now?: () => number;
}

/**
 * Bounded rolling latency monitor.
 * Tracks Discord gateway ping, event-loop delay, and reconnection events.
 */
export class LatencyMonitor {
    private gatewaySamples: GatewaySample[] = [];
    private eventLoopHistogram: IntervalHistogram;
    private readonly gatewaySampleMaxAgeMs: number;
    private readonly now: () => number;
    public reconnectCount = 0;
    public resumeCount = 0;

    private destroyed = false;

    constructor(options: LatencyMonitorOptions = {}) {
        this.gatewaySampleMaxAgeMs = options.gatewaySampleMaxAgeMs ?? DEFAULT_GATEWAY_SAMPLE_MAX_AGE_MS;
        this.now = options.now ?? Date.now;
        this.eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
        this.eventLoopHistogram.enable();
    }

    /** Record a new gateway heartbeat ping value (ms). */
    recordGatewayPing(pingMs: number): void {
        if (this.destroyed || pingMs < 0 || !Number.isFinite(pingMs)) return;
        this.gatewaySamples.push({ value: pingMs, recordedAt: this.now() });
        if (this.gatewaySamples.length > MAX_SAMPLES) {
            this.gatewaySamples.shift();
        }
    }

    recordReconnect(): void {
        if (!this.destroyed) this.reconnectCount++;
    }

    recordResume(): void {
        if (!this.destroyed) this.resumeCount++;
    }

    getGatewayStats(): LatencyStats {
        this.pruneStaleGatewaySamples();
        return computeStats(this.gatewaySamples.map((sample) => sample.value));
    }

    getEventLoopStats(): EventLoopLatencyStats {
        const h = this.eventLoopHistogram;
        if (h.count === 0) return { mean: null, min: null, max: null, p95: null, p99: null };
        return {
            mean: nanosecondsToMilliseconds(h.mean),
            min: nanosecondsToMilliseconds(h.min),
            max: nanosecondsToMilliseconds(h.max),
            p95: nanosecondsToMilliseconds(h.percentile(95)),
            p99: nanosecondsToMilliseconds(h.percentile(99)),
        };
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.eventLoopHistogram.disable();
        this.gatewaySamples.length = 0;
        this.reconnectCount = 0;
        this.resumeCount = 0;
    }

    private pruneStaleGatewaySamples(): void {
        const cutoff = this.now() - this.gatewaySampleMaxAgeMs;
        while (this.gatewaySamples[0] && this.gatewaySamples[0].recordedAt < cutoff) {
            this.gatewaySamples.shift();
        }
    }
}

export interface EventLoopLatencyStats {
    mean: number | null;
    min: number | null;
    max: number | null;
    p95: number | null;
    p99: number | null;
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

    const current = samples[samples.length - 1]!;
    const sorted = [...samples].sort((a, b) => a - b);
    const len = sorted.length;

    return {
        current,
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

function nanosecondsToMilliseconds(value: number): number | null {
    return Number.isFinite(value) ? round(value / 1e6) : null;
}
