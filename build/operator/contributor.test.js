"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const contributor_1 = require("./contributor");
(0, node_test_1.describe)("operator contributor refs", () => {
    (0, node_test_1.it)("addon contributor uses valid addon id", () => {
        const ref = (0, contributor_1.addonContributorRef)("pv_forecast");
        strict_1.default.equal(ref.type, "addon");
        strict_1.default.equal(ref.id, "pv_forecast");
        strict_1.default.equal(ref.addonId, "pv_forecast");
    });
    (0, node_test_1.it)("system contributor house_load has no addon id", () => {
        const ref = (0, contributor_1.systemContributorRef)("house_load");
        strict_1.default.equal(ref.type, "system");
        strict_1.default.equal(ref.id, "house_load");
        strict_1.default.equal(ref.addonId, null);
    });
    (0, node_test_1.it)("contributor ref is deterministically serializable", () => {
        const ref = (0, contributor_1.systemContributorRef)("grid_supply");
        const raw = (0, contributor_1.serializeContributorRef)(ref);
        strict_1.default.equal(raw, '{"type":"system","id":"grid_supply","addonId":null}');
        strict_1.default.deepEqual((0, contributor_1.parseContributorRef)(raw), ref);
        strict_1.default.equal((0, contributor_1.contributorRefKey)(ref), "system:grid_supply");
    });
});
