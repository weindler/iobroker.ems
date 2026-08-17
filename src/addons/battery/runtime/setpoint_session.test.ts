import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	applyHandover,
	applyZeroRelease,
	decideSetpointRelease,
	emptySetpointSession,
	markReleasePending,
	notePositiveSetpointWrite,
	resolveBatterySetpointHandover,
	setpointOwnerFromAction,
	type BatterySetpointSession,
} from "./setpoint_session.js";

function owned(over: Partial<BatterySetpointSession> = {}): BatterySetpointSession {
	const owner = over.owner ?? "grid_charge";
	return {
		owner,
		kind: owner === "grid_balance" ? "discharge" : "charge",
		setpointW: 2000,
		wrotePositive: true,
		wroteLive: true,
		releasePending: false,
		releaseReason: "",
		lastReleaseAt: null,
		...over,
	};
}

describe("battery setpoint release contract", () => {
	it("maps charge actions to owners", () => {
		assert.equal(setpointOwnerFromAction("grid_charge"), "grid_charge");
		assert.equal(setpointOwnerFromAction("charge"), "planned_charge");
		assert.equal(setpointOwnerFromAction("topoff"), "planned_charge");
		assert.equal(setpointOwnerFromAction("grid_balance"), "grid_balance");
		assert.equal(setpointOwnerFromAction("hold"), "none");
		assert.equal(setpointOwnerFromAction("self_consumption"), "none");
	});

	it("ownership only after own successful write > 0", () => {
		const s = notePositiveSetpointWrite(emptySetpointSession(), "planned_charge", 2000, true);
		assert.equal(s.owner, "planned_charge");
		assert.equal(s.kind, "charge");
		assert.equal(s.setpointW, 2000);
		assert.equal(s.wrotePositive, true);
		assert.equal(s.wroteLive, true);
		assert.equal(notePositiveSetpointWrite(emptySetpointSession(), "planned_charge", 0, true).wrotePositive, false);
		assert.equal(notePositiveSetpointWrite(emptySetpointSession(), "none", 2000, true).wrotePositive, false);
	});

	it("grid_charge → self_consumption: exactly one 0 W release", () => {
		const d = decideSetpointRelease({ session: owned(), handover: "none", regularEnd: true });
		assert.equal(d.shouldWriteZero, true);
		assert.equal(d.dropOwnership, true);
		assert.equal(d.reason, "regular_end");
		const after = applyZeroRelease(owned({ releasePending: true }), "2026-08-17T08:00:00.000Z", d.reason);
		assert.equal(after.owner, "none");
		assert.equal(after.setpointW, 0);
		assert.equal(after.wrotePositive, false);
		assert.equal(after.lastReleaseAt, "2026-08-17T08:00:00.000Z");
		assert.equal(after.releasePending, false);
		const second = decideSetpointRelease({ session: after, handover: "none", regularEnd: true });
		assert.equal(second.shouldWriteZero, false);
		assert.equal(second.reason, "no_ownership");
	});

	it("grid_balance → idle: 0 W if GB owned", () => {
		const d = decideSetpointRelease({
			session: owned({ owner: "grid_balance", setpointW: 800 }),
			handover: "none",
			regularEnd: true,
		});
		assert.equal(d.shouldWriteZero, true);
		assert.equal(owned({ owner: "grid_balance" }).kind, "discharge");
		assert.equal(owned().kind, "charge");
	});

	it("charge and discharge ownership cannot be confused", () => {
		const gb = notePositiveSetpointWrite(emptySetpointSession(), "grid_balance", 48, true);
		const gc = notePositiveSetpointWrite(emptySetpointSession(), "grid_charge", 2000, true);
		assert.equal(gb.kind, "discharge");
		assert.equal(gb.owner, "grid_balance");
		assert.equal(gc.kind, "charge");
		assert.equal(gc.owner, "grid_charge");
		assert.notEqual(gb.kind, gc.kind);
	});

	it("grid_charge → hold: drop ownership, no 0 W", () => {
		const d = decideSetpointRelease({ session: owned(), handover: "hold", regularEnd: true });
		assert.equal(d.shouldWriteZero, false);
		assert.equal(d.dropOwnership, true);
		assert.equal(d.reason, "handover_hold");
		const after = applyHandover(owned(), d.reason);
		assert.equal(after.owner, "none");
		assert.equal(after.lastReleaseAt, null);
	});

	it("grid_balance → hold: no competing 0 W", () => {
		const d = decideSetpointRelease({
			session: owned({ owner: "grid_balance" }),
			handover: "hold",
			regularEnd: true,
		});
		assert.equal(d.shouldWriteZero, false);
		assert.equal(d.reason, "handover_hold");
	});

	it("grid_charge → external: no competing 0 W", () => {
		const d = decideSetpointRelease({ session: owned(), handover: "external", regularEnd: true });
		assert.equal(d.shouldWriteZero, false);
		assert.equal(d.reason, "handover_external");
	});

	it("restore/fault takeover: no competing 0 W", () => {
		const d = decideSetpointRelease({ session: owned(), handover: "restore_fault", regularEnd: false });
		assert.equal(d.shouldWriteZero, false);
		assert.equal(d.dropOwnership, true);
		assert.equal(d.reason, "handover_restore_fault");
	});

	it("higher-priority battery action: no competing 0 W", () => {
		const d = decideSetpointRelease({
			session: owned({ owner: "grid_balance" }),
			handover: "higher_priority",
			regularEnd: true,
		});
		assert.equal(d.shouldWriteZero, false);
		assert.equal(d.reason, "handover_higher_priority");
	});

	it("adapter restart / leftover setpoint without ownership: no 0 W", () => {
		const leftover = emptySetpointSession();
		const d = decideSetpointRelease({ session: leftover, handover: "none", regularEnd: true });
		assert.equal(d.shouldWriteZero, false);
		assert.equal(d.reason, "no_ownership");
	});

	it("handover wins over regular end", () => {
		assert.equal(
			resolveBatterySetpointHandover({
				hold: true,
				external: false,
				restoreOrFault: false,
				higherPriority: false,
			}),
			"hold",
		);
		assert.equal(
			resolveBatterySetpointHandover({
				hold: true,
				external: true,
				restoreOrFault: false,
				higherPriority: false,
			}),
			"external",
		);
		assert.equal(
			resolveBatterySetpointHandover({
				hold: true,
				external: true,
				restoreOrFault: true,
				higherPriority: false,
			}),
			"restore_fault",
		);
	});

	it("release_pending is set before the 0-write and cleared after", () => {
		const pending = markReleasePending(owned(), "regular_end");
		assert.equal(pending.releasePending, true);
		assert.equal(pending.releaseReason, "regular_end");
		assert.equal(pending.owner, "grid_charge");
		const done = applyZeroRelease(pending, "2026-08-17T08:01:00.000Z", "regular_end");
		assert.equal(done.releasePending, false);
		assert.equal(done.lastReleaseAt, "2026-08-17T08:01:00.000Z");
	});

	it("dryrun write does not mark live ownership", () => {
		const s = notePositiveSetpointWrite(emptySetpointSession(), "planned_charge", 2000, false);
		assert.equal(s.wrotePositive, true);
		assert.equal(s.wroteLive, false);
	});
});
