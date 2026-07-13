import { PLANNER_IPC_BUDGET_BYTES } from "../planner_contracts/constants";

export function captureStdioChunk(existing: string, chunk: Buffer, budget = PLANNER_IPC_BUDGET_BYTES): string {
	const combined = existing + chunk.toString("utf8");
	if (Buffer.byteLength(combined, "utf8") <= budget) {
		return combined;
	}
	return combined.slice(0, budget);
}

export function extractWorkerStatusLine(stdout: string): string | null {
	const lines = stdout.split(/\r?\n/);
	for (const line of lines) {
		if (line.startsWith("PLANNER_WORKER_STATUS:")) {
			return line.slice("PLANNER_WORKER_STATUS:".length).trim();
		}
	}
	return null;
}
