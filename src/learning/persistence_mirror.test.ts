import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	ensureLearningPersistenceStates,
	mirrorLearningPersistenceToStates,
	restoreLearningPersistenceFromStates,
	type PersistenceMirrorHost,
} from "./persistence_mirror";

interface MockState {
	val: ioBroker.StateValue;
	ack: boolean;
}

function makeHost(baseDir: string): PersistenceMirrorHost & {
	states: Map<string, MockState>;
	objects: Set<string>;
} {
	const states = new Map<string, MockState>();
	const objects = new Set<string>();
	return {
		states,
		objects,
		getAbsolutePath: (category?: string) => (category ? path.join(baseDir, category) : baseDir),
		setObjectNotExistsAsync: async (id: string) => {
			objects.add(id);
			return undefined;
		},
		getStateAsync: async (id: string) => {
			const s = states.get(id);
			return s ? { val: s.val, ack: s.ack, ts: 0, lc: 0, from: "test" } : null;
		},
		setStateAsync: async (id: string, state: ioBroker.SettableState) => {
			states.set(id, { val: (state as MockState).val, ack: (state as MockState).ack ?? false });
			return undefined;
		},
		log: { info: () => undefined, warn: () => undefined, error: () => undefined },
	};
}

const BAT_DIR = "learning/battery_runtime";
const BAT_FILE = "battery_runtime_learning_v1.json";
const BAT_STATE = "learning.persistence.battery_runtime_json";

describe("learning persistence mirror", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-persist-"));
	});

	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
	});

	it("ensures channel + mirror states", async () => {
		const host = makeHost(tmp);
		await ensureLearningPersistenceStates(host);
		assert.ok(host.objects.has("learning.persistence"));
		assert.ok(host.objects.has(BAT_STATE));
		assert.ok(host.objects.has("learning.persistence.last_mirror"));
		assert.ok(host.objects.has("learning.persistence.last_restore"));
	});

	it("mirrors existing persist file into a json state", async () => {
		const host = makeHost(tmp);
		const dir = path.join(tmp, BAT_DIR);
		await fs.mkdir(dir, { recursive: true });
		const payload = JSON.stringify({ sample_days: 5, avg_night_discharge_pct: 12 });
		await fs.writeFile(path.join(dir, BAT_FILE), `${payload}\n`, "utf8");

		await mirrorLearningPersistenceToStates(host);

		const st = host.states.get(BAT_STATE);
		assert.ok(st, "mirror state must exist");
		assert.equal(JSON.parse(String(st!.val)).sample_days, 5);
		assert.ok(host.states.get("learning.persistence.last_mirror"));
	});

	it("does not create a state when no file exists", async () => {
		const host = makeHost(tmp);
		await mirrorLearningPersistenceToStates(host);
		assert.equal(host.states.get(BAT_STATE), undefined);
		assert.equal(host.states.get("learning.persistence.last_mirror"), undefined);
	});

	it("restores a missing file from the mirror state", async () => {
		const host = makeHost(tmp);
		const payload = JSON.stringify({ sample_days: 9 });
		host.states.set(BAT_STATE, { val: payload, ack: true });

		await restoreLearningPersistenceFromStates(host);

		const restored = await fs.readFile(path.join(tmp, BAT_DIR, BAT_FILE), "utf8");
		assert.equal(JSON.parse(restored).sample_days, 9);
		assert.ok(host.states.get("learning.persistence.last_restore"));
	});

	it("does not overwrite an existing file on restore", async () => {
		const host = makeHost(tmp);
		const dir = path.join(tmp, BAT_DIR);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, BAT_FILE), JSON.stringify({ sample_days: 1 }), "utf8");
		host.states.set(BAT_STATE, { val: JSON.stringify({ sample_days: 99 }), ack: true });

		await restoreLearningPersistenceFromStates(host);

		const onDisk = await fs.readFile(path.join(dir, BAT_FILE), "utf8");
		assert.equal(JSON.parse(onDisk).sample_days, 1);
	});

	it("ignores invalid json in the mirror state on restore", async () => {
		const host = makeHost(tmp);
		host.states.set(BAT_STATE, { val: "not-json{", ack: true });

		await restoreLearningPersistenceFromStates(host);

		await assert.rejects(() => fs.readFile(path.join(tmp, BAT_DIR, BAT_FILE), "utf8"));
	});

	it("round-trips: mirror then restore after file loss", async () => {
		const host = makeHost(tmp);
		const dir = path.join(tmp, BAT_DIR);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, BAT_FILE), JSON.stringify({ sample_days: 7 }), "utf8");

		await mirrorLearningPersistenceToStates(host);
		await fs.rm(dir, { recursive: true, force: true });
		await restoreLearningPersistenceFromStates(host);

		const restored = await fs.readFile(path.join(dir, BAT_FILE), "utf8");
		assert.equal(JSON.parse(restored).sample_days, 7);
	});
});
