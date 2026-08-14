import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isLiveWriteAllowed } from "../../../execution_mode";
import { addonMode, GLOBAL } from "../../../tree_paths";
import { goeWallboxTemplateFlat } from "../../../mapping_config";
import { collectConfiguredControlTargetStateIds, resolveWallboxControlModel } from "../evcc_control_config";
import { resolveEvccModeControlContract } from "../evcc_mode_control";
import { evaluateWallboxDispatchReadiness } from "../runtime/dispatch";
import { buildWallboxControlMappingSnapshot } from "../runtime/control_mapping";
import { prepareEvccButtonTrigger } from "../runtime/evcc_button_trigger";
import {
	EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED,
	EV_FOUNDATION_PLANNER_WRITES_ENABLED,
} from "./write_allowlist";

const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC = join(ROOT, "src", "addons", "wallbox");
const ADMIN_JSON = join(ROOT, "admin", "jsonConfig.json");
const LP = "evcc.0.loadpoint.1";

type AdminItem = { hidden?: string; label?: string; text?: string };

function wallboxItems(): Record<string, AdminItem> {
	const cfg = JSON.parse(readFileSync(ADMIN_JSON, "utf8")) as {
		items: { wallboxTab: { items: Record<string, AdminItem> } };
	};
	return cfg.items.wallboxTab.items;
}

function isHidden(item: AdminItem | undefined, data: Record<string, unknown>): boolean {
	if (!item || typeof item.hidden !== "string" || !item.hidden.trim()) return false;
	const fn = new Function("data", `return Boolean(${item.hidden});`);
	return Boolean(fn(data));
}

function buttonCfg(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		wb_control_model: "evcc",
		wb_evcc_mode_control: "buttons",
		wb_evcc_control_off_target: `${LP}.control.off`,
		wb_evcc_control_pv_target: `${LP}.control.pv`,
		wb_evcc_control_min_target: `${LP}.control.min`,
		wb_evcc_control_now_target: `${LP}.control.now`,
		wb_evcc_loadpoint_mode_state: `${LP}.status.mode`,
		wb_evcc_control_max_current_target: `${LP}.control.maxCurrent`,
		wb_evcc_control_phases_configured_target: `${LP}.control.phasesConfigured`,
		...over,
	};
}

const BUTTON_FIELDS = [
	"wb_evcc_control_off_target",
	"wb_evcc_control_pv_target",
	"wb_evcc_control_min_target",
	"wb_evcc_control_now_target",
	"wb_evcc_control_max_current_target",
	"wb_evcc_control_phases_configured_target",
] as const;

const STRING_LEGACY_FIELDS = [
	"wb_evcc_set_mode_target",
	"wb_evcc_mode_charge_value",
	"wb_evcc_mode_hold_value",
] as const;

