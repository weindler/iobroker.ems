import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../../ems_light/state_util";

function strState(id: string, name: string, def?: string): StateDef {
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

export const FLEXIBLE_CONTRIBUTIONS_STATE_IDS = {
	status: "planner.intent.contributions.flexible.status",
	generatedAt: "planner.intent.contributions.flexible.generated_at",
	contributionsJson: "planner.intent.contributions.flexible.contributions_json",
	activeJson: "planner.intent.contributions.flexible.active_json",
	excludedJson: "planner.intent.contributions.flexible.excluded_json",
	reasonDe: "planner.intent.contributions.flexible.reason_de",
	revision: "planner.intent.contributions.flexible.revision",
} as const;

export const FLEXIBLE_ADDON_STATE_IDS = {
	battery: {
		status: "planner.intent.contributions.battery.status",
		contributionsJson: "planner.intent.contributions.battery.contributions_json",
		reasonDe: "planner.intent.contributions.battery.reason_de",
		revision: "planner.intent.contributions.battery.revision",
	},
	wallbox: {
		status: "planner.intent.contributions.wallbox.status",
		contributionsJson: "planner.intent.contributions.wallbox.contributions_json",
		reasonDe: "planner.intent.contributions.wallbox.reason_de",
		revision: "planner.intent.contributions.wallbox.revision",
	},
	immersion_heater: {
		status: "planner.intent.contributions.immersion_heater.status",
		contributionsJson: "planner.intent.contributions.immersion_heater.contributions_json",
		reasonDe: "planner.intent.contributions.immersion_heater.reason_de",
		revision: "planner.intent.contributions.immersion_heater.revision",
	},
	air_conditioning: {
		status: "planner.intent.contributions.air_conditioning.status",
		contributionsJson: "planner.intent.contributions.air_conditioning.contributions_json",
		reasonDe: "planner.intent.contributions.air_conditioning.reason_de",
		revision: "planner.intent.contributions.air_conditioning.revision",
	},
} as const;

export async function ensureFlexibleContributionStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "planner.intent.contributions", "Planner Contributions");
	await ensureChannel(host, "planner.intent.contributions.flexible", "Planner Flexible Contributions");

	const defs: StateDef[] = [
		strState(FLEXIBLE_CONTRIBUTIONS_STATE_IDS.status, "Flexible Contributions Status", "not_initialized"),
		strState(FLEXIBLE_CONTRIBUTIONS_STATE_IDS.generatedAt, "Flexible Contributions erzeugt (ISO)"),
		strState(FLEXIBLE_CONTRIBUTIONS_STATE_IDS.contributionsJson, "Flexible Contributions (JSON)", "[]"),
		strState(FLEXIBLE_CONTRIBUTIONS_STATE_IDS.activeJson, "Flexible Contributions aktiv (JSON)", "[]"),
		strState(FLEXIBLE_CONTRIBUTIONS_STATE_IDS.excludedJson, "Flexible Contributions ausgeschlossen (JSON)", "[]"),
		strState(FLEXIBLE_CONTRIBUTIONS_STATE_IDS.reasonDe, "Flexible Contributions Begründung (DE)", ""),
		numState(FLEXIBLE_CONTRIBUTIONS_STATE_IDS.revision, "Flexible Contributions Revision", 0),
	];

	for (const [addon, ids] of Object.entries(FLEXIBLE_ADDON_STATE_IDS)) {
		await ensureChannel(host, `planner.intent.contributions.${addon}`, `Planner Contributions ${addon}`);
		defs.push(
			strState(ids.status, `${addon} Contributions Status`, "not_initialized"),
			strState(ids.contributionsJson, `${addon} Contributions (JSON)`, "[]"),
			strState(ids.reasonDe, `${addon} Contributions Begründung (DE)`, ""),
			numState(ids.revision, `${addon} Contributions Revision`, 0),
		);
	}

	await ensureStates(host, defs);
}
