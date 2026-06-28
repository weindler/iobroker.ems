import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWallboxIntent } from "./resolve.js";
import type { AdminIntentSnapshot, EvccIntentSnapshot, IobrokerIntentSnapshot } from "./types.js";

const NOW = new Date("2026-06-27T12:00:00Z");
const ISO = NOW.toISOString();

function evccField<T>(value: T, status: "valid" | "missing" = "valid") {
	return {
		value,
		status,
		origin: { source: "evcc" as const, owner: "evcc" as const, change_kind: "unknown" as const },
		observed_at: ISO,
	};
}

function iobrokerField<T>(value: T) {
	return {
		value,
		status: "valid" as const,
		origin: {
			source: "iobroker" as const,
			owner: "user" as const,
			change_kind: "manual_explicit" as const,
		},
		observed_at: ISO,
		changed_at: ISO,
	};
}

function evccSnapshot(strategy: string): EvccIntentSnapshot {
	return {
		observed_at: ISO,
		charge_strategy: evccField(strategy as "pv"),
		target_soc_pct: evccField(null, "missing"),
		deadline: evccField(null, "missing"),
		status: "ok",
	};
}

describe("wallbox intent resolver", () => {
	it("iobroker beats evcc", () => {
		const evcc = evccSnapshot("pv");
		const iobroker: IobrokerIntentSnapshot = {
			observed_at: ISO,
			charge_strategy: iobrokerField("immediate"),
			target_soc_pct: null,
			deadline: null,
			manual_override: null,
			request_id: "r1",
		};
		const r = resolveWallboxIntent({ now: NOW, previous: null, evcc, iobroker, admin: null, override: null, active: true });
		assert.equal(r.charge_strategy.value, "immediate");
		assert.equal(r.charge_strategy.origin.source, "iobroker");
	});
	it("evcc beats admin default", () => {
		const evcc = evccSnapshot("min_pv");
		const admin: AdminIntentSnapshot = {
			observed_at: ISO,
			charge_strategy: {
				value: "pv",
				status: "valid",
				origin: { source: "admin", owner: "admin_config", change_kind: "configured" },
				observed_at: ISO,
			},
			target_soc_pct: null,
			timezone: "Europe/Berlin",
		};
		const r = resolveWallboxIntent({ now: NOW, previous: null, evcc, iobroker: null, admin, override: null, active: true });
		assert.equal(r.charge_strategy.value, "min_pv");
	});
	it("admin fills only missing fields", () => {
		const admin: AdminIntentSnapshot = {
			observed_at: ISO,
			charge_strategy: {
				value: "pv",
				status: "valid",
				origin: { source: "admin", owner: "admin_config", change_kind: "configured" },
				observed_at: ISO,
			},
			target_soc_pct: {
				value: 80,
				status: "valid",
				origin: { source: "admin", owner: "admin_config", change_kind: "configured" },
				observed_at: ISO,
			},
			timezone: "Europe/Berlin",
		};
		const r = resolveWallboxIntent({ now: NOW, previous: null, evcc: null, iobroker: null, admin, override: null, active: true });
		assert.equal(r.charge_strategy.value, "pv");
		assert.equal(r.target_soc_pct.value, 80);
	});
	it("manual override scope charge_strategy only", () => {
		const evcc: EvccIntentSnapshot = {
			observed_at: ISO,
			charge_strategy: evccField("pv"),
			target_soc_pct: evccField(90),
			deadline: evccField(null, "missing"),
			status: "ok",
		};
		const iobroker: IobrokerIntentSnapshot = {
			observed_at: ISO,
			charge_strategy: iobrokerField("immediate"),
			target_soc_pct: null,
			deadline: null,
			manual_override: {
				active: true,
				scope: ["charge_strategy"],
				source: "iobroker",
				owner: "user",
				valid_until: "2026-06-28T00:00:00Z",
			},
			request_id: "r2",
		};
		const r = resolveWallboxIntent({
			now: NOW,
			previous: null,
			evcc,
			iobroker,
			admin: null,
			override: iobroker.manual_override,
			active: true,
		});
		assert.equal(r.charge_strategy.value, "immediate");
		assert.equal(r.target_soc_pct.value, 90);
		assert.equal(r.target_soc_pct.origin.source, "evcc");
	});
	it("evcc change_kind is unknown not manual_explicit", () => {
		const r = resolveWallboxIntent({
			now: NOW,
			previous: null,
			evcc: evccSnapshot("pv"),
			iobroker: null,
			admin: null,
			override: null,
			active: true,
		});
		assert.equal(r.charge_strategy.origin.change_kind, "unknown");
	});

	it("inactive addon -> disabled intent", () => {
		const r = resolveWallboxIntent({
			now: NOW,
			previous: null,
			evcc: evccSnapshot("pv"),
			iobroker: null,
			admin: null,
			override: null,
			active: false,
		});
		assert.equal(r.intent_state, "disabled");
	});
});
