import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS } from "./runtime_subscriptions.js";

describe("EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS", () => {
	it("deckt alle manuellen Runtime-Trigger mit bestehendem onStateChange-Handler ab", () => {
		const set = new Set<string>(EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS);
		assert.equal(set.size, EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS.length, "keine Duplikate");
		for (const id of [
			"ai.optimize_now_request",
			"ai.user_enabled",
			"ai.daily_analyst.run_now_request",
			"statistics.public_charge.submit_request",
			"statistics.adjust_request",
			"statistics.period_id",
			"backup.export_request",
			"backup.support_export_request",
			"support.diagnostic_request",
			"backup.restore.validate_request",
			"backup.restore.apply_request",
			"global_modes.requested",
			"user_intent.inputs.iobroker.wallbox.request_json",
		]) {
			assert.ok(set.has(id), `fehlt in Subscribe-Liste: ${id}`);
		}
	});
});
