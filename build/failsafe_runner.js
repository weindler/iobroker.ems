"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopFailsafeRunner = exports.startFailsafeRunner = void 0;
const failsafe_1 = require("./addons/battery/failsafe");
const failsafe_2 = require("./addons/immersion_heater/failsafe");
const failsafe_3 = require("./addons/wallbox/failsafe");
const failsafe_common_1 = require("./failsafe_common");
let timer = null;
function startFailsafeRunner(adapter) {
    stopFailsafeRunner();
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    const { failsafeCheckIntervalSec } = (0, failsafe_common_1.failsafeTimeoutsFromConfig)(cfg, "global");
    timer = setInterval(() => {
        void (0, failsafe_2.runImmersionFailsafeCheck)(adapter).catch((e) => adapter.log.error(`failsafe immersion: ${e}`));
        void (0, failsafe_1.runBatteryFailsafeCheck)(adapter).catch((e) => adapter.log.error(`failsafe battery: ${e}`));
        void (0, failsafe_3.runWallboxFailsafeCheck)(adapter).catch((e) => adapter.log.error(`failsafe wallbox: ${e}`));
    }, failsafeCheckIntervalSec * 1000);
    adapter.log.info(`failsafe runner: interval ${failsafeCheckIntervalSec}s (immersion, battery, wallbox)`);
}
exports.startFailsafeRunner = startFailsafeRunner;
function stopFailsafeRunner() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
exports.stopFailsafeRunner = stopFailsafeRunner;
