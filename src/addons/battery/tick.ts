import { EMS_MIRROR_BATTERY } from "./ems_mirror";
import { computeGridBalanceTarget, resolveController } from "./grid_balance";
import { writeBatteryGridBalanceDryrun } from "./dryrun_mirror";
import type { BatterySonnenMappingRole } from "./mapping_config";
import {
	activeMonthsFromConfig,
	batteryProfileFromConfig,
	capacityWhFromConfig,
} from "./mapping_config";

export const BATTERY_LIVE_WRITES_ENABLED = false;

const ADDON_ID = "battery";

export type BatteryTickHost = ioBroker.Adapter & {
	config: unknown;
};

async function readBool(adapter: BatteryTickHost, relativeId: string): Promise<boolean> {
	const st = await adapter.getStateAsync(relativeId);
	return st?.val === true;
}

async function readNumber(adapter: BatteryTickHost, relativeId: string): Promise<number | null> {
	const st = await adapter.getStateAsync(relativeId);
	if (st?.val == null) return null;
	const n = Number(st.val);
	return Number.isFinite(n) ? n : null;
}

async function readForeignNumber(adapter: BatteryTickHost, stateId: string): Promise<number | null> {
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

async function readMappedRole(
	adapter: BatteryTickHost,
	role: BatterySonnenMappingRole,
): Promise<number | null> {
	const base = `mapping.${ADDON_ID}.${role}`;
	const en = await adapter.getStateAsync(`${base}.enabled`);
	if (en?.val === false) return null;
	const ts = await adapter.getStateAsync(`${base}.target_state`);
	const targetId = typeof ts?.val === "string" ? ts.val.trim() : "";
	return readForeignNumber(adapter, targetId);
}

async function mappedWriteTargetId(adapter: BatteryTickHost): Promise<string> {
	const ts = await adapter.getStateAsync(`mapping.${ADDON_ID}.battery_charging_w.target_state`);
	return typeof ts?.val === "string" ? ts.val.trim() : "";
}

export async function runBatteryGridBalanceTick(adapter: BatteryTickHost): Promise<void> {
	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};

	const profile = batteryProfileFromConfig(cfg);
	if (profile !== "sonnen") {
		adapter.log.debug(`battery tick: profile=${profile} — no handler yet`);
		return;
	}

	const addonEn = await readBool(adapter, `addons.${ADDON_ID}.enabled`);
	const gridBalanceEnabled = await readBool(adapter, EMS_MIRROR_BATTERY.gridBalanceEnabled);
	const batteryIntentActive = await readBool(adapter, EMS_MIRROR_BATTERY.batteryIntentActive);
	const snowCover = await readBool(adapter, EMS_MIRROR_BATTERY.snowCoverSuspected);
	const effectiveRestKwh = (await readNumber(adapter, EMS_MIRROR_BATTERY.effectivePvRestOfDayKwh)) ?? 0;

	const controller = resolveController({
		emsBatteryIntentActive: batteryIntentActive,
		gridBalanceEnabled,
		batteryAddonEnabled: addonEn,
	});

	const month = new Date().getMonth() + 1;
	const activeMonths = activeMonthsFromConfig(cfg);
	let capacityWh = capacityWhFromConfig(cfg);
	if (capacityWh == null) {
		capacityWh = (await readMappedRole(adapter, "capacity_wh")) ?? 0;
	}

	const consumptionW = (await readMappedRole(adapter, "consumption_w")) ?? 0;
	const pvAcPowerW = (await readMappedRole(adapter, "pv_ac_power_w")) ?? 0;
	const socPct = await readMappedRole(adapter, "soc_pct");

	const result = computeGridBalanceTarget({
		month,
		activeMonths,
		effectiveRestOfDayKwh: effectiveRestKwh,
		capacityWh,
		snowCoverSuspected: snowCover,
		consumptionW,
		pvAcPowerW,
		socPct,
		gridBalanceEnabled,
		controller,
	});

	const writeTargetId = await mappedWriteTargetId(adapter);
	const ts = new Date().toISOString();

	await adapter.setStateAsync("status.battery.controller", { val: controller, ack: true });
	await adapter.setStateAsync("status.battery.grid_balance_enabled", {
		val: gridBalanceEnabled,
		ack: true,
	});
	await adapter.setStateAsync("status.battery.updated_at", { val: ts, ack: true });

	await writeBatteryGridBalanceDryrun(adapter, {
		controller,
		result,
		consumptionW,
		pvAcPowerW,
		socPct,
		effectiveRestKwh,
		targetStateId: writeTargetId,
	});

	if (result.gatePassed && writeTargetId && BATTERY_LIVE_WRITES_ENABLED) {
		await adapter.setForeignStateAsync(writeTargetId, {
			val: result.targetBatteryChargingW,
			ack: true,
		});
		adapter.log.info(
			`battery grid_balance LIVE → ${writeTargetId} = ${result.targetBatteryChargingW} W`,
		);
	} else if (result.gatePassed && writeTargetId) {
		adapter.log.debug(
			`battery grid_balance dryrun: would write ${result.targetBatteryChargingW} W → ${writeTargetId}`,
		);
	}
}
