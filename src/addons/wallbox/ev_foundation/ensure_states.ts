import { addonStatusBase } from "../../../tree_paths";
import type { StateHost } from "../../../ems_light/state_util";
import { ensureChannel, ensureStates, type StateDef } from "../../../ems_light/state_util";

const EV_FOUNDATION_BASE = `${addonStatusBase("wallbox")}.ev_foundation`;

export const WALLBOX_EV_FOUNDATION_STATES = {
	evccReachable: `${EV_FOUNDATION_BASE}.evcc_reachable`,
	vehicleConnected: `${EV_FOUNDATION_BASE}.vehicle_connected`,
	charging: `${EV_FOUNDATION_BASE}.charging`,
	chargePowerW: `${EV_FOUNDATION_BASE}.charge_power_w`,
	evccMode: `${EV_FOUNDATION_BASE}.evcc_mode`,
	phasesConfigured: `${EV_FOUNDATION_BASE}.phases_configured`,
	phasesActive: `${EV_FOUNDATION_BASE}.phases_active`,
	vehicleSocPct: `${EV_FOUNDATION_BASE}.vehicle_soc_pct`,
	vehicleSocQuality: `${EV_FOUNDATION_BASE}.vehicle_soc_quality`,
	capabilitiesJson: `${EV_FOUNDATION_BASE}.capabilities_json`,
	externalControlActive: `${EV_FOUNDATION_BASE}.external_control_active`,
	externalControlType: `${EV_FOUNDATION_BASE}.external_control_type`,
	externalControlConfigured: `${EV_FOUNDATION_BASE}.external_control_configured`,
	gridRewardsActive: `${EV_FOUNDATION_BASE}.grid_rewards_active`,
	smartChargingActive: `${EV_FOUNDATION_BASE}.smart_charging_active`,
	externalSourceQuality: `${EV_FOUNDATION_BASE}.external_source_quality`,
	externalSourceUpdatedAt: `${EV_FOUNDATION_BASE}.external_source_updated_at`,
	externalSmartPlanMappingConfigured: `${EV_FOUNDATION_BASE}.external_smart_plan_mapping_configured`,
	externalSmartPlanParseable: `${EV_FOUNDATION_BASE}.external_smart_plan_parseable`,
	externalSmartPlanAvailable: `${EV_FOUNDATION_BASE}.external_smart_plan_available`,
	externalSmartPlanSlotCount: `${EV_FOUNDATION_BASE}.external_smart_plan_slot_count`,
	externalSmartPlanNextStart: `${EV_FOUNDATION_BASE}.external_smart_plan_next_start`,
	externalSmartPlanLastEnd: `${EV_FOUNDATION_BASE}.external_smart_plan_last_end`,
	externalPlanRemainingEnergyKwh: `${EV_FOUNDATION_BASE}.external_plan_remaining_energy_kwh`,
	externalPlanRemainingMinutes: `${EV_FOUNDATION_BASE}.external_plan_remaining_minutes`,
	externalPlanDeadlineUsed: `${EV_FOUNDATION_BASE}.external_plan_deadline_used`,
	externalSmartPlanJson: `${EV_FOUNDATION_BASE}.external_smart_plan_json`,
	externalRawDiagnosticsJson: `${EV_FOUNDATION_BASE}.external_raw_diagnostics_json`,
	departureMinSocConfigured: `${EV_FOUNDATION_BASE}.departure_min_soc_configured`,
	externalMinSocPct: `${EV_FOUNDATION_BASE}.external_min_soc_pct`,
	externalMinSocQuality: `${EV_FOUNDATION_BASE}.external_min_soc_quality`,
	vehicleModelSource: `${EV_FOUNDATION_BASE}.vehicle_model_source`,
	vehicleModelReady: `${EV_FOUNDATION_BASE}.vehicle_model_ready`,
	controlContractModel: `${EV_FOUNDATION_BASE}.control_contract_model`,
	evccControlContractReady: `${EV_FOUNDATION_BASE}.evcc_control_contract_ready`,
	legacyDirectControlPresent: `${EV_FOUNDATION_BASE}.legacy_direct_control_present`,
	evccModeControlVariant: `${EV_FOUNDATION_BASE}.evcc_mode_control_variant`,
	evccModeFeedbackState: `${EV_FOUNDATION_BASE}.evcc_mode_feedback_state`,
	evccModeButtonsReady: `${EV_FOUNDATION_BASE}.evcc_mode_buttons_ready`,
	evccModeOffTargetReady: `${EV_FOUNDATION_BASE}.evcc_mode_off_target_ready`,
	evccModePvTargetReady: `${EV_FOUNDATION_BASE}.evcc_mode_pv_target_ready`,
	evccModeMinTargetReady: `${EV_FOUNDATION_BASE}.evcc_mode_min_target_ready`,
	evccModeNowTargetReady: `${EV_FOUNDATION_BASE}.evcc_mode_now_target_ready`,
	preparedEvState: `${EV_FOUNDATION_BASE}.prepared_ev_state`,
	takeoverReason: `${EV_FOUNDATION_BASE}.takeover_reason`,
	dataQuality: `${EV_FOUNDATION_BASE}.data_quality`,
	modelJson: `${EV_FOUNDATION_BASE}.model_json`,
	updatedAt: `${EV_FOUNDATION_BASE}.updated_at`,
} as const;

function boolState(id: string, name: string): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "state", read: true, write: false },
	};
}

function numState(id: string, name: string, unit?: string): StateDef {
	return {
		id,
		common: {
			name,
			type: "number",
			role: unit === "W" ? "value.power" : "value",
			unit,
			read: true,
			write: false,
		},
	};
}

