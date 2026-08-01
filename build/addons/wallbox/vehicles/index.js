"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @deprecated Fat wallbox vehicle profiles (state trees under addons.wallbox.vehicles.*)
 * were removed in v0.1.227. Use `../vehicle_map` for optional EVCC-id → capacity/maxW.
 * Modules remain for transitional imports / cleanup helpers only — not called from runtime.
 */
__exportStar(require("./types"), exports);
__exportStar(require("./vehicle_id"), exports);
__exportStar(require("./config"), exports);
__exportStar(require("./normalize"), exports);
__exportStar(require("./readiness"), exports);
__exportStar(require("./resolve"), exports);
__exportStar(require("./soc"), exports);
__exportStar(require("./soc_energy"), exports);
__exportStar(require("./baseline"), exports);
__exportStar(require("./snapshot"), exports);
__exportStar(require("./charge_limits"), exports);
__exportStar(require("./ensure_states"), exports);
__exportStar(require("./runtime"), exports);
