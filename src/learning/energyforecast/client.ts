import { redactToken } from "./parse";

export const EF_API_URL = "https://www.energyforecast.de/api/v2/forecast";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class EnergyforecastHttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** Ruft die Prognose ab. Der Token steckt in der URL und taucht in keiner Fehlermeldung auf. */
export async function fetchEnergyforecast(
	token: string,
	fetchFn: FetchLike = fetch,
	timeoutMs = 20_000,
): Promise<unknown> {
	const url = `${EF_API_URL}?token=${encodeURIComponent(token)}`;
	let response: Response;
	try {
		response = await fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
	} catch (e) {
		throw new Error(redactToken(e instanceof Error ? e.message : String(e), token));
	}
	if (!response.ok) {
		const hint =
			response.status === 401 || response.status === 403
				? "Token ungültig oder nicht berechtigt"
				: response.status === 429
					? "Tageslimit der Anfragen erreicht"
					: "Serverfehler";
		throw new EnergyforecastHttpError(response.status, `HTTP ${response.status}: ${hint}`);
	}
	return response.json();
}
