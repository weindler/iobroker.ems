import type { HistoryQueryHost } from "./history_query";

type SendToAdapter = Pick<ioBroker.Adapter, "sendTo">;

/** Callback-sendTo wie javascript.0 — promisified sendToAsync liefert teils leer/hängt. */
export function sendToHistoryGetHistory(
	adapter: SendToAdapter,
	stateId: string,
	options: ioBroker.GetHistoryOptions,
): Promise<{ result?: ioBroker.GetHistoryResult; error?: unknown }> {
	return new Promise((resolve, reject) => {
		try {
			adapter.sendTo(
				"history.0",
				"getHistory",
				{ id: stateId, options },
				(res?: ioBroker.Message | Error) => {
					if (res instanceof Error) {
						reject(res);
						return;
					}
					if (res && typeof res === "object") {
						const msg = res as ioBroker.Message;
						if (msg.message && typeof msg.message === "object") {
							resolve(msg.message as { result?: ioBroker.GetHistoryResult; error?: unknown });
							return;
						}
						resolve(msg as unknown as { result?: ioBroker.GetHistoryResult; error?: unknown });
						return;
					}
					reject(new Error("history.0: empty getHistory response"));
				},
			);
		} catch (e) {
			reject(e);
		}
	});
}

export function withHistoryBridge<A extends HistoryQueryHost>(adapter: SendToAdapter, host: A): A {
	return {
		...host,
		sendToAsync: async (instanceName, command, message) =>
			new Promise((resolve, reject) => {
				try {
					adapter.sendTo(instanceName, command, message, (res?: ioBroker.Message | Error) => {
						if (res instanceof Error) {
							reject(res);
							return;
						}
						if (res && typeof res === "object") {
							resolve(res);
							return;
						}
						reject(new Error(`${instanceName}:${command} empty response`));
					});
				} catch (e) {
					reject(e);
				}
			}),
	};
}
