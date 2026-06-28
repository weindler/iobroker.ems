/** Runtime-, Status- und Diagnose-States der neuen Batteriearchitektur. */

export const BATTERY_BASE = "addons.battery";

export const BAT = {
	identity: {
		manufacturer: `${BATTERY_BASE}.identity.manufacturer`,
		model: `${BATTERY_BASE}.identity.model`,
		controllerProfile: `${BATTERY_BASE}.identity.controller_profile`,
		capacityNetKwh: `${BATTERY_BASE}.identity.capacity_net_kwh`,
		capacitySource: `${BATTERY_BASE}.identity.capacity_source`,
	},
	telemetry: {
		socPct: `${BATTERY_BASE}.telemetry.soc_pct`,
		powerW: `${BATTERY_BASE}.telemetry.power_w`,
		chargingPowerW: `${BATTERY_BASE}.telemetry.charging_power_w`,
		dischargingPowerW: `${BATTERY_BASE}.telemetry.discharging_power_w`,
		capacityEffectiveKwh: `${BATTERY_BASE}.telemetry.capacity_effective_kwh`,
		operatingMode: `${BATTERY_BASE}.telemetry.operating_mode`,
		online: `${BATTERY_BASE}.telemetry.online`,
		valid: `${BATTERY_BASE}.telemetry.valid`,
		stale: `${BATTERY_BASE}.telemetry.stale`,
		lastUpdate: `${BATTERY_BASE}.telemetry.last_update`,
	},
	status: {
		profile: `${BATTERY_BASE}.status.profile`,
		profileLoaded: `${BATTERY_BASE}.status.profile_loaded`,
		telemetryReady: `${BATTERY_BASE}.status.telemetry_ready`,
		controlReady: `${BATTERY_BASE}.status.control_ready`,
		dryrunReady: `${BATTERY_BASE}.status.dryrun_ready`,
		liveReady: `${BATTERY_BASE}.status.live_ready`,
		effectiveExecutionMode: `${BATTERY_BASE}.status.effective_execution_mode`,
		state: `${BATTERY_BASE}.status.state`,
		reason: `${BATTERY_BASE}.status.reason`,
		fault: `${BATTERY_BASE}.status.fault`,
		lockout: `${BATTERY_BASE}.status.lockout`,
	},
	capabilities: {
		readSoc: `${BATTERY_BASE}.capabilities.read_soc`,
		readPower: `${BATTERY_BASE}.capabilities.read_power`,
		setOperatingMode: `${BATTERY_BASE}.capabilities.set_operating_mode`,
		setChargePower: `${BATTERY_BASE}.capabilities.set_charge_power`,
		setDischargePower: `${BATTERY_BASE}.capabilities.set_discharge_power`,
		controlGridBalance: `${BATTERY_BASE}.capabilities.control_grid_balance`,
		safeRestore: `${BATTERY_BASE}.capabilities.safe_restore`,
		liveControl: `${BATTERY_BASE}.capabilities.live_control`,
	},
	limits: {
		hardwareMaxChargeW: `${BATTERY_BASE}.limits.hardware_max_charge_w`,
		hardwareMaxDischargeW: `${BATTERY_BASE}.limits.hardware_max_discharge_w`,
		hardwareMinSocPct: `${BATTERY_BASE}.limits.hardware_min_soc_pct`,
		hardwareMaxSocPct: `${BATTERY_BASE}.limits.hardware_max_soc_pct`,
		effectiveMaxChargeW: `${BATTERY_BASE}.limits.effective_max_charge_w`,
		effectiveMaxDischargeW: `${BATTERY_BASE}.limits.effective_max_discharge_w`,
		effectiveReason: `${BATTERY_BASE}.limits.effective_reason`,
	},
	runtime: {
		requestId: `${BATTERY_BASE}.runtime.request_id`,
		action: `${BATTERY_BASE}.runtime.action`,
		state: `${BATTERY_BASE}.runtime.state`,
		step: `${BATTERY_BASE}.runtime.step`,
		requestedPowerW: `${BATTERY_BASE}.runtime.requested_power_w`,
		effectivePowerW: `${BATTERY_BASE}.runtime.effective_power_w`,
		targetSocPct: `${BATTERY_BASE}.runtime.target_soc_pct`,
		startedAt: `${BATTERY_BASE}.runtime.started_at`,
		lastTransitionAt: `${BATTERY_BASE}.runtime.last_transition_at`,
		reason: `${BATTERY_BASE}.runtime.reason`,
		ownershipActive: `${BATTERY_BASE}.runtime.ownership_active`,
	},
	dryrun: {
		wouldWrite: `${BATTERY_BASE}.dryrun.would_write`,
		wouldWriteState: `${BATTERY_BASE}.dryrun.would_write_state`,
		wouldWriteValue: `${BATTERY_BASE}.dryrun.would_write_value`,
		sequenceStep: `${BATTERY_BASE}.dryrun.sequence_step`,
		requestedAction: `${BATTERY_BASE}.dryrun.requested_action`,
		requestedPowerW: `${BATTERY_BASE}.dryrun.requested_power_w`,
		effectivePowerW: `${BATTERY_BASE}.dryrun.effective_power_w`,
		wouldRestore: `${BATTERY_BASE}.dryrun.would_restore`,
		reason: `${BATTERY_BASE}.dryrun.reason`,
		updatedAt: `${BATTERY_BASE}.dryrun.updated_at`,
	},
	diagnostics: {
		missingMappings: `${BATTERY_BASE}.diagnostics.missing_mappings`,
		lastWriteState: `${BATTERY_BASE}.diagnostics.last_write_state`,
		lastWriteValue: `${BATTERY_BASE}.diagnostics.last_write_value`,
		lastWriteAt: `${BATTERY_BASE}.diagnostics.last_write_at`,
		lastWriteSuccess: `${BATTERY_BASE}.diagnostics.last_write_success`,
		lastFeedbackAt: `${BATTERY_BASE}.diagnostics.last_feedback_at`,
		expectedFeedback: `${BATTERY_BASE}.diagnostics.expected_feedback`,
		actualFeedback: `${BATTERY_BASE}.diagnostics.actual_feedback`,
		faultCode: `${BATTERY_BASE}.diagnostics.fault_code`,
		faultReason: `${BATTERY_BASE}.diagnostics.fault_reason`,
	},
	control: {
		faultReset: `${BATTERY_BASE}.control.fault_reset`,
	},
} as const;

