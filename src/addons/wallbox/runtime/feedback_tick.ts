import type { WallboxFeedbackContract } from "./feedback";
import { evaluateWallboxFeedback } from "./feedback";

export interface WallboxFeedbackReadHost {
	getForeignStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
}

/** Terminal-Status — kein weiterer Tick nötig (erfolgreich, endgültig gescheitert, oder gar nicht erforderlich). */
export function isWallboxFeedbackStatusTerminal(status: WallboxFeedbackContract["status"]): boolean {
	return status === "matched" || status === "mismatch" || status === "timeout" || status === "invalid" || status === "not_required";
}

async function readActualValues(
	host: WallboxFeedbackReadHost,
	contract: WallboxFeedbackContract,
): Promise<Record<string, unknown>> {
	const values: Record<string, unknown> = {};
	for (const exp of contract.expectations) {
		try {
			const st = await host.getForeignStateAsync(exp.readbackStateId);
			if (st && st.val !== undefined && st.val !== null) {
				values[exp.readbackStateId] = st.val;
			}
		} catch {
			// nicht lesbar → bleibt undefined, evaluateWallboxFeedback behandelt das als "unavailable"
		}
	}
	return values;
}

/**
 * Liest reale Rücklese-Werte und wertet den Feedback-Contract aus.
 * Reine IO-Ummantelung um die pure Funktion `evaluateWallboxFeedback`.
 */
export async function tickWallboxFeedback(
	host: WallboxFeedbackReadHost,
	contract: WallboxFeedbackContract,
	writeTimestampMs: number,
	nowMs: number,
): Promise<WallboxFeedbackContract> {
	if (!contract.required || contract.expectations.length === 0) {
		return contract;
	}
	const actualValues = await readActualValues(host, contract);
	return evaluateWallboxFeedback({
		contract,
		actualValues,
		evaluationTimeMs: nowMs,
		writeTimestampMs,
	});
}
