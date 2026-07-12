export {
	startDiagnosticMode,
	stopDiagnosticMode,
	isDiagnosticModeActive,
	diagnosticModeStatus,
	recordDiagnosticEvent,
	recordErrorLog,
	collectSupportLogEntries,
	totalSupportLogBytes,
	resetDiagnosticModeForTest,
	resetDiagnosticOnStartup,
	DIAGNOSTIC_DEFAULT_DURATION_MIN,
	DIAGNOSTIC_MAX_DURATION_MIN,
	DIAGNOSTIC_ALLOWED_DURATIONS,
} from "./diagnostic_mode";

export { appendNdjsonRotating, readAllNdjson } from "./log_rotation";

import type { ExportServiceHost } from "../backup/types";
import { runSupportExport } from "../backup/service";
import { collectSupportLogEntries } from "./diagnostic_mode";

export async function runSupportBundleExport(host: ExportServiceHost) {
	return runSupportExport(host, async (h) => collectSupportLogEntries(h));
}
