"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expertStateCommon = exports.withExpertCommon = void 0;
/** ioBroker-supported expert surface marker (`common.expert`). */
function withExpertCommon(common) {
    return { ...common, expert: true };
}
exports.withExpertCommon = withExpertCommon;
function expertStateCommon(partial) {
    return withExpertCommon({ ...partial, expert: true });
}
exports.expertStateCommon = expertStateCommon;
