import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	assertAllowedPlannerJsonPath,
	HOUSE_LOAD_LEARNING_FILE,
	THERMAL_RUNTIME_LEARNING_FILE,
} from "./allowed_paths";
import { plannerRelevantConfigFromHost } from "./config_from_adapter";
import { CONSUMER_STATS_FILENAME } from "../learning/consumer_stats/types";
import type { SnapshotStateValue } from "./types";
import type { PlannerRelevantConfig, PlannerSnapshotSource } from "./source";

export interface PlannerSnapshotIoBrokerHost {
	getStateAsync(id: string): Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?(id: string): Promise<ioBroker.State | null | undefined>;
	config: unknown;
	getAbsolutePath?: (category?: string) => string;
}

export type PlannerSnapshotClock = () => Date;

function observedAtFromState(st: ioBroker.State): string | null {
	const ts = st.ts;
	if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
		return new Date(ts).toISOString();
	}
	if (typeof st.lc === "number" && Number.isFinite(st.lc) && st.lc > 0) {
		return new Date(st.lc).toISOString();
	}
	return null;
}

/** Maps ioBroker state objects to SnapshotStateValue without coercing 0/false/"". */
export function normalizeIoBrokerState(st: ioBroker.State | null | undefined): SnapshotStateValue {
	if (!st || st.val === undefined) {
		return { value: null };
	}
	const observedAt = observedAtFromState(st);
	const base = observedAt ? { observedAt } : {};

	if (st.val === null) {
		return { value: null, ...base };
	}
	if (typeof st.val === "boolean") {
		return { value: st.val, ...base };
	}
	if (typeof st.val === "number") {
		return { value: Number.isFinite(st.val) ? st.val : null, ...base };
	}
	return { value: String(st.val), ...base };
}

export class IoBrokerPlannerSnapshotSource implements PlannerSnapshotSource {
	constructor(
		private readonly host: PlannerSnapshotIoBrokerHost,
		private readonly clock: PlannerSnapshotClock = () => new Date(),
	) {}

	now(): Date {
		return this.clock();
	}

	async readState(id: string): Promise<SnapshotStateValue> {
		try {
			const st = await this.host.getStateAsync(id);
			return normalizeIoBrokerState(st);
		} catch (e) {
			throw new Error(`readState failed for ${id}: ${String(e)}`);
		}
	}

	async readForeignState(id: string): Promise<SnapshotStateValue> {
		if (!this.host.getForeignStateAsync) {
			return { value: null };
		}
		try {
			const st = await this.host.getForeignStateAsync(id);
			return normalizeIoBrokerState(st);
		} catch (e) {
			throw new Error(`readForeignState failed for ${id}: ${String(e)}`);
		}
	}

	async readConfig(): Promise<PlannerRelevantConfig> {
		return plannerRelevantConfigFromHost(this.host);
	}

	async readJsonFile<T>(absolutePath: string): Promise<T | null> {
		const resolved = path.resolve(absolutePath);
		const getPath = this.host.getAbsolutePath;
		if (!getPath) {
			throw new Error("getAbsolutePath unavailable for planner snapshot file read");
		}

		const allowedNames = new Set([
			HOUSE_LOAD_LEARNING_FILE,
			THERMAL_RUNTIME_LEARNING_FILE,
			CONSUMER_STATS_FILENAME,
		]);
		if (!allowedNames.has(path.basename(resolved))) {
			throw new Error("planner snapshot file name not allowed");
		}
		assertAllowedPlannerJsonPath(resolved, (category) => getPath(category)!);

		try {
			const raw = await fs.readFile(resolved, "utf8");
			return JSON.parse(raw) as T;
		} catch (e) {
			const err = e as NodeJS.ErrnoException;
			if (err.code === "ENOENT") {
				return null;
			}
			throw new Error(`invalid planner snapshot JSON at ${path.basename(resolved)}: ${String(e)}`);
		}
	}
}
