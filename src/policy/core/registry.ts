import type { PolicyProvider } from "./types";

export class PolicyProviderRegistry {
	private providers = new Map<string, PolicyProvider>();

	register(provider: PolicyProvider): { ok: true } | { ok: false; reason: string } {
		if (!provider.id?.trim()) {
			return { ok: false, reason: "Leere Provider-ID" };
		}
		if (this.providers.has(provider.id)) {
			return { ok: false, reason: `Doppelte Provider-ID: ${provider.id}` };
		}
		const combo = `${provider.addonType}:${provider.instanceId}`;
		for (const p of this.providers.values()) {
			if (`${p.addonType}:${p.instanceId}` === combo) {
				return {
					ok: false,
					reason: `Doppelte Add-on/Instance-Kombination: ${combo}`,
				};
			}
		}
		this.providers.set(provider.id, provider);
		return { ok: true };
	}

	unregister(id: string): void {
		this.providers.delete(id);
	}

	clear(): void {
		this.providers.clear();
	}

	list(): PolicyProvider[] {
		return [...this.providers.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	get(id: string): PolicyProvider | undefined {
		return this.providers.get(id);
	}
}

/** Singleton für Adapter-Laufzeit */
export const policyProviderRegistry = new PolicyProviderRegistry();