type Def = { id: string; common: ioBroker.StateCommon; defVal?: ioBroker.StateValue };

const bool = (name: string): ioBroker.StateCommon => ({
	name,
	type: "boolean",
	role: "indicator",
	read: true,
	write: false,
	def: false,
});
const numS = (name: string, unit?: string): ioBroker.StateCommon => ({
	name,
	type: "number",
	role: "value",
	read: true,
	write: false,
	...(unit ? { unit } : {}),
});
const txt = (name: string): ioBroker.StateCommon => ({
	name,
	type: "string",
	role: "text",
	read: true,
	write: false,
});

function batteryStateDefs(): Def[] {
	return [
		{ id: BAT.identity.manufacturer, common: txt("Hersteller"), defVal: "" },
		{ id: BAT.identity.model, common: txt("Modell"), defVal: "" },
		{ id: BAT.identity.controllerProfile, common: txt("Steuerprofil"), defVal: "" },
		{ id: BAT.identity.capacityNetKwh, common: numS("Netto-Kapazität", "kWh") },
		{ id: BAT.identity.capacitySource, common: txt("Kapazitätsquelle"), defVal: "unknown" },

		{ id: BAT.telemetry.socPct, common: numS("SOC", "%") },
		{ id: BAT.telemetry.powerW, common: numS("Batterieleistung (norm.)", "W") },
		{ id: BAT.telemetry.chargingPowerW, common: numS("Ladeleistung", "W") },
		{ id: BAT.telemetry.dischargingPowerW, common: numS("Entladeleistung", "W") },
		{ id: BAT.telemetry.capacityEffectiveKwh, common: numS("Effektive Kapazität", "kWh") },
		{ id: BAT.telemetry.operatingMode, common: txt("Normalisierter Betriebsmodus"), defVal: "unknown" },
		{ id: BAT.telemetry.online, common: bool("Online/Kommunikation") },
		{ id: BAT.telemetry.valid, common: bool("Telemetrie gültig") },
		{ id: BAT.telemetry.stale, common: bool("Telemetrie veraltet") },
		{ id: BAT.telemetry.lastUpdate, common: txt("Telemetrie zuletzt aktualisiert") },

		{ id: BAT.status.profile, common: txt("Profil"), defVal: "" },
		{ id: BAT.status.profileLoaded, common: bool("Profil geladen") },
		{ id: BAT.status.telemetryReady, common: bool("Telemetrie bereit") },
		{ id: BAT.status.controlReady, common: bool("Steuerung bereit") },
		{ id: BAT.status.dryrunReady, common: bool("Dryrun bereit") },
		{ id: BAT.status.liveReady, common: bool("Live bereit") },
		{ id: BAT.status.effectiveExecutionMode, common: txt("Effektiver Ausführungsmodus"), defVal: "dryrun" },
		{ id: BAT.status.state, common: txt("FSM-Zustand"), defVal: "idle" },
		{ id: BAT.status.reason, common: txt("Status-Grund"), defVal: "" },
		{ id: BAT.status.fault, common: bool("Fault") },
		{ id: BAT.status.lockout, common: bool("Lockout") },

		{ id: BAT.capabilities.readSoc, common: bool("Capability read_soc") },
		{ id: BAT.capabilities.readPower, common: bool("Capability read_power") },
		{ id: BAT.capabilities.setOperatingMode, common: bool("Capability set_operating_mode") },
		{ id: BAT.capabilities.setChargePower, common: bool("Capability set_charge_power") },
		{ id: BAT.capabilities.setDischargePower, common: bool("Capability set_discharge_power") },
		{ id: BAT.capabilities.controlGridBalance, common: bool("Capability control_grid_balance") },
		{ id: BAT.capabilities.safeRestore, common: bool("Capability safe_restore") },
		{ id: BAT.capabilities.liveControl, common: bool("Capability live_control") },

		{ id: BAT.limits.hardwareMaxChargeW, common: numS("HW max. Ladeleistung", "W") },
		{ id: BAT.limits.hardwareMaxDischargeW, common: numS("HW max. Entladeleistung", "W") },
		{ id: BAT.limits.hardwareMinSocPct, common: numS("HW Mindest-SOC", "%") },
		{ id: BAT.limits.hardwareMaxSocPct, common: numS("HW Maximal-SOC", "%") },
		{ id: BAT.limits.effectiveMaxChargeW, common: numS("Effektive max. Ladeleistung", "W") },
		{ id: BAT.limits.effectiveMaxDischargeW, common: numS("Effektive max. Entladeleistung", "W") },
		{ id: BAT.limits.effectiveReason, common: txt("Grenzen-Grund"), defVal: "" },

		{ id: BAT.runtime.requestId, common: txt("Request-ID"), defVal: "" },
		{ id: BAT.runtime.action, common: txt("Aktion"), defVal: "" },
		{ id: BAT.runtime.state, common: txt("FSM-Zustand"), defVal: "idle" },
		{ id: BAT.runtime.step, common: txt("FSM-Schritt"), defVal: "" },
		{ id: BAT.runtime.requestedPowerW, common: numS("Angeforderte Leistung", "W") },
		{ id: BAT.runtime.effectivePowerW, common: numS("Effektive Leistung", "W") },
		{ id: BAT.runtime.targetSocPct, common: numS("Ziel-SOC", "%") },
		{ id: BAT.runtime.startedAt, common: txt("Gestartet"), defVal: "" },
		{ id: BAT.runtime.lastTransitionAt, common: txt("Letzter Übergang"), defVal: "" },
		{ id: BAT.runtime.reason, common: txt("Grund"), defVal: "" },
		{ id: BAT.runtime.ownershipActive, common: bool("Ownership aktiv") },

		{ id: BAT.dryrun.wouldWrite, common: bool("Würde schreiben") },
		{ id: BAT.dryrun.wouldWriteState, common: txt("Würde-Write Ziel-State"), defVal: "" },
		{ id: BAT.dryrun.wouldWriteValue, common: numS("Würde-Write Wert") },
		{ id: BAT.dryrun.sequenceStep, common: txt("Sequenz-Schritt"), defVal: "" },
		{ id: BAT.dryrun.requestedAction, common: txt("Angeforderte Aktion"), defVal: "" },
		{ id: BAT.dryrun.requestedPowerW, common: numS("Angeforderte Leistung", "W") },
		{ id: BAT.dryrun.effectivePowerW, common: numS("Effektive Leistung", "W") },
		{ id: BAT.dryrun.wouldRestore, common: bool("Würde Restore ausführen") },
		{ id: BAT.dryrun.reason, common: txt("Grund"), defVal: "" },
		{ id: BAT.dryrun.updatedAt, common: txt("Aktualisiert"), defVal: "" },

		{ id: BAT.diagnostics.missingMappings, common: txt("Fehlende Pflicht-Mappings"), defVal: "" },
		{ id: BAT.diagnostics.lastWriteState, common: txt("Letzter Write Ziel-State"), defVal: "" },
		{ id: BAT.diagnostics.lastWriteValue, common: numS("Letzter Write Wert") },
		{ id: BAT.diagnostics.lastWriteAt, common: txt("Letzter Write"), defVal: "" },
		{ id: BAT.diagnostics.lastWriteSuccess, common: bool("Letzter Write erfolgreich") },
		{ id: BAT.diagnostics.lastFeedbackAt, common: txt("Letzte Rückmeldung"), defVal: "" },
		{ id: BAT.diagnostics.expectedFeedback, common: numS("Erwartete Rückmeldung") },
		{ id: BAT.diagnostics.actualFeedback, common: numS("Tatsächliche Rückmeldung") },
		{ id: BAT.diagnostics.faultCode, common: txt("Fault-Code"), defVal: "" },
		{ id: BAT.diagnostics.faultReason, common: txt("Fault-Grund"), defVal: "" },

		{
			id: BAT.control.faultReset,
			common: {
				name: "Fault/Lockout zurücksetzen",
				type: "boolean",
				role: "button",
				read: true,
				write: true,
				def: false,
			},
			defVal: false,
		},
	];
}

export async function ensureBatteryArchitectureStates(adapter: ioBroker.Adapter): Promise<void> {
	const channels = [
		"identity",
		"telemetry",
		"status",
		"capabilities",
		"limits",
		"runtime",
		"dryrun",
		"diagnostics",
		"control",
	];
	for (const ch of channels) {
		await adapter.setObjectNotExistsAsync(`${BATTERY_BASE}.${ch}`, {
			type: "channel",
			common: { name: `battery ${ch}` },
			native: {},
		} as ioBroker.Object);
	}

	for (const def of batteryStateDefs()) {
		await adapter.setObjectNotExistsAsync(def.id, {
			type: "state",
			common: def.common,
			native: {},
		});
		if (def.defVal !== undefined) {
			const cur = await adapter.getStateAsync(def.id);
			if (cur?.val === undefined || cur.val === null) {
				await adapter.setStateAsync(def.id, { val: def.defVal, ack: true });
			}
		}
	}
}
