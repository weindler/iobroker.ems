"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWinterGridChargeTick = void 0;
const ems_mirror_watch_1 = require("./ems_mirror_watch");
/** Poll-Fallback: EMS-Spiegel (Modus-Sequenz) auch ohne stateChange. */
async function runWinterGridChargeTick(adapter) {
    await (0, ems_mirror_watch_1.handleEmsMirrorStateChange)(adapter);
}
exports.runWinterGridChargeTick = runWinterGridChargeTick;
