import type { EmsAddonId } from "../addons/registry";
import type { OperatorContributorRef, OperatorSystemContributorId } from "./types";

export function addonContributorRef(addonId: EmsAddonId): OperatorContributorRef {
	return { type: "addon", id: addonId, addonId };
}

export function systemContributorRef(id: OperatorSystemContributorId): OperatorContributorRef {
	return { type: "system", id, addonId: null };
}

export function contributorRefKey(ref: OperatorContributorRef): string {
	return `${ref.type}:${ref.id}`;
}

export function serializeContributorRef(ref: OperatorContributorRef): string {
	return JSON.stringify(ref);
}

export function parseContributorRef(raw: string): OperatorContributorRef | null {
	try {
		const parsed = JSON.parse(raw) as OperatorContributorRef;
		if (!parsed || typeof parsed !== "object") return null;
		if (parsed.type !== "addon" && parsed.type !== "system") return null;
		if (typeof parsed.id !== "string" || !parsed.id.trim()) return null;
		if (parsed.addonId !== null && typeof parsed.addonId !== "string") return null;
		return parsed;
	} catch {
		return null;
	}
}
