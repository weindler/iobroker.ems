import * as os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { buildPlannerInputSnapshot } from "./builder.js";
import { CachedPlannerSnapshotSource } from "./source.js";
import {
	IoBrokerPlannerSnapshotSource,
	normalizeIoBrokerState,
} from "./iobroker_source.js";
import { plannerRelevantConfigFromHost } from "./config_from_adapter.js";
import { buildPlannerInputSnapshotFromIoBroker } from "./from_iobroker.js";
import { createParityFixtureSource, createParityIoBrokerHost } from "./parity_fixture.js";
import { resolveAllowedPlannerJsonPath } from "./allowed_paths.js";
import { HOUSE_LOAD_LEARNING_FILE } from "./allowed_paths.js";
import { assertCoverageMatrixComplete } from "./coverage.js";
import { PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES } from "./constants.js";

describe("iobroker planner snapshot source", () => {
	it("normalizes state values preserving 0, false, and empty string", () => {
		assert.deepEqual(normalizeIoBrokerState({ val: 0, ts: 1, ack: true } as ioBroker.State).value, 0);
		assert.deepEqual(normalizeIoBrokerState({ val: false, ts: 1, ack: true } as ioBroker.State).value, false);
		assert.deepEqual(normalizeIoBrokerState({ val: "", ts: 1, ack: true } as ioBroker.State).value, "");
	});

	it("normalizes missing state as null", () => {
		assert.deepEqual(normalizeIoBrokerState(null).value, null);
		assert.deepEqual(normalizeIoBrokerState(undefined).value, null);
	});

	it("normalizes foreign state values", async () => {
		const host = createParityIoBrokerHost();
		const source = new IoBrokerPlannerSnapshotSource(host);
		const st = await source.readForeignState("weather.0.forecast.current.temp");
		assert.equal(st.value, 19.2);
	});

	it("config whitelist excludes credentials", () => {
		const cfg = plannerRelevantConfigFromHost({
			config: {
				global_execution_mode: "dryrun",
				tibber_api_token: "secret-token",
				admin_password: "hunter2",
				learning_weather_forecast_temp_state: "a",
				learning_weather_actual_temp_state: "b",
			},
			getAbsolutePath: (c?: string) => `/data/${c ?? ""}`,
		});
		assert.equal(cfg.executionMode, "dryrun");
		assert.ok(!JSON.stringify(cfg).includes("secret-token"));
		assert.ok(!JSON.stringify(cfg).includes("hunter2"));
	});

	it("config whitelist does not return native config object", () => {
		const native = { global_execution_mode: "live", nested: { token: "x" } };
		const cfg = plannerRelevantConfigFromHost({
			config: native,
			getAbsolutePath: () => "/data/x",
		});
		assert.notEqual(cfg as unknown, native);
		assert.equal(typeof cfg.timezone, "string");
	});

	it("readJsonFile rejects traversal paths", async () => {
		const host = {
			...createParityIoBrokerHost(),
			getAbsolutePath: (category?: string) => `/tmp/ems-parity-test/${category ?? ""}`,
		};
		const source = new IoBrokerPlannerSnapshotSource(host);
		const allowed = resolveAllowedPlannerJsonPath(host.getAbsolutePath!, "house_load_learning");
		await assert.rejects(
			() => source.readJsonFile(path.join(path.dirname(allowed), "..", HOUSE_LOAD_LEARNING_FILE)),
			/planner snapshot file path not allowed|path outside allowed root/,
		);
	});

	it("readJsonFile returns null for missing optional file", async () => {
		const tmpBase = path.join(os.tmpdir(), `ems-parity-json-${process.pid}`);
		const host = {
			...createParityIoBrokerHost(),
			getAbsolutePath: (category?: string) => path.join(tmpBase, category ?? ""),
		};
		const source = new IoBrokerPlannerSnapshotSource(host);
		const allowed = resolveAllowedPlannerJsonPath(host.getAbsolutePath, "house_load_learning");
		const result = await source.readJsonFile(allowed);
		assert.equal(result, null);
	});

	it("readJsonFile fails closed when getAbsolutePath is missing", async () => {
		const source = new IoBrokerPlannerSnapshotSource(createParityIoBrokerHost());
		await assert.rejects(
			() => source.readJsonFile("/tmp/house_load_learning_v1.json"),
			/getAbsolutePath unavailable/,
		);
	});

	it("readJsonFile rejects empty getAbsolutePath root", () => {
		const host = {
			...createParityIoBrokerHost(),
			getAbsolutePath: () => "",
		};
		assert.throws(
			() => resolveAllowedPlannerJsonPath(host.getAbsolutePath, "house_load_learning"),
			/empty planner snapshot root/,
		);
	});

	it("readJsonFile rejects invalid JSON", async () => {
		const tmpBase = path.join(os.tmpdir(), `ems-parity-json-invalid-${process.pid}`);
		const host = {
			...createParityIoBrokerHost(),
			getAbsolutePath: (category?: string) => path.join(tmpBase, category ?? ""),
		};
		const source = new IoBrokerPlannerSnapshotSource(host);
		const allowed = resolveAllowedPlannerJsonPath(host.getAbsolutePath, "house_load_learning");
		const { writeFile, mkdir } = await import("node:fs/promises");
		await mkdir(path.dirname(allowed), { recursive: true });
		await writeFile(allowed, "{not-json", { mode: 0o600 });
		await assert.rejects(() => source.readJsonFile(allowed), /invalid planner snapshot JSON/);
	});

	it("supports injectable clock", () => {
		const fixed = new Date("2026-01-15T08:00:00.000Z");
		const source = new IoBrokerPlannerSnapshotSource(createParityIoBrokerHost(), () => fixed);
		assert.equal(source.now().toISOString(), fixed.toISOString());
	});

	it("cached source reads each id once through ioBroker host", async () => {
		let stateReads = 0;
		const host = createParityIoBrokerHost();
		const wrapped = {
			...host,
			getStateAsync: async (id: string) => {
				stateReads += 1;
				return host.getStateAsync(id);
			},
		};
		const cached = new CachedPlannerSnapshotSource(new IoBrokerPlannerSnapshotSource(wrapped));
		await cached.readState("live.pv.power_w");
		await cached.readState("live.pv.power_w");
		await cached.readForeignState("weather.0.forecast.current.temp");
		await cached.readForeignState("weather.0.forecast.current.temp");
		assert.equal(stateReads, 1);
	});
});