function strState(id: string, name: string, role = "text"): StateDef {
	return {
		id,
		common: { name, type: "string", role, read: true, write: false },
	};
}

export async function ensureWallboxEvFoundationStates(host: StateHost): Promise<void> {
	await ensureChannel(host, EV_FOUNDATION_BASE, "EV-Fundament (Diagnose)");
	await ensureStates(host, [
		boolState(WALLBOX_EV_FOUNDATION_STATES.evccReachable, "EVCC erreichbar"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.vehicleConnected, "Fahrzeug verbunden"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.charging, "Fahrzeug lädt"),
		numState(WALLBOX_EV_FOUNDATION_STATES.chargePowerW, "Reale Ladeleistung", "W"),
		strState(WALLBOX_EV_FOUNDATION_STATES.evccMode, "Aktueller EVCC-Modus"),
		numState(WALLBOX_EV_FOUNDATION_STATES.phasesConfigured, "Konfigurierte Phasen"),
		numState(WALLBOX_EV_FOUNDATION_STATES.phasesActive, "Aktive Phasen"),
		numState(WALLBOX_EV_FOUNDATION_STATES.vehicleSocPct, "Fahrzeug-SOC", "%"),
		strState(WALLBOX_EV_FOUNDATION_STATES.vehicleSocQuality, "Fahrzeug-SOC Qualität"),
		strState(WALLBOX_EV_FOUNDATION_STATES.capabilitiesJson, "EV Capabilities (JSON)", "json"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.externalControlConfigured, "Externe Steuerung konfiguriert"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.externalControlActive, "Externe Steuerung aktiv"),
		strState(WALLBOX_EV_FOUNDATION_STATES.externalControlType, "Externer Steuerungstyp"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.gridRewardsActive, "Grid Rewards aktiv"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.smartChargingActive, "Smart Charging aktiv"),
		strState(WALLBOX_EV_FOUNDATION_STATES.externalSourceQuality, "Externe Quellenqualität"),
		strState(WALLBOX_EV_FOUNDATION_STATES.externalSourceUpdatedAt, "Externe Quelle zuletzt", "date"),
		boolState(
			WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanMappingConfigured,
			"Smart-Plan-Mapping konfiguriert",
		),
		boolState(WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanParseable, "Smart-Plan parsebar"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanAvailable, "Externer Smart-Plan verfügbar"),
		numState(WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanSlotCount, "Smart-Plan gültige Slots"),
		strState(WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanNextStart, "Nächster Smart-Plan-Start", "date"),
		strState(WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanLastEnd, "Letztes Smart-Plan-Ende", "date"),
		numState(
			WALLBOX_EV_FOUNDATION_STATES.externalPlanRemainingEnergyKwh,
			"Verbleibende externe Planenergie",
			"kWh",
		),
		numState(WALLBOX_EV_FOUNDATION_STATES.externalPlanRemainingMinutes, "Verbleibende Planminuten", "min"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.externalPlanDeadlineUsed, "Departure-Deadline angewandt"),
		strState(WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanJson, "Smart-Plan Slots (JSON)", "json"),
		strState(WALLBOX_EV_FOUNDATION_STATES.externalRawDiagnosticsJson, "Externe Rohdiagnose (JSON)", "json"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.departureMinSocConfigured, "Mindest-SOC zur Abfahrt konfiguriert"),
		numState(WALLBOX_EV_FOUNDATION_STATES.externalMinSocPct, "Externer Smart-Charging-Mindest-SOC", "%"),
		strState(WALLBOX_EV_FOUNDATION_STATES.externalMinSocQuality, "Externer Mindest-SOC Qualität"),
		strState(WALLBOX_EV_FOUNDATION_STATES.vehicleModelSource, "Fahrzeugmodell-Quelle"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.vehicleModelReady, "Fahrzeugmodell bereit"),
		strState(WALLBOX_EV_FOUNDATION_STATES.controlContractModel, "Control-Contract-Modell"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.evccControlContractReady, "EVCC-Control-Contract bereit"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.legacyDirectControlPresent, "Legacy-Direktsteuerung vorhanden"),
		strState(WALLBOX_EV_FOUNDATION_STATES.evccModeControlVariant, "EVCC Mode-Control-Variante"),
		strState(WALLBOX_EV_FOUNDATION_STATES.evccModeFeedbackState, "EVCC Mode-Feedback-State"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.evccModeButtonsReady, "EVCC Mode-Buttons bereit"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.evccModeOffTargetReady, "EVCC control.off gemappt"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.evccModePvTargetReady, "EVCC control.pv gemappt"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.evccModeMinTargetReady, "EVCC control.min gemappt"),
		boolState(WALLBOX_EV_FOUNDATION_STATES.evccModeNowTargetReady, "EVCC control.now gemappt"),
		strState(WALLBOX_EV_FOUNDATION_STATES.preparedEvState, "Vorbereiteter EV-Zustand"),
		strState(WALLBOX_EV_FOUNDATION_STATES.takeoverReason, "Takeover-Grund (vorbereitet)"),
		strState(WALLBOX_EV_FOUNDATION_STATES.dataQuality, "EV-Datenqualität"),
		strState(WALLBOX_EV_FOUNDATION_STATES.modelJson, "EV-Datenmodell V1 (JSON)", "json"),
		strState(WALLBOX_EV_FOUNDATION_STATES.updatedAt, "EV-Fundament zuletzt gelesen", "date"),
	]);
}
