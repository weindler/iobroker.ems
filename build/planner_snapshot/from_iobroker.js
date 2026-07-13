"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlannerInputSnapshotFromIoBroker = void 0;
const builder_1 = require("./builder");
const source_1 = require("./source");
const iobroker_source_1 = require("./iobroker_source");
/**
 * Builds a planner input snapshot from ioBroker reads.
 * No side effects — does not write files or spawn workers.
 */
async function buildPlannerInputSnapshotFromIoBroker(host, options = {}) {
    const raw = new iobroker_source_1.IoBrokerPlannerSnapshotSource(host, options.clock);
    const cached = new source_1.CachedPlannerSnapshotSource(raw);
    return (0, builder_1.buildPlannerInputSnapshot)(cached);
}
exports.buildPlannerInputSnapshotFromIoBroker = buildPlannerInputSnapshotFromIoBroker;
