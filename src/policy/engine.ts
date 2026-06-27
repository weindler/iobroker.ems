import type { GlobalModeResolution } from "../global_modes/types";
import { runGlobalModes, type GlobalModesHost } from "../global_modes/run";
import {
	POLICY_ENGINE_VERSION,
	POLICY_SCHEMA_VERSION,
} from "./core/constants";
import { computePolicyRevisionHash, revisionFromHash } from "./core/hash";
import { sortIssuesDeterministic } from "./core/normalize";
import { policyProviderRegistry } from "./core/registry";
import { setStatesIfRevisionChanged } from "./core/state_write";
import type { PolicyProvider, PolicySnapshot } from "./core/types";
import {
	buildConfiguredGlobalPolicy,
	buildEffectiveGlobalPolicy,
} from "./global/build";
import { globalPolicyConfigFromAdapter } from "./global/config";
import { validateGlobalPolicy } from "./global/validate";
import {
	ensureAddonPolicyStates,
	ensureGlobalPolicyStates,
	ensureSystemPolicyStates,
} from "./global/ensure_states";
import { readGlobalPolicyPersistRevision, writeGlobalPolicyPersist } from "./global/persist";
import { stableStringify } from "./core/hash";

export type PolicyEngineHost = GlobalModesHost & {
	subscribeStatesAsync?: (pattern: string, callback: () => void) => Promise<void>;
	unsubscribeStatesAsync?: (pattern: string) => Promise<void>;
};

export interface PolicyEngineRunResult {
	globalModes: GlobalModeResolution;
	systemRevision: string;
	globalPolicyRevision: string;
	providersProcessed: number;
}

let lastSystemRevision: string | null = null;
let subscribed = false;
let subscribedHost: PolicyEngineHost | null = null;

const REQUESTED_PATTERN = "global_modes.requested";

function snapshotForJson(snapshot: PolicySnapshot): string {
	const { validation, ...rest } = snapshot;
	return stableStringify({
		...rest,
		validation: {
			valid: validation.valid,
			status: validation.status,
			issues: validation.issues,
		},
	});
}

async function writeProviderPolicyStates(
	host: PolicyEngineHost,
	provider: PolicyProvider,
	configured: PolicySnapshot,
	effective: PolicySnapshot,
	globalModes: GlobalModeResolution,
): Promise<void> {
	const base = `policy.${provider.addonType}.${provider.instanceId}`;
	await ensureAddonPolicyStates(host, provider.addonType, provider.instanceId);

	const validation = provider.validate(effective);
	const hash = computePolicyRevisionHash(effective, validation);
	const revision = revisionFromHash(hash);
	const ts = new Date().toISOString();

	const writes = [
		{ id: `${base}.configured_json`, val: snapshotForJson(configured) },
		{ id: `${base}.effective_json`, val: snapshotForJson(effective) },
		{ id: `${base}.provenance_json`, val: stableStringify(effective.provenance ?? {}) },
		{ id: `${base}.status`, val: effective.status },
		{ id: `${base}.valid`, val: validation.valid },
		{ id: `${base}.issues_json`, val: stableStringify(validation.issues) },
	];

	await setStatesIfRevisionChanged(host, `${base}.revision`, revision, writes, `${base}.updated_at`, ts);

	host.log.debug?.(
		`Policy provider ${provider.id}: revision=${revision} mode=${globalModes.active}`,
	);
}

