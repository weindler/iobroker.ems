"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerInputValidationError = exports.PlannerPreparedInputBudgetError = void 0;
class PlannerPreparedInputBudgetError extends Error {
    byteSize;
    budgetBytes;
    constructor(byteSize, budgetBytes) {
        super(`prepared input exceeds budget: ${byteSize} > ${budgetBytes} bytes`);
        this.byteSize = byteSize;
        this.budgetBytes = budgetBytes;
        this.name = "PlannerPreparedInputBudgetError";
    }
}
exports.PlannerPreparedInputBudgetError = PlannerPreparedInputBudgetError;
class PlannerInputValidationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PlannerInputValidationError";
    }
}
exports.PlannerInputValidationError = PlannerInputValidationError;
