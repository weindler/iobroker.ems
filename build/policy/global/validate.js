"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateGlobalPolicy = void 0;
const validate_1 = require("../core/validate");
function validateGlobalPolicy(policy) {
    return (0, validate_1.validatePolicySnapshot)(policy, { failClosedOnSecurity: true });
}
exports.validateGlobalPolicy = validateGlobalPolicy;
