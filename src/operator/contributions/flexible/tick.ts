import { setStateIfChanged, type StateWriteOptions } from "../../../policy/core/state_write";
import { writeFlexibleContributionsFile, type PlanPathHost } from "../../plan_store";
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
	writeOpts: StateWriteOptions | undefined,
	revisionValue: number,
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
	await setStateIfChanged(host, ids.status, status, writeOpts);
	await setStateIfChanged(host, ids.reasonDe, reason, writeOpts);
	await setStateIfChanged(host, ids.revision, revisionValue, writeOpts);
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
	const revisionChanged = payload !== lastRevisionPayload;
	const nextRevision = revisionChanged ? revision + 1 : revision;
	const writeOpts: StateWriteOptions | undefined = revisionChanged ? { skipRead: true } : undefined;

	const { active, excluded } = partitionFlexible(contributions);
	const overallStatus = active.length > 0 ? "ready" : excluded.length > 0 ? "degraded" : "missing";

	try {
		await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.status, overallStatus, writeOpts);
		await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.generatedAt, now.toISOString(), writeOpts);
		if (revisionChanged) {
			const filePayload = JSON.stringify({ contributions, active, excluded });
			try {
				await writeFlexibleContributionsFile(host as PlanPathHost, filePayload);
				(host.log as { info?: (msg: string) => void } | undefined)?.info?.(
					`flexible contributions file write: bytes=${filePayload.length} count=${contributions.length}`,
				);
			} catch (e) {
				host.log?.warn?.(`flexible contributions file write: ${String(e)}`);
			}
		}
		await setStateIfChanged(
			host,
			FLEXIBLE_CONTRIBUTIONS_STATE_IDS.reasonDe,
			`${active.length} aktiv, ${excluded.length} ausgeschlossen.`,
			writeOpts,
		);
		await setStateIfChanged(host, FLEXIBLE_CONTRIBUTIONS_STATE_IDS.revision, nextRevision, writeOpts);

		await writeAddonStates(host, "battery", contributions, writeOpts, nextRevision);
		await writeAddonStates(host, "wallbox", contributions, writeOpts, nextRevision);
		await writeAddonStates(host, "immersion_heater", contributions, writeOpts, nextRevision);
		await writeAddonStates(host, "air_conditioning", contributions, writeOpts, nextRevision);
		if (revisionChanged) {
			revision = nextRevision;
			lastRevisionPayload = payload;
		}
	} catch (e) {
		host.log?.warn?.(`flexible contributions state write: ${String(e)}`);
	}

	return contributions;
}
