import { EMS_MIRROR_BATTERY } from "./ems_mirror";
import { computeGridBalanceTarget, resolveController } from "./grid_balance";
import { writeBatteryGridBalanceDryrun } from "./dryrun_mirror";
import {
	batteryProfileFromConfig,
	featureGridBalanceFromConfig,
	gridBalanceOffsetsFromConfig,
} from "./mapping_config";
import { readBool, readMappedRole, readNumber, mappedTargetId, writeForeignIfLive } from "./io";
import { isGridBalancePaused, isModeSequenceRunning } from "./mode_orchestrator";
import { ensureOperatingMode, SONNEN_OPERATING_MODE_AUTO, SONNEN_OPERATING_MODE_MANUAL } from "./mode_control";

export const BATTERY_LIVE_WRITES_ENABLED = false;

const ADDON_ID = "battery";

export type BatteryTickHost = ioBroker.Adapter & {
	config: unknown;
};

let lastController: string = "idle";

export async function runGridBalanceOnConsumptionChange(
	adapter: BatteryTickHost,
	trigger: "consumption_change" | "startup",
): Promise<void> {
	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};

	if (batteryProfileFromConfig(cfg) !== "sonnen") {
		return;
	}

	if (isModeSequenceRunning()) {
		return;
	}

	const addonEn = await readBool(adapter, `addons.${ADDON_ID}.enabled`);
	const adapterFeature = featureGridBalanceFromConfig(cfg);
	const emsGb = await readBool(adapter, EMS_MIRROR_BATTERY.gridBalanceEnabled);
	const batteryIntentActive = await readBool(adapter, EMS_MIRROR_BATTERY.batteryIntentActive);
	const snowCover = await readBool(adapter, EMS_MIRROR_BATTERY.snowCoverSuspected);
	const effectiveRestKwh = (await readNumber(adapter, EMS_MIRROR_BATTERY.effectivePvRestOfDayKwh)) ?? 0;
	const capacityWh = (await readNumber(adapter, EMS_MIRROR_BATTERY.capacityWh)) ?? 0;

	const gbPaused = isGridBalancePaused();

	const controller = resolveController({
		emsBatteryIntentActive: batteryIntentActive,
		emsGridBalanceEnabled: emsGb,
		adapterFeatureEnabled: adapterFeature,
		batteryAddonEnabled: addonEn,
		gridBalancePaused: gbPaused,
	});

	const offsets = gridBalanceOffsetsFromConfig(cfg);
	const consumptionW = (await readMappedRole(adapter, "consumption_w")) ?? 0;
	const pvAcPowerW = (await readMappedRole(adapter, "pv_ac_power_w")) ?? 0;
	const socPct = await readMappedRole(adapter, "soc_pct");

	const result = computeGridBalanceTarget({
		effectiveRestOfDayKwh: effectiveRestKwh,
		capacityWh,
		snowCoverSuspected: snowCover,
		consumptionW,
		pvAcPowerW,
		socPct,
		emsGridBalanceEnabled: emsGb,
		adapterFeatureEnabled: adapterFeature,
		controller,
		...offsets,
	});

	const chargeMap = await mappedTargetId(adapter, "battery_charging_w");
	const ts = new Date().toISOString();

	await adapter.setStateAsync("status.battery.controller", { val: controller, ack: true });
	await adapter.setStateAsync("status.battery.grid_balance_enabled", {
		val: emsGb && adapterFeature,
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
		targetStateId: chargeMap.targetId,
		trigger,
	});

	const live = BATTERY_LIVE_WRITES_ENABLED;

	if (controller === "grid_balance" && result.gatePassed && chargeMap.targetId && !gbPaused) {
		await ensureOperatingMode(adapter, SONNEN_OPERATING_MODE_MANUAL, live);
		const wrote = await writeForeignIfLive(
			adapter,
			chargeMap.targetId,
			result.targetBatteryChargingW,
			live,
		);
		if (wrote) {
			adapter.log.info(
				`battery grid_balance LIVE (${trigger}) → ${result.targetBatteryChargingW} W`,
			);
		} else {
			adapter.log.debug(
				`battery grid_balance dryrun (${trigger}): ${result.targetBatteryChargingW} W → ${chargeMap.targetId}`,
			);
		}
	} else if (lastController === "grid_balance" && controller === "idle") {
		await ensureOperatingMode(adapter, SONNEN_OPERATING_MODE_AUTO, live);
	}

	lastController = controller;
}
