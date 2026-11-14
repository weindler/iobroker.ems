"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnergyforecastHttpError = exports.EF_API_URL = void 0;
exports.fetchEnergyforecast = fetchEnergyforecast;
const parse_1 = require("./parse");
exports.EF_API_URL = "https://www.energyforecast.de/api/v2/forecast";
class EnergyforecastHttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.EnergyforecastHttpError = EnergyforecastHttpError;
/** Ruft die Prognose ab. Der Token steckt in der URL und taucht in keiner Fehlermeldung auf. */
async function fetchEnergyforecast(token, fetchFn = fetch, timeoutMs = 20_000) {
    const url = `${exports.EF_API_URL}?token=${encodeURIComponent(token)}`;
    let response;
    try {
        response = await fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    }
    catch (e) {
        throw new Error((0, parse_1.redactToken)(e instanceof Error ? e.message : String(e), token));
    }
    if (!response.ok) {
        const hint = response.status === 401 || response.status === 403
            ? "Token ungültig oder nicht berechtigt"
            : response.status === 429
                ? "Tageslimit der Anfragen erreicht"
                : "Serverfehler";
        throw new EnergyforecastHttpError(response.status, `HTTP ${response.status}: ${hint}`);
    }
    return response.json();
}
