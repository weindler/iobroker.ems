import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parsePlannerRequestedAuthority,
	plannerRequestedAuthorityFromConfig,
	PLANNER_AUTHORITATIVE_SOURCE_DEFAULT,
} from "./authoritative_source.js";

describe("planner_config authoritative source", () => {
	it("defaults to legacy", () => {
		assert.equal(PLANNER_AUTHORITATIVE_SOURCE_DEFAULT, "legacy");
		assert.equal(parsePlannerRequestedAuthority(undefined).mode, "legacy");
	});

	it("clamps invalid values", () => {
		const p = parsePlannerRequestedAuthority("worker_live");
		assert.equal(p.mode, "legacy");
		assert.equal(p.clamped, true);
	});

	it("accepts worker_dryrun without auto-activate semantics", () => {
		assert.equal(
			plannerRequestedAuthorityFromConfig({
				planner_authoritative_source: "worker_dryrun",
			}).mode,
			"worker_dryrun",
		);
	});
});
