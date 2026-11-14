"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withExpertCommon = withExpertCommon;
exports.expertStateCommon = expertStateCommon;
/** ioBroker-supported expert surface marker (`common.expert`). */
function withExpertCommon(common) {
    return { ...common, expert: true };
}
function expertStateCommon(partial) {
    return withExpertCommon({ ...partial, expert: true });
}
