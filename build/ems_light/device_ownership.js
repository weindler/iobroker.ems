"use strict";
/**
 * Generisches Ownership-/Manual-Override-Modell (Klima-/Ownership-Block).
 *
 * Vorlage (wiederverwendet, nicht neu erfunden): `addons/battery/runtime/ownership.ts`
 * (`OwnershipState`/`isForeignManualControl`) und die Wallbox-EVCC-Authority-Hysterese
 * (`addons/wallbox/ev_foundation/execution/types.ts`, `EV_AUTHORITY_HOLD_MS`/`_CONFIRM_MS`).
 *
 * Zustände: „ems“ (EMS steuert), „user“ (erkannter manueller Eingriff — EMS pausiert
 * zeitbegrenzt) und „external“ (Typ-Wert für künftige, technisch unterscheidbare Fremdsysteme;
 * aus einem reinen State-Vergleich ist „Nutzer“ vs. „fremdes System“ nicht unterscheidbar —
 * beide lösen denselben Override aus, siehe `evaluateDeviceOwnership`).
 *
 * Event-Semantik: ein erkannter Widerspruch EMS-Wunsch vs. Ist startet genau EINEN
 * zeitbegrenzten Override. Derselbe fortlaufende Mismatch (Polling, unverändertes Feedback,
 * Planner-Soll) verlängert `overrideUntilIso` nicht. Ein neues Event ist nur eine echte
 * Lücke (Mismatch weg, dann wieder da) oder ein anderer Mismatch-Kind (z. B. ON→OFF→ON).
 * Nach Ablauf verhindert `lastMismatchKind` den Sofort-Retrigger, solange derselbe
 * Widerspruch unverändert anliegt.
 *
 * Kein neues Governance-Framework: reine, ioBroker-freie Funktionen, ein Zeit-begrenzter
 * Override pro Gerät/Unit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOwnershipOverrideActive = exports.evaluateDeviceOwnership = exports.emptyDeviceOwnershipState = void 0;
function emptyDeviceOwnershipState() {
    return {
        owner: "ems",
        overrideUntilIso: null,
        triggeredAtIso: null,
        reasonDe: "",
        lastMismatchKind: "",
    };
}
exports.emptyDeviceOwnershipState = emptyDeviceOwnershipState;
function normalizeKind(kind) {
    return kind === "manual_on" || kind === "manual_off" ? kind : "";
}
function storedKind(kind) {
    return kind === "manual_off" ? "manual_off" : "manual_on";
}
function kindLabel(kind) {
    if (kind === "manual_on")
        return "Manuelles Einschalten";
    if (kind === "manual_off")
        return "Manuelles Ausschalten";
    return "Manueller Eingriff";
}
function startUserOverride(input, triggeredAtIso) {
    const untilMs = input.nowMs + Math.max(0, input.overrideDurationMs);
    const untilIso = new Date(untilMs).toISOString();
    return {
        owner: "user",
        overrideUntilIso: untilIso,
        triggeredAtIso,
        reasonDe: `${kindLabel(input.mismatchKind)} erkannt — EMS-Steuerung pausiert bis ${untilIso}.`,
        lastMismatchKind: storedKind(input.mismatchKind),
    };
}
function keepActiveOverride(previous, kind) {
    return {
        ...previous,
        lastMismatchKind: previous.lastMismatchKind || storedKind(kind),
    };
}
function emsAfterConsumedMismatch(previous, kind) {
    const expiredReason = "Manual-Override abgelaufen — EMS-Steuerung übernommen.";
    return {
        owner: "ems",
        overrideUntilIso: null,
        triggeredAtIso: previous.triggeredAtIso,
        reasonDe: previous.owner === "user" || previous.reasonDe === expiredReason ? expiredReason : previous.reasonDe || expiredReason,
        lastMismatchKind: previous.lastMismatchKind || storedKind(kind),
    };
}
/**
 * Fortlaufendes (kein neues) Event:
 * - Alt-Persist ohne `lastMismatchKind` während aktivem Override: nicht als neues Event werten.
 * - Bekannter Kind und gleicher (oder unspezifischer) Kind erneut: dasselbe Event.
 * - `lastMismatchKind === ""` nach einer Lücke: kein Fortlauf — neues Event.
 */
function isContinuedSameEvent(previous, kind, prevActive) {
    const tracked = previous.lastMismatchKind !== undefined;
    if (!tracked)
        return prevActive;
    const prevKind = previous.lastMismatchKind ?? "";
    if (prevKind === "")
        return false;
    return kind === "" || kind === prevKind;
}
function evaluateDeviceOwnership(input) {
    const nowIso = new Date(input.nowMs).toISOString();
    const kind = normalizeKind(input.mismatchKind);
    if (input.safetyOverride) {
        return {
            owner: "ems",
            overrideUntilIso: null,
            triggeredAtIso: input.previous.triggeredAtIso,
            reasonDe: "Safety/kritischer Zustand — Manual-Override übersteuert, EMS behält Kontrolle.",
            lastMismatchKind: "",
        };
    }
    const prevUntilMs = input.previous.overrideUntilIso ? Date.parse(input.previous.overrideUntilIso) : NaN;
    const prevActive = Number.isFinite(prevUntilMs) && prevUntilMs > input.nowMs;
    if (input.mismatchDetected) {
        if (prevActive) {
            if (isContinuedSameEvent(input.previous, kind, true)) {
                return keepActiveOverride(input.previous, input.mismatchKind);
            }
            // Neues Event während aktivem Override (Lücke oder anderer Kind) — Timer neu setzen.
            return startUserOverride(input, nowIso);
        }
        if (isContinuedSameEvent(input.previous, kind, false)) {
            // Ablauf: unveränderter Widerspruch darf nicht sofort einen neuen Override starten.
            return emsAfterConsumedMismatch(input.previous, input.mismatchKind);
        }
        return startUserOverride(input, nowIso);
    }
    if (prevActive) {
        // Override halten, Lücke merken — späteres OFF→ON darf neu starten.
        return { ...input.previous, lastMismatchKind: "" };
    }
    return emptyDeviceOwnershipState();
}
exports.evaluateDeviceOwnership = evaluateDeviceOwnership;
function isOwnershipOverrideActive(state, nowMs) {
    if (state.overrideUntilIso === null)
        return false;
    const untilMs = Date.parse(state.overrideUntilIso);
    return Number.isFinite(untilMs) && untilMs > nowMs;
}
exports.isOwnershipOverrideActive = isOwnershipOverrideActive;
