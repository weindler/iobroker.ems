"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerInputSnapshotBudgetError = void 0;
class PlannerInputSnapshotBudgetError extends Error {
    byteSize;
    budgetBytes;
    constructor(byteSize, budgetBytes) {
        super(`input snapshot exceeds budget: ${byteSize} > ${budgetBytes} bytes`);
        this.byteSize = byteSize;
        this.budgetBytes = budgetBytes;
        this.name = "PlannerInputSnapshotBudgetError";
    }
}
exports.PlannerInputSnapshotBudgetError = PlannerInputSnapshotBudgetError;
