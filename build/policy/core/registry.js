"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.policyProviderRegistry = exports.PolicyProviderRegistry = void 0;
class PolicyProviderRegistry {
    providers = new Map();
    register(provider) {
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
    unregister(id) {
        this.providers.delete(id);
    }
    clear() {
        this.providers.clear();
    }
    list() {
        return [...this.providers.values()].sort((a, b) => a.id.localeCompare(b.id));
    }
    get(id) {
        return this.providers.get(id);
    }
}
exports.PolicyProviderRegistry = PolicyProviderRegistry;
/** Singleton für Adapter-Laufzeit */
exports.policyProviderRegistry = new PolicyProviderRegistry();