describe("snapshot parity fixture vs ioBroker source", () => {
	it("produces identical snapshot and inputRevision", async () => {
		const direct = await buildPlannerInputSnapshot(createParityFixtureSource());
		const viaIo = await buildPlannerInputSnapshotFromIoBroker(createParityIoBrokerHost(), {
			clock: () => new Date("2026-07-01T12:00:00.000Z"),
		});
		assert.equal(direct.inputRevision, viaIo.inputRevision);
		assert.deepEqual(direct, viaIo);
	});

	it("coverage matrix remains without unresolved", () => {
		assertCoverageMatrixComplete();
	});

	it("parity snapshot stays within budget", async () => {
		const snap = await buildPlannerInputSnapshotFromIoBroker(createParityIoBrokerHost(), {
			clock: () => new Date("2026-07-01T12:00:00.000Z"),
		});
		const bytes = Buffer.byteLength(`${JSON.stringify(snap, null, 2)}\n`, "utf8");
		assert.ok(bytes <= PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES);
	});

	it("serialized snapshot contains no configured absolute data paths", async () => {
		const tmpBase = path.join(os.tmpdir(), `ems-snapshot-paths-${process.pid}`);
		const host = {
			...createParityIoBrokerHost(),
			getAbsolutePath: (category?: string) => path.join(tmpBase, category ?? ""),
		};
		const snap = await buildPlannerInputSnapshotFromIoBroker(host, {
			clock: () => new Date("2026-07-01T12:00:00.000Z"),
		});
		const json = JSON.stringify(snap);
		assert.ok(!json.includes(tmpBase));
		assert.ok(!json.includes("dataPaths"));
		assert.ok(!json.includes("house_load_learning_v1.json"));
	});
});

describe("import boundaries", () => {
	it("iobroker source does not import adapter core or runtime engines", () => {
		const text = readFileSync(path.join(process.cwd(), "src/planner_snapshot/iobroker_source.ts"), "utf8");
		for (const forbidden of ["adapter-core", "runtime/engine", "planner_worker/main", "ems_light"]) {
			assert.ok(!text.includes(forbidden), `iobroker_source must not reference ${forbidden}`);
		}
	});
});
