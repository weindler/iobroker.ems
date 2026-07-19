import { GOVERNED_ADDON_REGISTRY } from "../addons/governance/registry";
import { governedAddonByRuntimeId } from "../addons/governance";
import { STATE } from "../states";

/** Core add-ons that get enabled/available basis states (stubs stay lazy). */
export const CORE_ADDON_BASIS_IDS: readonly string[] = [
	...GOVERNED_ADDON_REGISTRY.map((e) => e.runtimeAddonId),
	"dynamic_tariff",
];

type BaseEnsureHost = {
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

async function ensureState(
	host: BaseEnsureHost,
	relativeId: string,
	common: ioBroker.StateCommon,
	defaultVal?: ioBroker.StateValue,
): Promise<void> {
	await host.setObjectNotExistsAsync(relativeId, {
		type: "state",
		common,
		native: {},
	} as ioBroker.Object);
	if (defaultVal !== undefined) {
		const cur = await host.getStateAsync(relativeId);
		if (cur?.val === undefined || cur?.val === null || cur?.val === "") {
			await host.setStateAsync(relativeId, { val: defaultVal, ack: true });
		}
	}
}

/** Phase B — Command-/Audit-Basisstates. */
export async function ensureCommandBaseStates(host: BaseEnsureHost): Promise<void> {
	const defs: Array<{ _id: string; common: ioBroker.StateCommon; defVal?: ioBroker.StateValue }> = [
		{
			_id: STATE.command.inbox,
			common: {
				name: "Command inbox (JSON)",
				type: "string",
				role: "json",
				read: true,
				write: true,
			},
		},
		{
			_id: STATE.command.lastResult,
			common: {
				name: "Last pipeline result (JSON)",
				type: "string",
				role: "json",
				read: true,
				write: false,
			},
		},
		{
			_id: STATE.audit.lastEvent,
			common: {
				name: "Last audit event (global mirror)",
				type: "string",
				role: "json",
				read: true,
				write: false,
			},
		},
	];

	for (const def of defs) {
		await host.setObjectNotExistsAsync(def._id, {
			type: "state",
			common: def.common,
			native: {},
		} as ioBroker.Object);
		if (def.defVal !== undefined) {
			const cur = await host.getStateAsync(def._id);
			if (cur?.val === undefined || cur?.val === null) {
				await host.setStateAsync(def._id, { val: def.defVal, ack: true });
			}
		}
	}
}

/** Phase B — Add-on enabled/available Basisstates (nur Kern-Add-ons). */
export async function ensureAddonBasisStates(host: BaseEnsureHost): Promise<void> {
	for (const addonId of CORE_ADDON_BASIS_IDS) {
		const base = `addons.${addonId}`;
		const governed = governedAddonByRuntimeId(addonId);
		await ensureState(
			host,
			`${base}.enabled`,
			{
				name: `${addonId} enabled`,
				type: "boolean",
				role: "switch",
				read: true,
				write: !governed,
				def: true,
			},
			true,
		);
		await ensureState(
			host,
			`${base}.available`,
			{
				name: `${addonId} available`,
				type: "boolean",
				role: "state",
				read: true,
				write: true,
				def: true,
			},
			true,
		);
	}
}
