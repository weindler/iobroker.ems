/** Interner EMS-Lebenszeichen-Zähler (Hybrid C — ohne Dauer-Writes). */

let lastActivityMs = Date.now();

export function touchEmsActivity(): void {
	lastActivityMs = Date.now();
}

export function msSinceEmsActivity(): number {
	return Date.now() - lastActivityMs;
}

/** stateChange-ID relativ zur Adapter-Instanz. */
export function isEmsActivityStateId(stateId: string, namespacePrefix: string): boolean {
	if (!stateId.startsWith(namespacePrefix)) {
		return false;
	}
	const rel = stateId.slice(namespacePrefix.length);
	return (
		rel.startsWith("ems_mirror.") ||
		rel === "command.inbox" ||
		rel === "command.last_result"
	);
}
