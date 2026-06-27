"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.policyProviderRegistry = exports.stopPolicyEngine = exports.initPolicyEngine = exports.runPolicyEngine = void 0;
const run_1 = require("../global_modes/run");
const constants_1 = require("./core/constants");
const hash_1 = require("./core/hash");
const normalize_1 = require("./core/normalize");
const registry_1 = require("./core/registry");
Object.defineProperty(exports, "policyProviderRegistry", { enumerable: true, get: function () { return registry_1.policyProviderRegistry; } });
const state_write_1 = require("./core/state_write");
const build_1 = require("./global/build");
const config_1 = require("./global/config");
const validate_1 = require("./global/validate");
const ensure_states_1 = require("./global/ensure_states");
const persist_1 = require("./global/persist");
const hash_2 = require("./core/hash");
let lastSystemRevision = null;
let subscribed = false;
let subscribedHost = null;
const REQUESTED_PATTERN = "global_modes.requested";
function snapshotForJson(snapshot) {
    const { validation, ...rest } = snapshot;
    return (0, hash_2.stableStringify)({
        ...rest,
        validation: {
            valid: validation.valid,
            status: validation.status,
            issues: validation.issues,
        },
    });
}
async function writeProviderPolicyStates(host, provider, configured, effective, globalModes) {
    const base = `policy.${provider.addonType}.${provider.instanceId}`;
    await (0, ensure_states_1.ensureAddonPolicyStates)(host, provider.addonType, provider.instanceId);
    const validation = provider.validate(effective);
    const hash = (0, hash_1.computePolicyRevisionHash)(effective, validation);
    const revision = (0, hash_1.revisionFromHash)(hash);
    const ts = new Date().toISOString();
    const writes = [
        { id: `${base}.configured_json`, val: snapshotForJson(configured) },
        { id: `${base}.effective_json`, val: snapshotForJson(effective) },
        { id: `${base}.provenance_json`, val: (0, hash_2.stableStringify)(effective.provenance ?? {}) },
        { id: `${base}.status`, val: effective.status },
        { id: `${base}.valid`, val: validation.valid },
        { id: `${base}.issues_json`, val: (0, hash_2.stableStringify)(validation.issues) },
    ];
    await (0, state_write_1.setStatesIfRevisionChanged)(host, `${base}.revision`, revision, writes, `${base}.updated_at`, ts);
    host.log.debug?.(`Policy provider ${provider.id}: revision=${revision} mode=${globalModes.active}`);
}
async function writeSystemStates(host, providers, engineIssues, valid) {
    const registryJson = (0, hash_2.stableStringify)(providers.map((p) => ({
        id: p.id,
        addonType: p.addonType,
        instanceId: p.instanceId,
        schemaVersion: p.schemaVersion,
    })));
    const payload = {
        schemaVersion: constants_1.POLICY_SCHEMA_VERSION,
        engineVersion: constants_1.POLICY_ENGINE_VERSION,
        providerCount: providers.length,
        valid,
        issues: (0, normalize_1.sortIssuesDeterministic)(engineIssues),
        registry: providers.map((p) => p.id).sort(),
    };
    const hash = (0, hash_1.revisionFromHash)((0, hash_1.computePolicyRevisionHash)({
        meta: {
            schemaVersion: constants_1.POLICY_SCHEMA_VERSION,
            engineVersion: constants_1.POLICY_ENGINE_VERSION,
        },
        capabilities: {},
        limits: {},
        preferences: {},
        protection: {},
        economics: {},
        validation: { valid, status: valid ? "valid" : "invalid", issues: engineIssues },
        status: valid ? "ready" : "invalid",
    }, { valid, status: valid ? "valid" : "invalid", issues: engineIssues }));
    const ts = new Date().toISOString();
    const writes = [
        { id: "policy.system.schema_version", val: constants_1.POLICY_SCHEMA_VERSION },
        { id: "policy.system.engine_version", val: constants_1.POLICY_ENGINE_VERSION },
        { id: "policy.system.status", val: valid ? "ready" : "invalid" },
        { id: "policy.system.valid", val: valid },
        { id: "policy.system.issues_json", val: (0, hash_2.stableStringify)(payload.issues) },
        { id: "policy.system.registered_providers_json", val: registryJson },
    ];
    await (0, state_write_1.setStatesIfRevisionChanged)(host, "policy.system.revision", hash, writes, "policy.system.updated_at", ts);
    if (lastSystemRevision !== null && lastSystemRevision !== hash) {
        host.log.info("Policy revision changed");
    }
    lastSystemRevision = hash;
    return hash;
}
async function writeGlobalPolicyStates(host, configured, effective) {
    const validation = (0, validate_1.validateGlobalPolicy)(effective);
    const hash = (0, hash_1.computePolicyRevisionHash)(effective, validation);
    const revision = (0, hash_1.revisionFromHash)(hash);
    const ts = new Date().toISOString();
    const writes = [
        { id: "policy.global.configured_json", val: snapshotForJson(configured) },
        { id: "policy.global.effective_json", val: snapshotForJson(effective) },
        { id: "policy.global.provenance_json", val: (0, hash_2.stableStringify)(effective.provenance ?? {}) },
        { id: "policy.global.status", val: effective.status },
        { id: "policy.global.valid", val: validation.valid },
        { id: "policy.global.issues_json", val: (0, hash_2.stableStringify)(validation.issues) },
    ];
    await (0, state_write_1.setStatesIfRevisionChanged)(host, "policy.global.revision", revision, writes, "policy.global.updated_at", ts);
    if (!validation.valid) {
        const first = validation.issues.find((i) => i.severity === "error");
        host.log.warn(`Policy invalid: ${first?.message ?? "validation failed"}`);
    }
    const dataDir = host.getAbsolutePath?.("policy");
    if (dataDir) {
        const prev = await (0, persist_1.readGlobalPolicyPersistRevision)(dataDir);
        if (prev !== revision) {
            await (0, persist_1.writeGlobalPolicyPersist)(dataDir, {
                revision,
                configuredJson: snapshotForJson(configured),
                effectiveJson: snapshotForJson(effective),
            });
        }
    }
    return revision;
}
async function runPolicyEngine(host) {
    await (0, ensure_states_1.ensureSystemPolicyStates)(host);
    await (0, ensure_states_1.ensureGlobalPolicyStates)(host);
    const globalModes = await (0, run_1.runGlobalModes)(host);
    const adminCfg = (0, config_1.globalPolicyConfigFromAdapter)(host.config);
    const configured = (0, build_1.buildConfiguredGlobalPolicy)(adminCfg);
    const effective = (0, build_1.buildEffectiveGlobalPolicy)(configured, globalModes.profile);
    const engineIssues = [...globalModes.issues];
    let engineValid = globalModes.valid && effective.validation.valid;
    const providers = registry_1.policyProviderRegistry.list();
    for (const provider of providers) {
        try {
            const cfg = await provider.readConfig();
            const facts = await provider.readFacts();
            const pConfigured = provider.buildConfiguredPolicy(cfg, facts);
            const pEffective = provider.buildEffectivePolicy(pConfigured, facts, globalModes.profile);
            const pValidation = provider.validate(pEffective);
            if (!pValidation.valid) {
                engineValid = false;
                engineIssues.push(...pValidation.issues);
            }
            await writeProviderPolicyStates(host, provider, pConfigured, pEffective, globalModes);
        }
        catch (e) {
            engineValid = false;
            engineIssues.push({
                code: "provider_runtime_error",
                severity: "error",
                message: `Provider ${provider.id}: ${String(e)}`,
            });
            host.log.warn(`Policy provider ${provider.id} failed: ${e}`);
        }
    }
    const systemRevision = await writeSystemStates(host, providers, engineIssues, engineValid);
    const globalPolicyRevision = await writeGlobalPolicyStates(host, configured, effective);
    return {
        globalModes,
        systemRevision,
        globalPolicyRevision,
        providersProcessed: providers.length,
    };
}
exports.runPolicyEngine = runPolicyEngine;
async function initPolicyEngine(host) {
    host.log.info("Policy Engine initialized");
    await runPolicyEngine(host);
    if (!subscribed && host.subscribeStatesAsync) {
        subscribed = true;
        subscribedHost = host;
        await host.subscribeStatesAsync(REQUESTED_PATTERN, () => {
            void runPolicyEngine(host).catch((e) => {
                host.log.warn(`Policy Engine re-run: ${e}`);
            });
        });
    }
}
exports.initPolicyEngine = initPolicyEngine;
function stopPolicyEngine() {
    const host = subscribedHost;
    if (subscribed && host?.unsubscribeStatesAsync) {
        void host
            .unsubscribeStatesAsync(REQUESTED_PATTERN)
            .catch((e) => host.log.debug?.(`Policy Engine unsubscribe: ${e}`));
    }
    subscribed = false;
    subscribedHost = null;
    lastSystemRevision = null;
}
exports.stopPolicyEngine = stopPolicyEngine;
