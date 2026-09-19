import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ResolvedBatteryIntent } from "../../../intent/battery/types";
import { emptyResolvedBatteryIntent } from "../../../intent/battery/types";
import { resolvedIntentHasExplicitOperatingRequest } from "./intent_read";

function holdFrom(source: "evcc" | "iobroker", owner: "evcc" | "user"): ResolvedBatteryIntent {
	const intent = emptyResolvedBatteryIntent(new Date("2026-09-19T12:00:00.000Z"), "main");
	intent.intent_state = "available";
	intent.operating_request = {
		value: "hold",
		status: "valid",
		origin: { source, owner, change_kind: source === "evcc" ? "unknown" : "manual_explicit" },
		observed_at: "2026-09-19T12:00:00.000Z",
	};
	return intent;
}

describe("resolved battery operating request provenance", () => {
	it("does not treat EVCC hold telemetry as a persistent user hold", () => {
		assert.equal(resolvedIntentHasExplicitOperatingRequest(holdFrom("evcc", "evcc"), "hold"), false);
	});

	it("preserves an explicit ioBroker user hold", () => {
		assert.equal(resolvedIntentHasExplicitOperatingRequest(holdFrom("iobroker", "user"), "hold"), true);
	});
});
