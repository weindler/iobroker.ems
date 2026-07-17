import type { PlannerRuntimeMode } from "../planner_config";
import { plannerRuntimeModeAllowsAuto } from "../planner_config";
import { PlannerTriggerAggregator, type AggregatedTriggerRequest } from "./aggregator";
import { matchPlannerTriggerState } from "./catalog";
import { PLANNER_STARTUP_TRIGGER_DELAY_MS } from "./constants";
import { PlannerScheduleTrigger } from "./schedule";
import type { PlannerTriggerEvent } from "./types";

export interface PlannerTriggerSystemOptions {
	mode: PlannerRuntimeMode;
	now?: () => number;
	onRequest: (request: AggregatedTriggerRequest) => void;
	/** When true, fire a one-shot startup trigger after delay (shadow_auto only). */
	enableStartupTrigger?: boolean;
	startupDelayMs?: number;
}

/**
 * Lightweight trigger collector — must not import snapshot / worker / preparation.
 */
export class PlannerTriggerSystem {
	private readonly aggregator: PlannerTriggerAggregator;
	private readonly schedule: PlannerScheduleTrigger | null;
	private readonly mode: PlannerRuntimeMode;
	private startupTimer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;
	private lastAutoRequestAt: string | null = null;
	private nextScheduledAt: string | null = null;
	private lastTriggerClass: string = "";
	private lastCoalescedCount = 0;
	private pending = false;

	constructor(private readonly options: PlannerTriggerSystemOptions) {
		this.mode = options.mode;
		this.aggregator = new PlannerTriggerAggregator({
			now: options.now,
			onFlush: (req) => this.emit(req),
		});
		if (plannerRuntimeModeAllowsAuto(options.mode)) {
			this.schedule = new PlannerScheduleTrigger({
				now: options.now,
				onTick: (tick) => {
					if (this.stopped) return;
					this.nextScheduledAt = tick.nextAt.toISOString();
					this.aggregator.push({
						class: "schedule",
						reasonCode: tick.kind,
						sourceId: `schedule:${tick.kind}`,
						observedAt: tick.at.toISOString(),
					});
				},
			});
		} else {
			this.schedule = null;
		}
	}

	start(): void {
		if (this.stopped) return;
		this.schedule?.start();
		const next = this.schedule?.getNextAtMs();
		this.nextScheduledAt = next ? new Date(next).toISOString() : null;
		if (
			plannerRuntimeModeAllowsAuto(this.mode) &&
			this.options.enableStartupTrigger !== false
		) {
			const delay = this.options.startupDelayMs ?? PLANNER_STARTUP_TRIGGER_DELAY_MS;
			this.startupTimer = setTimeout(() => {
				this.startupTimer = null;
				if (this.stopped) return;
				this.aggregator.flushNow({
					class: "startup",
					reasonCode: "startup",
					sourceId: "startup",
					observedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
				});
			}, delay);
		}
	}

	stop(): void {
		this.stopped = true;
		if (this.startupTimer) {
			clearTimeout(this.startupTimer);
			this.startupTimer = null;
		}
		this.schedule?.stop();
		this.aggregator.stop();
		this.pending = false;
	}

	/**
	 * Observe a relative state change. Returns true if catalog matched (may still be debounced).
	 * Auto triggers ignored unless mode is shadow_auto.
	 */
	observeStateChange(relativeId: string, ack: boolean | undefined): boolean {
		if (this.stopped) return false;
		if (!plannerRuntimeModeAllowsAuto(this.mode)) return false;
		const entry = matchPlannerTriggerState(relativeId, ack);
		if (!entry) return false;
		this.pending = true;
		this.aggregator.push({
			class: entry.class,
			reasonCode: entry.reasonCode,
			sourceId: relativeId,
			observedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
		});
		return true;
	}

	/** Manual path — bypasses auto-mode check (caller enforces manual allowance). */
	requestManual(force: boolean): void {
		if (this.stopped) return;
		const event: PlannerTriggerEvent = {
			class: force ? "manual_force" : "manual",
			reasonCode: force ? "manual_force" : "manual",
			sourceId: force ? "manual_force_trigger" : "manual_trigger",
			observedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
			force,
		};
		this.aggregator.flushNow(event);
	}

	getDiagnostics(): {
		pending: boolean;
		lastAutoRequestAt: string | null;
		nextScheduledAt: string | null;
		lastTriggerClass: string;
		lastCoalescedCount: number;
	} {
		return {
			pending: this.pending || this.aggregator.hasPending(),
			lastAutoRequestAt: this.lastAutoRequestAt,
			nextScheduledAt: this.nextScheduledAt,
			lastTriggerClass: this.lastTriggerClass,
			lastCoalescedCount: this.lastCoalescedCount,
		};
	}

	private emit(request: AggregatedTriggerRequest): void {
		if (this.stopped) return;
		this.pending = false;
		this.lastAutoRequestAt = request.lastObservedAt;
		this.lastTriggerClass = request.primaryClass;
		this.lastCoalescedCount = request.coalescedCount;
		this.options.onRequest(request);
	}
}
