import { setStateIfChanged } from "../../../policy/core/state_write";
import type { PlanContribution } from "../../types";
import { flexibleContributionsRevisionPayload } from "./types";
import {
	collectFlexibleContributions,
	type FlexibleContributionsReadHost,
} from "./read";
import { FLEXIBLE_ADDON_STATE_IDS, FLEXIBLE_CONTRIBUTIONS_STATE_IDS } from "./states";
import type { GridSupplyForecast } from "../../types";

let lastRevisionPayload = "";
let revision = 0;

export function resetFlexibleContributionsRevisionForTest(): void {
	lastRevisionPayload = "";
	revision = 0;
}

export function flexibleContributionsRevisionForTest(): number {
	return revision;
}

function partitionFlexible(contributions: PlanContribution[]): {
	active: PlanContribution[];
	excluded: Array<{ contributionId: string; reasonDe: string }>;
} {
	const active: PlanContribution[] = [];
	const excluded: Array<{ contributionId: string; reasonDe: string }> = [];
	for (const c of contributions) {
		if (c.enabled && c.quality.status !== "missing" && c.quality.status !== "invalid") {
			active.push(c);
		} else {
			excluded.push({ contributionId: c.contributionId, reasonDe: c.reasonDe || c.quality.reasonDe });
		}
	}
	return { active, excluded };
}

function addonContributions(contributions: PlanContribution[], addonId: string): PlanContribution[] {
	return contributions.filter((c) => c.contributor.addonId === addonId || c.contributor.id === addonId);
}

function addonStatus(contributions: PlanContribution[]): string {
	if (contributions.length === 0) return "missing";
	if (contributions.some((c) => c.enabled && c.quality.status === "valid")) return "ready";
	if (contributions.some((c) => c.enabled)) return "degraded";
	if (contributions.some((c) => c.quality.status === "unsupported")) return "unsupported";
	return "disabled";
}

async function writeAddonStates(
	host: FlexibleContributionsReadHost,
	addonKey: keyof typeof FLEXIBLE_ADDON_STATE_IDS,
	contributions: PlanContribution[],
): Promise<void> {
	const ids = FLEXIBLE_ADDON_STATE_IDS[addonKey];
	const rows = addonContributions(
		contributions,
		addonKey === "air_conditioning" ? "air_conditioning" : addonKey,
	);
	const status = addonStatus(rows);
	const reason =
		rows.find((c) => c.enabled)?.reasonDe ??
		rows[0]?.reasonDe ??
		`Keine ${addonKey}-Contributions.`;
	await setStateIfChanged(host, ids.status, status);
	await setStateIfChanged(host, ids.contributionsJson, JSON.stringify(rows));
	await setStateIfChanged(host, ids.reasonDe, reason);
	await setStateIfChanged(host, ids.revision, revision);
}

export async function runFlexibleContributionsTick(
	host: FlexibleContributionsReadHost,
	gridForecast?: GridSupplyForecast,
): Promise<PlanContribution[]> {
	const now = new Date();
	let contributions: PlanContribution[] = [];
	try {
		const collected = await collectFlexibleContributions(host, now, gridForecast ?? null);
		contributions = collected.contributions;
	} catch (e) {
		host.log?.warn?.(`flexible contributions read: ${String(e)}`);
		try {
			await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.status, "error");
			await setStateIfChanged(
				host,
				FLEXIBLE_CONTRIBUTIONS_STATE_IDS.reasonDe,
				`Flexible Contributions Fehler: ${String(e)}`.slice(0, 480),
			);
		} catch {
			// ignore
		}
		return [];
	}

	const payload = flexibleContributionsRevisionPayload(contributions);
	if (payload !== lastRevisionPayload) {
		revision += 1;
		lastRevisionPayload = payload;
	}

	const { active, excluded } = partitionFlexible(contributions);
	const overallStatus = active.length > 0 ? "ready" : excluded.length > 0 ? "degraded" : "missing";

	try {
		await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.status, overallStatus);
		await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.generatedAt, now.toISOString());
		await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.contributionsJson, JSON.stringify(contributions));
		await setStateIfChanged(
			host,
			FLEXIBLE_CONTRIBUTIONS_STATE_IDS.activeJson,
			JSON.stringify(active.map((c) => c.contributionId)),
		);
		await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.excludedJson, JSON.stringify(excluded));
		await setStateIfChanged(
			host,
			FLEXIBLE_CONTRIBUTIONS_STATE_IDS.reasonDe,
			`${active.length} aktiv, ${excluded.length} ausgeschlossen.`,
		);
		await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.revision, revision);

		await writeAddonStates(host, "battery", contributions);
		await writeAddonStates(host, "wallbox", contributions);
		await writeAddonStates(host, "immersion_heater", contributions);
		await writeAddonStates(host, "air_conditioning", contributions);
	} catch (e) {
		host.log?.warn?.(`flexible contributions state write: ${String(e)}`);
	}

	return contributions;
}
