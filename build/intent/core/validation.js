"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.candidateUsable = exports.isExpiredAt = exports.parseOptionalSoc = exports.isFiniteNumber = void 0;
function isFiniteNumber(n) {
    return Number.isFinite(n);
}
exports.isFiniteNumber = isFiniteNumber;
function parseOptionalSoc(raw) {
    if (raw === null || raw === undefined || raw === "") {
        return { value: null, status: "missing" };
    }
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", ".").trim());
    if (!Number.isFinite(n)) {
        return { value: null, status: "invalid" };
    }
    if (n < 0 || n > 100) {
        return { value: null, status: "invalid" };
    }
    return { value: n, status: "valid" };
}
exports.parseOptionalSoc = parseOptionalSoc;
function isExpiredAt(iso, now) {
    if (!iso) {
        return false;
    }
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) {
        return false;
    }
    return t < now.getTime();
}
exports.isExpiredAt = isExpiredAt;
function candidateUsable(status, validUntil, now) {
    if (status === "invalid" || status === "missing") {
        return false;
    }
    if (status === "expired") {
        return false;
    }
    if (validUntil && isExpiredAt(validUntil, now)) {
        return false;
    }
    return status === "valid";
}
exports.candidateUsable = candidateUsable;