describe("EVCC admin/legacy cleanup v0.1.275", () => {
	it("T1: buttons hides string-mode and pvControl legacy fields", () => {
		const items = wallboxItems();
		const data = { wb_control_model: "evcc", wb_evcc_mode_control: "buttons" };
		for (const key of STRING_LEGACY_FIELDS) {
			assert.equal(isHidden(items[key], data), true, key);
		}
		assert.equal(isHidden(items.wb_evcc_control_pv_control_target, data), true);
		assert.equal(isHidden(items.wb_evcc_set_max_current_a_target, data), true);
		assert.equal(isHidden(items.wb_evcc_set_phase_target, data), true);
	});

	it("T2: buttons shows current button contract fields", () => {
		const items = wallboxItems();
		const data = { wb_control_model: "evcc", wb_evcc_mode_control: "buttons" };
		for (const key of BUTTON_FIELDS) {
			assert.equal(isHidden(items[key], data), false, key);
		}
		assert.equal(items.wb_evcc_control_off_target.label, "EVCC OFF (Write/Button)");
		assert.equal(items.wb_evcc_control_max_current_target.label, "EVCC maxCurrent (Write)");
		assert.equal(items.wb_evcc_control_phases_configured_target.label, "EVCC Phasen (Write)");
		assert.equal(items.wb_evcc_loadpoint_mode_state.label, "EVCC Modus / status.mode (Read)");
		const opts = (
			items.wb_evcc_mode_control as AdminItem & { options?: Array<{ label: string; value: string }> }
		).options;
		assert.ok(opts?.some((o) => o.value === "buttons" && o.label.includes("empfohlen")));
		assert.ok(opts?.some((o) => o.value === "pv_control" && o.label.includes("Legacy")));
		assert.ok(opts?.some((o) => o.value === "string_mode" && o.label.includes("Legacy")));
	});

	it("T3: stored pvControl does not affect buttons contract", () => {
		const cfg = buttonCfg({
			wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
		});
		const contract = resolveEvccModeControlContract(cfg);
		assert.equal(contract.resolvedVariant, "buttons");
		assert.equal(contract.writeContractReady, true);
		assert.ok(!contract.missing.includes("control.pvControl"));
		assert.equal(contract.detail.ignoredLegacyConfig && typeof contract.detail.ignoredLegacyConfig, "object");
		const ignored = contract.detail.ignoredLegacyConfig as Record<string, unknown>;
		assert.equal(ignored.pvControl, `${LP}.control.pvControl`);
		assert.ok(!(contract.detail.activeInputs as Record<string, unknown>).pvControl);
		const snap = buildWallboxControlMappingSnapshot({
			config: cfg,
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
			objectMetas: {},
		});
		assert.equal(snap.setMode, null);
		assert.equal(snap.evccControlContractReady, true);
		assert.equal(snap.evccModeControlVariant, "buttons");
	});

	it("T4: stored string-mode values do not affect buttons contract", () => {
		const cfg = buttonCfg({
			wb_evcc_set_mode_target: `${LP}.mode`,
			wb_evcc_mode_charge_value: "pv",
			wb_evcc_mode_hold_value: "off",
		});
		const contract = resolveEvccModeControlContract(cfg);
		assert.equal(contract.writeContractReady, true);
		assert.ok(!contract.missing.includes("evcc_charge_mode_value"));
		assert.equal(contract.detail.requiresChargeModeValue, false);
		const ignored = contract.detail.ignoredLegacyConfig as Record<string, unknown>;
		assert.equal(ignored.setMode, `${LP}.mode`);
		assert.equal(ignored.chargeValue, "pv");
		assert.equal(ignored.holdValue, "off");
		const snap = buildWallboxControlMappingSnapshot({
			config: cfg,
			telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: `${LP}.status.mode` },
			objectMetas: {},
		});
		assert.equal(snap.setMode, null);
		assert.equal(snap.evccChargeModeValue, null);
		assert.ok(!snap.validationIssues.some((i) => i.includes("evcc_charge_mode_mapping_missing")));
		assert.equal(snap.liveEligible, false);
	});

	it("T5: pv_control shows required legacy fields and hides buttons", () => {
		const items = wallboxItems();
		const data = { wb_control_model: "evcc", wb_evcc_mode_control: "pv_control" };
		assert.equal(isHidden(items.wb_evcc_control_pv_control_target, data), false);
		assert.equal(isHidden(items.wb_evcc_control_max_current_target, data), false);
		assert.equal(isHidden(items.wb_evcc_control_phases_configured_target, data), false);
		assert.equal(isHidden(items.wb_evcc_control_off_target, data), true);
		assert.equal(isHidden(items.wb_evcc_set_mode_target, data), true);
		assert.equal(isHidden(items.wb_evcc_mode_charge_value, data), true);
	});

	it("T6: string_mode shows string fields and hides buttons/pvControl", () => {
		const items = wallboxItems();
		const data = { wb_control_model: "evcc", wb_evcc_mode_control: "string_mode" };
		for (const key of STRING_LEGACY_FIELDS) {
			assert.equal(isHidden(items[key], data), false, key);
		}
		assert.equal(isHidden(items.wb_evcc_set_max_current_a_target, data), false);
		assert.equal(isHidden(items.wb_evcc_control_off_target, data), true);
		assert.equal(isHidden(items.wb_evcc_control_pv_control_target, data), true);
	});

	it("T7: switching variant does not delete stored values", () => {
		const cfg = buttonCfg({
			wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
			wb_evcc_set_mode_target: `${LP}.mode`,
			wb_evcc_set_max_current_a_target: `${LP}.maxCurrent`,
			wb_evcc_mode_charge_value: "pv",
			wb_evcc_mode_hold_value: "off",
		});
		const asButtons = resolveEvccModeControlContract(cfg);
		assert.equal(asButtons.writeContractReady, true);
		cfg.wb_evcc_mode_control = "pv_control";
		const asPv = resolveEvccModeControlContract(cfg);
		assert.equal(cfg.wb_evcc_control_off_target, `${LP}.control.off`);
		assert.equal(cfg.wb_evcc_mode_charge_value, "pv");
		assert.equal(asPv.pvControlStateId, `${LP}.control.pvControl`);
		assert.equal(asPv.writeContractReady, true);
		cfg.wb_evcc_mode_control = "string_mode";
		const asString = resolveEvccModeControlContract(cfg);
		assert.equal(cfg.wb_evcc_control_pv_control_target, `${LP}.control.pvControl`);
		assert.equal(asString.writeContractReady, true);
		cfg.wb_evcc_mode_control = "buttons";
		const back = resolveEvccModeControlContract(cfg);
		assert.equal(back.writeContractReady, true);
		assert.equal(cfg.wb_evcc_control_pv_control_target, `${LP}.control.pvControl`);
		assert.equal(cfg.wb_evcc_mode_charge_value, "pv");
	});

	it("T8: auto with complete buttons resolves to buttons", () => {
		const cfg = buttonCfg({ wb_evcc_mode_control: "auto" });
		const contract = resolveEvccModeControlContract(cfg);
		assert.equal(contract.requestedVariant, "auto");
		assert.equal(contract.resolvedVariant, "buttons");
		assert.equal(contract.writeContractReady, true);
		const items = wallboxItems();
		const data = { wb_control_model: "evcc", wb_evcc_mode_control: "auto" };
		assert.equal(isHidden(items.wb_evcc_control_off_target, data), false);
		assert.equal(isHidden(items.wb_evcc_set_mode_target, data), true);
		assert.equal(isHidden(items.wb_evcc_control_pv_control_target, data), true);
	});

	it("T9: button contract remains ready", () => {
		const contract = resolveEvccModeControlContract(buttonCfg());
		assert.equal(contract.buttonsReady, true);
		assert.equal(contract.writeContractReady, true);
		const r = evaluateWallboxDispatchReadiness(buttonCfg());
		assert.equal(r.controlMappingComplete, true);
		assert.equal(r.liveDispatchSupported, false);
	});

	it("T10: no new productive writes", () => {
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
		assert.equal(EV_FOUNDATION_PLANNER_WRITES_ENABLED, false);
		const executeSrc = readFileSync(join(SRC, "runtime", "execute.ts"), "utf8");
		assert.equal(executeSrc.includes("control.off"), false);
		assert.equal(executeSrc.includes("prepareEvccButtonTrigger"), false);
		const triggerSrc = readFileSync(join(SRC, "runtime", "evcc_button_trigger.ts"), "utf8");
		assert.match(triggerSrc, /liveReleased: false/);
		const trigger = prepareEvccButtonTrigger({
			contract: resolveEvccModeControlContract(buttonCfg()),
			desiredPreparedState: "planned_now",
			feedbackMode: "pv",
		});
		assert.equal(trigger?.liveReleased, false);
	});

	it("T11: governance unchanged", async () => {
		const store: Record<string, string> = {
			[GLOBAL.executionMode]: "dryrun",
			[addonMode("wallbox")]: "live",
		};
		const get = async (id: string) => ({ val: store[id] } as ioBroker.State);
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
		store[GLOBAL.executionMode] = "live";
		store[addonMode("wallbox")] = "dryrun";
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), false);
		store[addonMode("wallbox")] = "live";
		assert.equal(await isLiveWriteAllowed(get, "wallbox"), true);
	});

	it("T12: no go-e fallback on EVCC path", () => {
		const cfg = buttonCfg({
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_evcc_control_now_target: "go-e.0.allow_charging",
		});
		const ids = collectConfiguredControlTargetStateIds(cfg);
		assert.ok(ids.every((id) => !id.startsWith("go-e.")));
		assert.equal(resolveWallboxControlModel(cfg), "evcc");
		const contract = resolveEvccModeControlContract(cfg);
		assert.equal(contract.usesLegacyGoeFallback, false);
		assert.equal(contract.nowStateId, "");
	});

	it("T13: no Sonnen writes", () => {
		const files = [
			join(SRC, "evcc_mode_control.ts"),
			join(SRC, "runtime", "evcc_button_trigger.ts"),
			join(SRC, "runtime", "execute.ts"),
		];
		for (const f of files) {
			const src = readFileSync(f, "utf8");
			assert.equal(src.includes("batteryMode"), false, f);
			assert.equal(src.includes("batteryDischargeControl"), false, f);
		}
		const tpl = goeWallboxTemplateFlat();
		assert.equal(tpl.wb_set_enabled_target, "go-e.0.allow_charging");
	});
});
