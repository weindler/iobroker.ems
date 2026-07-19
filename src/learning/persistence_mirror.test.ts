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

	it("ensures lean status states only (no large json mirrors)", async () => {
		const host = makeHost(tmp);
		await ensureLearningPersistenceStates(host);
		assert.ok(host.objects.has("learning.persistence"));
		assert.ok(host.objects.has("learning.persistence.last_mirror"));
		assert.ok(host.objects.has("learning.persistence.last_restore"));
		assert.ok(host.objects.has("learning.persistence.files_present"));
		assert.equal(host.objects.has(BAT_STATE), false);
	});

	it("status tick counts files without writing json mirrors", async () => {
		const host = makeHost(tmp);
		const dir = path.join(tmp, BAT_DIR);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, BAT_FILE), `${JSON.stringify({ sample_days: 5 })}\n`, "utf8");

		await mirrorLearningPersistenceToStates(host);

		assert.equal(host.states.get(BAT_STATE), undefined);
		assert.equal(host.states.get("learning.persistence.files_present")?.val, 1);
		assert.ok(host.states.get("learning.persistence.last_mirror"));
	});

	it("restores a missing file from a legacy mirror state", async () => {
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
});
