import { PLANNER_SCHEDULE_SLOT_ALIGN_MS } from "./constants";

export interface ScheduleTick {
	kind: "schedule_slot" | "schedule_day" | "schedule_renewal";
	at: Date;
	nextAt: Date;
}

/**
 * Next 15-minute UTC-aligned boundary after `fromMs` (exclusive of exact boundary).
 */
export function nextSlotBoundaryMs(fromMs: number, slotMs = PLANNER_SCHEDULE_SLOT_ALIGN_MS): number {
	return Math.floor(fromMs / slotMs) * slotMs + slotMs;
}

export function localDateKeyUtc(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Deterministic schedule planner: fires on 15-min slot change; marks day change when date key differs.
 */
export class PlannerScheduleTrigger {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;
	private lastDateKey: string;
	private readonly now: () => number;
	private readonly onTick: (tick: ScheduleTick) => void;

	constructor(options: { now?: () => number; onTick: (tick: ScheduleTick) => void; initialMs?: number }) {
		this.now = options.now ?? (() => Date.now());
		this.onTick = options.onTick;
		this.lastDateKey = localDateKeyUtc(options.initialMs ?? this.now());
	}

	start(): void {
		if (this.stopped) return;
		this.arm();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	isStopped(): boolean {
		return this.stopped;
	}

	getNextAtMs(): number | null {
		if (this.stopped) return null;
		return nextSlotBoundaryMs(this.now());
	}

	/** Test helper: fire as if the next boundary was reached. */
	fireForTest(): void {
		if (this.stopped) return;
		this.fire(nextSlotBoundaryMs(this.now()));
	}

	private arm(): void {
		if (this.stopped) return;
		if (this.timer) clearTimeout(this.timer);
		const now = this.now();
		const next = nextSlotBoundaryMs(now);
		const delay = Math.max(1, next - now);
		this.timer = setTimeout(() => {
			this.timer = null;
			this.fire(next);
			this.arm();
		}, delay);
	}

	private fire(atMs: number): void {
		if (this.stopped) return;
		const dateKey = localDateKeyUtc(atMs);
		const kind = dateKey !== this.lastDateKey ? "schedule_day" : "schedule_slot";
		this.lastDateKey = dateKey;
		const nextAt = new Date(nextSlotBoundaryMs(atMs));
		this.onTick({ kind, at: new Date(atMs), nextAt });
	}
}
