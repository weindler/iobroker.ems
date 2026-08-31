import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runDailyAnalystForDate, type AiDailyAnalystHost } from "./run";
import type { AiAnalystProvider } from "./provider";

function silentProvider(): AiAnalystProvider {
	return {
		analyze: async () => {
			throw new Error("Provider darf bei disabled/no_token nicht aufgerufen werden");
		},
	};
}

function makeHost(config: Record<string, unknown>, dir: string): AiDailyAnalystHost {
	const states = new Map<string, ioBroker.StateValue>();
	return {
		getAbsolutePath: () => dir,
		config,
		getStateAsync: async (id) => {
			if (!states.has(id)) return null;
			return { val: states.get(id) } as ioBroker.State;
		},
		setStateAsync: async (id, state) => {
			states.set(id, (state as ioBroker.SettableState).val as ioBroker.StateValue);
		},
		setObjectNotExistsAsync: async () => undefined,
		log: { warn: () => undefined, debug: () => undefined, error: () => undefined },
	} as AiDailyAnalystHost & { setObjectNotExistsAsync: () => Promise<void> };
}

describe("runDailyAnalystForDate — EMS läuft ohne KI weiter", () => {
	it("status=disabled ohne Provider-Aufruf, wenn Admin-Modus disabled", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const r = await runDailyAnalystForDate(
			makeHost({ ai_analyst_mode: "disabled", ai_openai_api_key: "sk-test" }, dir),
			"2026-08-30",
			silentProvider(),
		);
		assert.equal(r.status, "disabled");
		assert.equal(r.ran, false);
		assert.equal(r.findings.length, 0);
	});

	it("status=no_token ohne Provider-Aufruf, wenn kein API-Key gesetzt ist", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const r = await runDailyAnalystForDate(
			makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "" }, dir),
			"2026-08-30",
			silentProvider(),
		);
		assert.equal(r.status, "no_token");
		assert.equal(r.ran, false);
		assert.equal(r.findings.length, 0);
	});
});
