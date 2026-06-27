import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_MODES, DEFAULT_GLOBAL_MODE } from "./constants.js";
import { resolveGlobalModes, validateRequestedMode } from "./resolve.js";
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
