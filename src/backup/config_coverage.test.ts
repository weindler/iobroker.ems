import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { isAllowedConfigKey } from "./collect_config";
import { isSecretKey } from "./schema";

/** Felder im Admin, die keine gespeicherte Einstellung sind (Knöpfe, Anzeigen, Auswahl-Hilfen). */
const UI_ONLY = new Set([
	"_storageReportResult",
	"confirm",
	"current",
	"diagnostic_duration_min",
	"dryrun",
	"energyforecastLink",
	"live",
	"off",
	"restore_selected_file",
	"manage_backup_file",
]);
const NON_DATA_TYPES = new Set(["panel", "header", "staticText", "sendTo", "divider", "tabs", "accordion", "alive", "infoBox"]);

function collectConfigKeys(node: unknown, out: Set<string>): void {
	if (!node || typeof node !== "object") return;
	for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
		if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { type?: unknown }).type === "string") {
			if (!NON_DATA_TYPES.has((v as { type: string }).type) && !/^\d+$/.test(k)) out.add(k);
		}
		collectConfigKeys(v, out);
	}
}

describe("Backup deckt alle Admin-Einstellungen ab", () => {
	it("jede Einstellung ist im Backup erlaubt, ein Geheimnis oder nur eine Anzeige", () => {
		const raw = fs.readFileSync(path.join(__dirname, "../../admin/jsonConfig.json"), "utf8");
		const keys = new Set<string>();
		collectConfigKeys(JSON.parse(raw), keys);
		const missing = [...keys].filter((k) => !UI_ONLY.has(k) && !isSecretKey(k) && !isAllowedConfigKey(k)).sort();
		assert.deepEqual(missing, [], `Nicht im Backup: ${missing.join(", ")}`);
	});
	it("Tokens und Passwörter bleiben draußen", () => {
		assert.equal(isAllowedConfigKey("energyforecast_token"), false);
		assert.equal(isAllowedConfigKey("ai_openai_api_key"), false);
		assert.equal(isAllowedConfigKey("notify_enabled"), true);
		assert.equal(isAllowedConfigKey("statistics_compare_tariff_ct_per_kwh"), true);
	});
});
