import { msSinceEmsActivity } from "./ems_activity";

export type FailsafeTimeouts = {
	emsUnreachableTimeoutSec: number;
	verificationTimeoutSec: number;
	failsafeCheckIntervalSec: number;
};

export function failsafeTimeoutsFromConfig(
	config: Record<string, unknown>,
	prefix: string,
): FailsafeTimeouts {
	const globalEms = Number(config.global_ems_unreachable_timeout_sec);
	const globalVer = Number(config.global_verification_timeout_sec);
	const globalCheck = Number(config.global_failsafe_check_interval_sec);

	const ems = Number(config[`${prefix}_ems_unreachable_timeout_sec`]);
	const ver = Number(config[`${prefix}_verification_timeout_sec`]);
	const check = Number(config[`${prefix}_failsafe_check_interval_sec`]);

	const pick = (specific: number, global: number, def: number, min: number, max: number): number => {
		const v = Number.isFinite(specific) && specific > 0 ? specific : Number.isFinite(global) && global > 0 ? global : def;
		return Math.min(max, Math.max(min, v));
	};

	return {
		emsUnreachableTimeoutSec: pick(ems, globalEms, 300, 60, 900),
		verificationTimeoutSec: pick(ver, globalVer, 300, 60, 900),
		failsafeCheckIntervalSec: pick(check, globalCheck, 30, 10, 120),
	};
}

export function isEmsUnreachable(config: Record<string, unknown>, prefix: string): boolean {
	const { emsUnreachableTimeoutSec } = failsafeTimeoutsFromConfig(config, prefix);
	return msSinceEmsActivity() >= emsUnreachableTimeoutSec * 1000;
}

export async function setEdgeBool(
	adapter: ioBroker.Adapter,
	stateId: string,
	value: boolean,
): Promise<void> {
	const cur = await adapter.getStateAsync(stateId);
	if (cur?.val === value) {
		return;
	}
	await adapter.setStateAsync(stateId, { val: value, ack: true });
}

export async function readForeignNumber(adapter: ioBroker.Adapter, stateId: string): Promise<number | null> {
	const id = stateId?.trim();
	if (!id) return null;
	try {
		const st = await adapter.getForeignStateAsync(id);
		if (st?.val == null) return null;
		const n = Number(st.val);
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

export async function readForeignBool(adapter: ioBroker.Adapter, stateId: string): Promise<boolean | null> {
	const id = stateId?.trim();
	if (!id) return null;
	try {
		const st = await adapter.getForeignStateAsync(id);
		if (st?.val === true || st?.val === 1 || st?.val === "1" || st?.val === "true") return true;
		if (st?.val === false || st?.val === 0 || st?.val === "0" || st?.val === "false") return false;
		return null;
	} catch {
		return null;
	}
}
