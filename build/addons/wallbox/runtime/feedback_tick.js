"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tickWallboxFeedback = exports.isWallboxFeedbackStatusTerminal = void 0;
const feedback_1 = require("./feedback");
/** Terminal-Status — kein weiterer Tick nötig (erfolgreich, endgültig gescheitert, oder gar nicht erforderlich). */
function isWallboxFeedbackStatusTerminal(status) {
    return status === "matched" || status === "mismatch" || status === "timeout" || status === "invalid" || status === "not_required";
}
exports.isWallboxFeedbackStatusTerminal = isWallboxFeedbackStatusTerminal;
async function readActualValues(host, contract) {
    const values = {};
    for (const exp of contract.expectations) {
        try {
            const st = await host.getForeignStateAsync(exp.readbackStateId);
            if (st && st.val !== undefined && st.val !== null) {
                values[exp.readbackStateId] = st.val;
            }
        }
        catch {
            // nicht lesbar → bleibt undefined, evaluateWallboxFeedback behandelt das als "unavailable"
        }
    }
    return values;
}
/**
 * Liest reale Rücklese-Werte und wertet den Feedback-Contract aus.
 * Reine IO-Ummantelung um die pure Funktion `evaluateWallboxFeedback`.
 */
async function tickWallboxFeedback(host, contract, writeTimestampMs, nowMs) {
    if (!contract.required || contract.expectations.length === 0) {
        return contract;
    }
    const actualValues = await readActualValues(host, contract);
    return (0, feedback_1.evaluateWallboxFeedback)({
        contract,
        actualValues,
        evaluationTimeMs: nowMs,
        writeTimestampMs,
    });
}
exports.tickWallboxFeedback = tickWallboxFeedback;
