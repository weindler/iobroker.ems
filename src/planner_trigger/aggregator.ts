import {
	PLANNER_TRIGGER_DEBOUNCE_MS,
	PLANNER_TRIGGER_MAX_DELAY_MS,
	PLANNER_TRIGGER_MIN_INTERVAL_MS,
} from "./constants";
import type { PlannerTriggerClass, PlannerTriggerEvent, PlannerTriggerReasonCode } from "./types";

export interface AggregatedTriggerRequest {
	reasonCode: PlannerTriggerReasonCode;
	primaryClass: PlannerTriggerClass;
	classes: PlannerTriggerClass[];
	coalescedCount: number;
	force: boolean;
	firstObservedAt: string;
	lastObservedAt: string;
	sourceIds: string[];
}

export interface TriggerAggregatorOptions {
	debounceMs?: number;
	minIntervalMs?: number;
	maxDelayMs?: number;
	now?: () => number;
	onFlush: (request: AggregatedTriggerRequest) => void;
}

/**
 * Deterministic debounce + coalesce for automatic triggers.
 * At most one pending flush. Force is sticky. Timers cleared on stop.
 */
export class PlannerTriggerAggregator {
	private readonly debounceMs: number;
	private readonly minIntervalMs: number;
	private readonly maxDelayMs: number;
	private readonly now: () => number;
	private readonly onFlush: (request: AggregatedTriggerRequest) => void;

	private pending: AggregatedTriggerRequest | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private maxDelayTimer: ReturnType<typeof setTimeout> | null = null;
	private lastFlushAt = 0;
	private stopped = false;

	constructor(options: TriggerAggregatorOptions) {
		this.debounceMs = options.debounceMs ?? PLANNER_TRIGGER_DEBOUNCE_MS;
		this.minIntervalMs = options.minIntervalMs ?? PLANNER_TRIGGER_MIN_INTERVAL_MS;
		this.maxDelayMs = options.maxDelayMs ?? PLANNER_TRIGGER_MAX_DELAY_MS;
		this.now = options.now ?? (() => Date.now());
		this.onFlush = options.onFlush;
	}

	push(event: PlannerTriggerEvent): void {
		if (this.stopped) return;
		if (!this.pending) {
			this.pending = {
				reasonCode: event.reasonCode,
				primaryClass: event.class,
				classes: [event.class],
				coalescedCount: 1,
				force: event.force === true,
				firstObservedAt: event.observedAt,
				lastObservedAt: event.observedAt,
				sourceIds: [event.sourceId],
			};
			this.armMaxDelay();
		} else {
			this.pending.coalescedCount += 1;
			this.pending.force = Boolean(this.pending.force || event.force);
			this.pending.lastObservedAt = event.observedAt;
			if (!this.pending.classes.includes(event.class)) {
				this.pending.classes.push(event.class);
			}
			if (this.pending.sourceIds.length < 8 && !this.pending.sourceIds.includes(event.sourceId)) {
				this.pending.sourceIds.push(event.sourceId);
			}
			// Prefer higher-signal reason codes for diagnostics
			this.pending.reasonCode = preferReason(this.pending.reasonCode, event.reasonCode);
			this.pending.primaryClass = preferClass(this.pending.primaryClass, event.class);
		}
		this.armDebounce();
	}

	/** Immediate flush (manual / force / startup) — bypasses debounce but respects stop. */
	flushNow(event?: PlannerTriggerEvent): AggregatedTriggerRequest | null {
		if (this.stopped) return null;
		if (event) {
			this.push(event);
		}
		return this.flushPending(true);
	}

	stop(): void {
		this.stopped = true;
		this.clearTimers();
		this.pending = null;
	}

	isStopped(): boolean {
		return this.stopped;
	}

	hasPending(): boolean {
		return this.pending !== null;
	}

	getPendingForTest(): AggregatedTriggerRequest | null {
		return this.pending ? { ...this.pending, classes: [...this.pending.classes], sourceIds: [...this.pending.sourceIds] } : null;
	}

	private armDebounce(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.flushPending(false);
		}, this.debounceMs);
	}

	private armMaxDelay(): void {
		if (this.maxDelayTimer) return;
		this.maxDelayTimer = setTimeout(() => {
			this.maxDelayTimer = null;
			this.flushPending(false);
		}, this.maxDelayMs);
	}

	private flushPending(ignoreMinInterval: boolean): AggregatedTriggerRequest | null {
		if (this.stopped || !this.pending) return null;
		const now = this.now();
		if (!ignoreMinInterval && !this.pending.force && this.lastFlushAt > 0) {
			const elapsed = now - this.lastFlushAt;
			if (elapsed < this.minIntervalMs) {
				const wait = this.minIntervalMs - elapsed;
				this.clearDebounceOnly();
				this.debounceTimer = setTimeout(() => {
					this.debounceTimer = null;
					this.flushPending(false);
				}, wait);
				return null;
			}
		}
		const request = this.pending;
		this.pending = null;
		this.clearTimers();
		this.lastFlushAt = now;
		this.onFlush(request);
		return request;
	}

	private clearDebounceOnly(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private clearTimers(): void {
		this.clearDebounceOnly();
		if (this.maxDelayTimer) {
			clearTimeout(this.maxDelayTimer);
			this.maxDelayTimer = null;
		}
	}
}

const REASON_RANK: Record<PlannerTriggerReasonCode, number> = {
	manual_force: 100,
	manual: 90,
	startup: 80,
	config_change: 70,
	mapping_change: 65,
	constraint_change: 60,
	price_change: 55,
	forecast_change: 50,
	learning_change: 45,
	schedule_day: 40,
	schedule_renewal: 35,
	schedule_slot: 30,
	telemetry_change: 20,
	relevant_change: 10,
};

const CLASS_RANK: Record<PlannerTriggerClass, number> = {
	manual_force: 100,
	manual: 90,
	startup: 80,
	configuration: 70,
	mapping: 65,
	constraint: 60,
	price: 55,
	forecast: 50,
	learning: 45,
	schedule: 40,
	telemetry: 20,
};

function preferReason(a: PlannerTriggerReasonCode, b: PlannerTriggerReasonCode): PlannerTriggerReasonCode {
	return REASON_RANK[b] > REASON_RANK[a] ? b : a;
}

function preferClass(a: PlannerTriggerClass, b: PlannerTriggerClass): PlannerTriggerClass {
	return CLASS_RANK[b] > CLASS_RANK[a] ? b : a;
}
