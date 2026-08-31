import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { allowedKeysByType, validateJsonConfig } from "./validate_json_config";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCHEMA_PATH = path.join(ROOT, "src/tools/admin_config/iobroker_jsonConfig.schema.json");
const CONFIG_PATH = path.join(ROOT, "admin/jsonConfig.json");

function loadJson(filePath: string): unknown {
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

describe("admin jsonConfig vs ioBroker schema", () => {
	const schema = loadJson(SCHEMA_PATH) as { definitions?: { sendToProps?: { properties?: Record<string, unknown> } } };
	const config = loadJson(CONFIG_PATH) as {
		items?: {
			globalTab?: {
				items?: Record<string, Record<string, unknown>>;
			};
		};
	};

	it("sendTo darf alsoDependsOn laut Schema nicht haben", () => {
		const sendTo = schema.definitions?.sendToProps?.properties ?? {};
		assert.equal("alsoDependsOn" in sendTo, false, "sendToProps must not list alsoDependsOn");
		assert.ok("command" in sendTo);
		assert.ok("disabled" in sendTo);
	});

	it("gesamte jsonConfig ist gegen das ioBroker-Schema additionalProperties-valid", () => {
		const issues = validateJsonConfig(config, schema as never);
		assert.deepEqual(
			issues,
			[],
			issues.map((i) => `${i.path} ${i.property ?? ""}: ${i.message}`).join("\n"),
		);
	});

	it("Daily-Analyst-Button JETZT ANALYSIEREN ist schema-konform und triggert aiDailyAnalystNow", () => {
		const btn = config.items?.globalTab?.items?.aiAnalystRunNowBtn;
		assert.ok(btn, "aiAnalystRunNowBtn fehlt");
		assert.equal(btn.type, "sendTo");
		assert.equal(btn.command, "aiDailyAnalystNow");
		assert.equal(btn.disabled, "data.ai_analyst_mode === 'disabled'");
		assert.equal("alsoDependsOn" in btn, false);
		const allowed = allowedKeysByType(schema as never).get("sendTo");
		assert.ok(allowed, "sendTo keys aus Schema");
		assert.equal(allowed.has("alsoDependsOn"), false);
		for (const key of Object.keys(btn)) {
			assert.ok(allowed.has(key), `sendTo additionalProperty: ${key}`);
		}
	});
});
