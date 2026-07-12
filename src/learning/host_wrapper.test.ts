import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withLearningDataPath } from "./data_dir.js";
import { withHistoryBridge } from "./history_bridge.js";

class PrototypeHost {
	calls = 0;
	originalMarker = "unchanged";

	async probeMethod(): Promise<string> {
		this.calls += 1;
		return "ok";
	}

	async getStateAsync(_id: string): Promise<null> {
		return null;
	}

	async getHistoryAsync(
		_id: string,
		_options?: ioBroker.GetHistoryOptions,
	): Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }> {
		return { result: [] };
	}
}

class HostWithSendToAsync extends PrototypeHost {
	sendToAsync = async (): Promise<{ from: string }> => ({ from: "original" });
}

describe("learning host wrappers", () => {
	it("withLearningDataPath returns a distinct wrapper object", async () => {
		const adapter = {
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => "/tmp/ems-test",
		} as unknown as ioBroker.Adapter;
		const host = new PrototypeHost();

		const wrapped = withLearningDataPath(adapter, host);
		assert.notStrictEqual(wrapped, host);
	});

	it("withLearningDataPath keeps prototype methods callable", async () => {
		const adapter = {
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => "/tmp/ems-test",
		} as unknown as ioBroker.Adapter;
		const host = new PrototypeHost();

		const wrapped = withLearningDataPath(adapter, host) as PrototypeHost;
		assert.equal(typeof wrapped.probeMethod, "function");
		assert.equal(await wrapped.probeMethod(), "ok");
		// this ist der Wrapper (Object.create-Host), nicht die Original-Referenz
		assert.equal(host.calls, 0);
		assert.equal(wrapped.calls, 1);
	});

	it("withLearningDataPath does not add getAbsolutePath to the original", async () => {
		const adapter = {
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => "/tmp/ems-data",
		} as unknown as ioBroker.Adapter;
		const host = new PrototypeHost();

		const wrapped = withLearningDataPath(adapter, host);
		assert.equal(typeof wrapped.getAbsolutePath, "function");
		assert.equal(wrapped.getAbsolutePath(), "/tmp/ems-data");
		assert.equal(
			Object.prototype.hasOwnProperty.call(host, "getAbsolutePath"),
			false,
		);
	});

	it("withHistoryBridge returns a distinct wrapper and preserves prototype methods", async () => {
		const adapter = {
			sendTo: (
				_instance: string,
				_command: string,
				_message: unknown,
				cb?: (res?: ioBroker.Message | Error) => void,
			) => {
				cb?.({ message: { ok: true } } as ioBroker.Message);
			},
		} as unknown as ioBroker.Adapter;
		const host = new PrototypeHost();
		const wrapped = withHistoryBridge(adapter, host) as PrototypeHost & {
			sendToAsync?: (
				instanceName: string,
				command: string,
				message: unknown,
			) => Promise<ioBroker.Message | undefined>;
		};

		assert.notStrictEqual(wrapped, host);
		assert.equal(typeof wrapped.probeMethod, "function");
		assert.equal(await wrapped.probeMethod(), "ok");
		assert.equal(typeof wrapped.sendToAsync, "function");
		const res = await wrapped.sendToAsync!("history.0", "getHistory", {});
		assert.ok(res);
	});

	it("withHistoryBridge does not add sendToAsync to the original", async () => {
		const adapter = { sendTo: () => undefined } as unknown as ioBroker.Adapter;
		const host = new PrototypeHost();

		withHistoryBridge(adapter, host);
		assert.equal(Object.prototype.hasOwnProperty.call(host, "sendToAsync"), false);
	});

	it("withHistoryBridge does not mutate an existing original sendToAsync", async () => {
		const adapter = { sendTo: () => undefined } as unknown as ioBroker.Adapter;
		const host = new HostWithSendToAsync();
		const original = host.sendToAsync;

		const wrapped = withHistoryBridge(adapter, host) as HostWithSendToAsync & {
			sendToAsync: typeof host.sendToAsync;
		};
		assert.strictEqual(host.sendToAsync, original);
		assert.notStrictEqual(wrapped.sendToAsync, original);
		assert.deepEqual(await host.sendToAsync(), await original());
	});

	it("wrapper uses bridge sendToAsync implementation", async () => {
		const adapter = {
			sendTo: (
				_instance: string,
				_command: string,
				_message: unknown,
				cb?: (res?: ioBroker.Message | Error) => void,
			) => {
				cb?.({ message: { bridged: true } } as ioBroker.Message);
			},
		} as unknown as ioBroker.Adapter;
		const host = new PrototypeHost();
		const wrapped = withHistoryBridge(adapter, host) as PrototypeHost & {
			sendToAsync: (
				instanceName: string,
				command: string,
				message: unknown,
			) => Promise<ioBroker.Message | undefined>;
		};

		const res = await wrapped.sendToAsync("history.0", "getHistory", {});
		assert.ok(res);
		assert.equal((res as ioBroker.Message).message?.bridged, true);
	});

	it("independent wrappers do not affect each other", async () => {
		const adapterA = {
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => "/tmp/a",
		} as unknown as ioBroker.Adapter;
		const adapterB = {
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => "/tmp/b",
		} as unknown as ioBroker.Adapter;
		const hostA = new PrototypeHost();
		const hostB = new PrototypeHost();

		const wrappedA = withLearningDataPath(adapterA, hostA);
		const wrappedB = withLearningDataPath(adapterB, hostB);

		assert.equal(wrappedA.getAbsolutePath(), "/tmp/a");
		assert.equal(wrappedB.getAbsolutePath(), "/tmp/b");
		assert.equal(Object.prototype.hasOwnProperty.call(hostA, "getAbsolutePath"), false);
		assert.equal(Object.prototype.hasOwnProperty.call(hostB, "getAbsolutePath"), false);
	});
});
