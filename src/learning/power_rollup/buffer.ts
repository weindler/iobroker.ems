import { normalizeBatteryPowerW } from "../battery_runtime/history";
import { PLAUSIBLE_W_MAX, PLAUSIBLE_W_MIN } from "../house_load/constants";
import { localHourKey } from "./hour";
import type { HourBuffer, PowerHourlyRecord, PowerRollupMode } from "./types";

function normalizeConsumptionW(raw: number, unit: "W" | "kW"): number | null {
	if (!Number.isFinite(raw)) {
		return null;
	}
	let watts = raw;
	if (unit === "kW") {
		watts = raw * 1000;
	} else if (Math.abs(raw) > 0 && Math.abs(raw) < 100) {
		watts = raw * 1000;
	}
	if (watts < PLAUSIBLE_W_MIN || watts > PLAUSIBLE_W_MAX) {
		return null;
	}
	return Math.round(watts);
}

export function emptyHourBuffer(hourKey: string, rollupMode: PowerRollupMode): HourBuffer {
	return {
		hourKey,
		rollupMode,
		sampleCount: 0,
		chargeSamples: 0,
		dischargeSamples: 0,
		maxChargeW: null,
		maxDischargeW: null,
		sumPowerW: 0,
		lastSampleTs: 0,
	};
}

export function ingestBidirectionalSample(
	buffer: HourBuffer,
	ts: number,
	rawW: number,
	powerInvert: boolean,
): HourBuffer {
	const hourKey = localHourKey(ts);
	let next = buffer;
	if (buffer.hourKey !== hourKey) {
		next = emptyHourBuffer(hourKey, "bidirectional_max");
	}

	const w = normalizeBatteryPowerW(rawW, powerInvert);
	if (w === null) {
		return next;
	}

	const updated: HourBuffer = {
		...next,
		sampleCount: next.sampleCount + 1,
		lastSampleTs: ts,
	};

	if (w > 0) {
		updated.chargeSamples += 1;
		updated.maxChargeW =
			updated.maxChargeW === null ? w : Math.max(updated.maxChargeW, w);
	} else {
		const magnitude = Math.abs(w);
		updated.dischargeSamples += 1;
		updated.maxDischargeW =
			updated.maxDischargeW === null ? magnitude : Math.max(updated.maxDischargeW, magnitude);
	}

	return updated;
}

export function ingestUnidirectionalAvgSample(
	buffer: HourBuffer,
	ts: number,
	rawW: number,
	powerUnit: "W" | "kW",
): HourBuffer {
	const hourKey = localHourKey(ts);
	let next = buffer;
	if (buffer.hourKey !== hourKey) {
		next = emptyHourBuffer(hourKey, "unidirectional_avg");
	}

	const w = normalizeConsumptionW(rawW, powerUnit);
	if (w === null) {
		return next;
	}

	return {
		...next,
		sampleCount: next.sampleCount + 1,
		sumPowerW: next.sumPowerW + w,
		lastSampleTs: ts,
	};
}

export function ingestRollupSample(
	buffer: HourBuffer,
	ts: number,
	rawW: number,
	rollupMode: PowerRollupMode,
	powerInvert: boolean,
	powerUnit: "W" | "kW",
): HourBuffer {
	if (rollupMode === "unidirectional_avg") {
		return ingestUnidirectionalAvgSample(buffer, ts, rawW, powerUnit);
	}
	return ingestBidirectionalSample(buffer, ts, rawW, powerInvert);
}

export function bufferToHourRecord(buffer: HourBuffer): PowerHourlyRecord | null {
	if (buffer.sampleCount === 0) {
		return null;
	}

	if (buffer.rollupMode === "unidirectional_avg") {
		const avgPowerW =
			buffer.sampleCount > 0 ? Math.round(buffer.sumPowerW / buffer.sampleCount) : null;
		return {
			hourKey: buffer.hourKey,
			sampleCount: buffer.sampleCount,
			lastSampleTs: buffer.lastSampleTs,
			chargeSamples: 0,
			dischargeSamples: 0,
			maxChargeW: null,
			maxDischargeW: null,
			sumPowerW: buffer.sumPowerW,
			avgPowerW,
		};
	}

	return {
		hourKey: buffer.hourKey,
		sampleCount: buffer.sampleCount,
		lastSampleTs: buffer.lastSampleTs,
		chargeSamples: buffer.chargeSamples,
		dischargeSamples: buffer.dischargeSamples,
		maxChargeW: buffer.maxChargeW,
		maxDischargeW: buffer.maxDischargeW,
	};
}
