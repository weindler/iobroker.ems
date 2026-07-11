import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../../ems_light/state_util";
import { WALLBOX_RUNTIME_BASE, WALLBOX_RUNTIME_STATES } from "./states";

function strState(id: string, name: string, def = ""): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function numState(id: string, name: string, def?: number): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, def },
		defaultVal: def,
	};
}

function boolState(id: string, name: string, def = false): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "switch", read: true, write: false, def },
		defaultVal: def,
	};
}

export async function ensureWallboxRuntimeStates(host: StateHost): Promise<void> {
	await ensureChannel(host, WALLBOX_RUNTIME_BASE, "Wallbox Runtime (read-only)");
	const defs: StateDef[] = [
		strState(WALLBOX_RUNTIME_STATES.decisionSource, "Wallbox Entscheidungsquelle", "safe_default"),
		strState(WALLBOX_RUNTIME_STATES.reasonDe, "Wallbox Runtime Begründung (DE)"),
		strState(WALLBOX_RUNTIME_STATES.dailyPlanStatus, "Wallbox Daily-Plan-Status", "daily_plan_missing"),
		boolState(WALLBOX_RUNTIME_STATES.dailyPlanValid, "Wallbox Daily Plan gültig", false),
		numState(WALLBOX_RUNTIME_STATES.dailyPlanRevision, "Wallbox Daily-Plan-Revision", 0),
		strState(WALLBOX_RUNTIME_STATES.dailyPlanSlotStart, "Wallbox Daily-Plan-Slot Start (ISO)"),
		strState(WALLBOX_RUNTIME_STATES.dailyPlanSlotEnd, "Wallbox Daily-Plan-Slot Ende (ISO)"),
		boolState(WALLBOX_RUNTIME_STATES.connected, "Wallbox Fahrzeug verbunden", false),
		boolState(WALLBOX_RUNTIME_STATES.chargingAllowedByPlan, "Wallbox Ladefreigabe laut Plan", false),
		numState(WALLBOX_RUNTIME_STATES.allocatedPowerW, "Wallbox Allocation Leistung W"),
		numState(WALLBOX_RUNTIME_STATES.allocatedEnergyKwh, "Wallbox Allocation Energie kWh"),
		numState(WALLBOX_RUNTIME_STATES.allocatedPvPowerW, "Wallbox Allocation PV-Leistung W"),
		numState(WALLBOX_RUNTIME_STATES.allocatedGridPowerW, "Wallbox Allocation Netz-Leistung W"),
		strState(WALLBOX_RUNTIME_STATES.energySource, "Wallbox Allocation Energiequelle", "none"),
		strState(WALLBOX_RUNTIME_STATES.deadlineIso, "Wallbox Deadline (ISO)"),
		numState(WALLBOX_RUNTIME_STATES.remainingEnergyKwh, "Wallbox Restenergie kWh"),
		numState(WALLBOX_RUNTIME_STATES.plannedEnergyUntilDeadlineKwh, "Wallbox geplante Energie bis Deadline kWh", 0),
		numState(WALLBOX_RUNTIME_STATES.plannedPvEnergyUntilDeadlineKwh, "Wallbox geplante PV-Energie bis Deadline kWh", 0),
		numState(WALLBOX_RUNTIME_STATES.plannedGridEnergyUntilDeadlineKwh, "Wallbox geplante Netz-Energie bis Deadline kWh", 0),
		numState(WALLBOX_RUNTIME_STATES.plannedCostUntilDeadlineCt, "Wallbox geplante Kosten bis Deadline ct"),
		strState(WALLBOX_RUNTIME_STATES.deadlineReachable, "Wallbox Deadline erreichbar", "unknown"),
		strState(WALLBOX_RUNTIME_STATES.firstPlannedSlot, "Wallbox erster geplanter Slot (ISO)"),
		strState(WALLBOX_RUNTIME_STATES.lastPlannedSlot, "Wallbox letzter geplanter Slot (ISO)"),
		numState(WALLBOX_RUNTIME_STATES.activePlannedSlots, "Wallbox aktive geplante Slots", 0),
		numState(WALLBOX_RUNTIME_STATES.maxPlannedPowerW, "Wallbox max. geplante Leistung W", 0),
		numState(WALLBOX_RUNTIME_STATES.minChargePowerW, "Wallbox technische Mindestladeleistung W"),
		numState(WALLBOX_RUNTIME_STATES.maxChargePowerW, "Wallbox technische Maximalleistung W"),
		strState(WALLBOX_RUNTIME_STATES.planExecutionStatus, "Wallbox Plan-/Ist-Status", "unknown"),
		boolState(WALLBOX_RUNTIME_STATES.externalPlanActive, "Wallbox externer EVCC-Plan aktiv", false),
		strState(WALLBOX_RUNTIME_STATES.externalPlanTime, "Wallbox externer EVCC-Planzeit (ISO)"),
		boolState(WALLBOX_RUNTIME_STATES.governanceAllowed, "Wallbox Governance erlaubt", false),
		boolState(WALLBOX_RUNTIME_STATES.runtimeControlAvailable, "Wallbox Runtime-Steuerung verfügbar", false),
		boolState(WALLBOX_RUNTIME_STATES.writeAllowed, "Wallbox Writes erlaubt", false),
		strState(WALLBOX_RUNTIME_STATES.dispatchStatus, "Wallbox Dispatch-Status", "none"),
		strState(WALLBOX_RUNTIME_STATES.dispatchReasonDe, "Wallbox Dispatch-Begründung (DE)"),
		strState(WALLBOX_RUNTIME_STATES.dispatchAction, "Wallbox Dispatch-Aktion", "none"),
		strState(WALLBOX_RUNTIME_STATES.dispatchIntentJson, "Wallbox Dispatch-Intent (JSON)"),
		strState(WALLBOX_RUNTIME_STATES.dispatchTargetJson, "Wallbox Dispatch-Ziel (JSON)"),
		boolState(WALLBOX_RUNTIME_STATES.targetEnabled, "Wallbox Dryrun-Ziel Ladefreigabe", false),
		numState(WALLBOX_RUNTIME_STATES.targetPowerW, "Wallbox Dryrun-Ziel Leistung W", 0),
		numState(WALLBOX_RUNTIME_STATES.targetCurrentA, "Wallbox Dryrun-Ziel Strom A"),
		numState(WALLBOX_RUNTIME_STATES.targetPhases, "Wallbox Dryrun-Ziel Phasen"),
		strState(WALLBOX_RUNTIME_STATES.targetEvccMode, "Wallbox Dryrun-Ziel EVCC-Modus"),
		strState(WALLBOX_RUNTIME_STATES.dispatchSource, "Wallbox Dispatch-Quelle", "safe_default"),
		strState(WALLBOX_RUNTIME_STATES.dispatchValidUntil, "Wallbox Dispatch gültig bis (ISO)"),
		numState(WALLBOX_RUNTIME_STATES.dispatchDailyPlanRevision, "Wallbox Dispatch Daily-Plan-Revision", 0),
		strState(WALLBOX_RUNTIME_STATES.deadlineStatus, "Wallbox Deadline-Status", "unknown"),
		boolState(WALLBOX_RUNTIME_STATES.deadlineRisk, "Wallbox Deadline gefährdet", false),
		boolState(WALLBOX_RUNTIME_STATES.controlMappingComplete, "Wallbox Steuer-Mapping vollständig", false),
		strState(WALLBOX_RUNTIME_STATES.controlMappingMissingJson, "Wallbox fehlende Steuer-Mappings (JSON)", "[]"),
		strState(WALLBOX_RUNTIME_STATES.dryrunCommandJson, "Wallbox Dryrun-Kommandos (JSON)", "[]"),
		strState(WALLBOX_RUNTIME_STATES.commandCandidateJson, "Wallbox Command-Kandidat (JSON)"),
		boolState(WALLBOX_RUNTIME_STATES.commandCandidatePresent, "Wallbox Command-Kandidat vorhanden", false),
		strState(WALLBOX_RUNTIME_STATES.liveFoundationPhase, "Wallbox Live-Foundation Phase (intern, kein globaler Modus)", "observe"),
		boolState(WALLBOX_RUNTIME_STATES.liveWriteReleased, "Wallbox Live-Write freigegeben", false),
		boolState(WALLBOX_RUNTIME_STATES.executionAttempted, "Wallbox externer Geräte-Write versucht", false),
		boolState(WALLBOX_RUNTIME_STATES.executionExecuted, "Wallbox externer Geräte-Write ausgeführt", false),
		strState(WALLBOX_RUNTIME_STATES.executionBlockReason, "Wallbox Execution Blockgrund"),
		boolState(WALLBOX_RUNTIME_STATES.writePlanPresent, "Wallbox Write-Plan vorhanden", false),
		strState(WALLBOX_RUNTIME_STATES.writePlanJson, "Wallbox Write-Plan (JSON)"),
		boolState(WALLBOX_RUNTIME_STATES.writeContractReady, "Wallbox Write Contract ready", false),
		boolState(WALLBOX_RUNTIME_STATES.feedbackContractReady, "Wallbox Feedback Contract ready", false),
		numState(WALLBOX_RUNTIME_STATES.writeOperationCount, "Wallbox Write-Operationen Anzahl", 0),
		strState(WALLBOX_RUNTIME_STATES.writeContractBlockReason, "Wallbox Write Contract Blockgrund"),
		strState(WALLBOX_RUNTIME_STATES.writeControlModel, "Wallbox Steuerungsmodell"),
		boolState(WALLBOX_RUNTIME_STATES.writeEvccPathConfirmed, "Wallbox EVCC-Control-Pfad bestätigt", false),
		strState(WALLBOX_RUNTIME_STATES.writeScenario, "Wallbox Write-Szenario"),
		boolState(WALLBOX_RUNTIME_STATES.writeLiveEligible, "Wallbox Write strukturell live-eligible", false),
		strState(WALLBOX_RUNTIME_STATES.writeControlPathReason, "Wallbox Control-Pfad Begründung"),
		boolState(WALLBOX_RUNTIME_STATES.legacyMappingsPresent, "Wallbox Legacy-Mappings vorhanden", false),
		boolState(WALLBOX_RUNTIME_STATES.evccControlMappingsPresent, "Wallbox EVCC-Control-Mappings vorhanden", false),
		strState(WALLBOX_RUNTIME_STATES.controlMappingDiagnosticsJson, "Wallbox Control-Mapping Diagnose (JSON)", "{}"),
	];
	await ensureStates(host, defs);
}
