import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_MODES, DEFAULT_GLOBAL_MODE } from "./constants.js";
import { decideRequestedWrite, resolveGlobalModes, validateRequestedMode } from "./resolve.js";
import { globalModeDefaultFromConfig } from "./config.js";

describe("global modes resolve", () => {
	it("accepts all five valid modes", () => {
		for (const mode of GLOBAL_MODES) {
			const r = resolveGlobalModes({
				requestedRaw: mode,
				adminDefault: "balanced",
				hasPersistedRequested: true,
			});
			assert.equal(r.active, mode);
			assert.equal(r.valid, true);
		}
	});

	it("falls back to balanced for invalid mode", () => {
		const r = resolveGlobalModes({
			requestedRaw: "turbo",
			adminDefault: "eco",
			hasPersistedRequested: true,
		});
		assert.equal(r.active, DEFAULT_GLOBAL_MODE);
		assert.equal(r.valid, false);
		assert.equal(r.status, "fallback");
	});

	it("fallback sets valid=false", () => {
		const r = resolveGlobalModes({
			requestedRaw: "invalid",
			adminDefault: "balanced",
			hasPersistedRequested: true,
		});
		assert.equal(r.valid, false);
	});

	it("issues_json contains fallback reason", () => {
		const r = resolveGlobalModes({
			requestedRaw: "nope",
			adminDefault: "balanced",
			hasPersistedRequested: true,
		});
		assert.ok(r.issues.some((i) => i.code === "global_mode_fallback"));
	});

	it("missing value uses admin default", () => {
		const r = resolveGlobalModes({
			requestedRaw: "",
			adminDefault: "eco",
			hasPersistedRequested: false,
		});
		assert.equal(r.active, "eco");
		assert.equal(r.requested, "eco");
	});

	it("invalid admin default resolves via config helper to balanced", () => {
		assert.equal(globalModeDefaultFromConfig({ global_mode_default: "bogus" }), DEFAULT_GLOBAL_MODE);
	});

	it("validateRequestedMode rejects unknown", () => {
		const v = validateRequestedMode("xyz");
		assert.equal(v.mode, null);
		assert.ok(v.issue);
	});
});

describe("global modes admin-default decision", () => {
	it("first init without runtime value adopts admin default", () => {
		const d = decideRequestedWrite({ currentRequestedRaw: "", adminDefault: "eco", lastAdminSeen: null });
		assert.equal(d.writeRequested, "eco");
		assert.equal(d.reason, "first_init");
	});

	it("keeps runtime value on plain restart (admin default unchanged)", () => {
		const d = decideRequestedWrite({
			currentRequestedRaw: "forced",
			adminDefault: "balanced",
			lastAdminSeen: "balanced",
		});
		assert.equal(d.writeRequested, null);
		assert.equal(d.reason, "keep");
	});

	it("applies admin default when it actively changed", () => {
		const d = decideRequestedWrite({
			currentRequestedRaw: "balanced",
			adminDefault: "eco",
			lastAdminSeen: "balanced",
		});
		assert.equal(d.writeRequested, "eco");
		assert.equal(d.reason, "admin_changed");
	});

	it("does not clobber existing runtime value when no admin default was seen yet", () => {
		const d = decideRequestedWrite({
			currentRequestedRaw: "comfort",
			adminDefault: "balanced",
			lastAdminSeen: null,
		});
		assert.equal(d.writeRequested, null);
		assert.equal(d.reason, "keep");
	});
});
