"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withHistoryBridge = exports.sendToHistoryGetHistory = void 0;
/** Callback-sendTo wie javascript.0 — promisified sendToAsync liefert teils leer/hängt. */
function sendToHistoryGetHistory(adapter, stateId, options) {
    return new Promise((resolve, reject) => {
        try {
            adapter.sendTo("history.0", "getHistory", { id: stateId, options }, (res) => {
                if (res instanceof Error) {
                    reject(res);
                    return;
                }
                if (res && typeof res === "object") {
                    const msg = res;
                    if (msg.message && typeof msg.message === "object") {
                        resolve(msg.message);
                        return;
                    }
                    resolve(msg);
                    return;
                }
                reject(new Error("history.0: empty getHistory response"));
            });
        }
        catch (e) {
            reject(e);
        }
    });
}
exports.sendToHistoryGetHistory = sendToHistoryGetHistory;
function withHistoryBridge(adapter, host) {
    return {
        ...host,
        sendToAsync: async (instanceName, command, message) => new Promise((resolve, reject) => {
            try {
                adapter.sendTo(instanceName, command, message, (res) => {
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
            }
            catch (e) {
                reject(e);
            }
        }),
    };
}
exports.withHistoryBridge = withHistoryBridge;
