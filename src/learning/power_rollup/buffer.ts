import { normalizeBatteryPowerW } from "../battery_runtime/history";
import { localHourKey } from "./hour";
import type { HourBuffer, PowerHourlyRecord } from "./types";

export function emptyHourBuffer(hourKey: string): HourBuffer {
	return {
		hourKey,
		sampleCount: 0,
		chargeSamples: 0,
		dischargeSamples: 0,
		maxChargeW: null,
		maxDischargeW: null,
		lastSampleTs: 0,
	};
}

export function ingestPowerSample(
	buffer: HourBuffer,
	ts: number,
	rawW: number,
	powerInvert: boolean,
): HourBuffer {
	const hourKey = localHourKey(ts);
	let next = buffer;
	if (buffer.hourKey !== hourKey) {
		next = emptyHourBuffer(hourKey);
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

export function bufferToHourRecord(buffer: HourBuffer): PowerHourlyRecord | null {
	if (buffer.sampleCount === 0) {
		return null;
	}
	return {
		hourKey: buffer.hourKey,
		sampleCount: buffer.sampleCount,
		chargeSamples: buffer.chargeSamples,
		dischargeSamples: buffer.dischargeSamples,
		maxChargeW: buffer.maxChargeW,
		maxDischargeW: buffer.maxDischargeW,
		lastSampleTs: buffer.lastSampleTs,
	};
}