async function writeSystemStates(
	host: PolicyEngineHost,
	providers: PolicyProvider[],
	engineIssues: import("./core/types").PolicyIssue[],
	valid: boolean,
): Promise<string> {
	const registryJson = stableStringify(
		providers.map((p) => ({
			id: p.id,
			addonType: p.addonType,
			instanceId: p.instanceId,
			schemaVersion: p.schemaVersion,
		})),
	);

	const payload = {
		schemaVersion: POLICY_SCHEMA_VERSION,
		engineVersion: POLICY_ENGINE_VERSION,
		providerCount: providers.length,
		valid,
		issues: sortIssuesDeterministic(engineIssues),
		registry: providers.map((p) => p.id).sort(),
	};

	const hash = revisionFromHash(
		computePolicyRevisionHash(
			{
				meta: {
					schemaVersion: POLICY_SCHEMA_VERSION,
					engineVersion: POLICY_ENGINE_VERSION,
				},
				capabilities: {},
				limits: {},
				preferences: {},
				protection: {},
				economics: {},
				validation: { valid, status: valid ? "valid" : "invalid", issues: engineIssues },
				status: valid ? "ready" : "invalid",
			},
			{ valid, status: valid ? "valid" : "invalid", issues: engineIssues },
		),
	);

	const ts = new Date().toISOString();
	const writes = [
		{ id: "policy.system.schema_version", val: POLICY_SCHEMA_VERSION },
		{ id: "policy.system.engine_version", val: POLICY_ENGINE_VERSION },
		{ id: "policy.system.status", val: valid ? "ready" : "invalid" },
		{ id: "policy.system.valid", val: valid },
		{ id: "policy.system.issues_json", val: stableStringify(payload.issues) },
		{ id: "policy.system.registered_providers_json", val: registryJson },
	];

	await setStatesIfRevisionChanged(host, "policy.system.revision", hash, writes, "policy.system.updated_at", ts);

	if (lastSystemRevision !== null && lastSystemRevision !== hash) {
		host.log.info("Policy revision changed");
	}
	lastSystemRevision = hash;
	return hash;
}

async function writeGlobalPolicyStates(
	host: PolicyEngineHost,
	configured: PolicySnapshot,
	effective: PolicySnapshot,
): Promise<string> {
	const validation = validateGlobalPolicy(effective);
	const hash = computePolicyRevisionHash(effective, validation);
	const revision = revisionFromHash(hash);
	const ts = new Date().toISOString();

	const writes = [
		{ id: "policy.global.configured_json", val: snapshotForJson(configured) },
		{ id: "policy.global.effective_json", val: snapshotForJson(effective) },
		{ id: "policy.global.provenance_json", val: stableStringify(effective.provenance ?? {}) },
		{ id: "policy.global.status", val: effective.status },
		{ id: "policy.global.valid", val: validation.valid },
		{ id: "policy.global.issues_json", val: stableStringify(validation.issues) },
	];

	await setStatesIfRevisionChanged(host, "policy.global.revision", revision, writes, "policy.global.updated_at", ts);

	if (!validation.valid) {
		const first = validation.issues.find((i) => i.severity === "error");
		host.log.warn(`Policy invalid: ${first?.message ?? "validation failed"}`);
	}

	const dataDir = host.getAbsolutePath?.("policy");
	if (dataDir) {
		const prev = await readGlobalPolicyPersistRevision(dataDir);
		if (prev !== revision) {
			await writeGlobalPolicyPersist(dataDir, {
				revision,
				configuredJson: snapshotForJson(configured),
				effectiveJson: snapshotForJson(effective),
			});
		}
	}

	return revision;
}

export async function runPolicyEngine(host: PolicyEngineHost): Promise<PolicyEngineRunResult> {
	await ensureSystemPolicyStates(host);
	await ensureGlobalPolicyStates(host);

	const globalModes = await runGlobalModes(host);
	const adminCfg = globalPolicyConfigFromAdapter(host.config);
	const configured = buildConfiguredGlobalPolicy(adminCfg);
	const effective = buildEffectiveGlobalPolicy(configured, globalModes.profile);

	const engineIssues = [...globalModes.issues];
	let engineValid = globalModes.valid && effective.validation.valid;

	const providers = policyProviderRegistry.list();
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
		} catch (e) {
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

export async function initPolicyEngine(host: PolicyEngineHost): Promise<void> {
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

export function stopPolicyEngine(): void {
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

export { policyProviderRegistry };
