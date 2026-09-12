import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateJsonConfig } from "./validate_json_config";

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

	it("normale Admin-Konfiguration enthält keine KI-Bedienelemente oder Secrets", () => {
		const serialized = JSON.stringify(config);
		assert.equal(serialized.includes("ai_openai_api_key"), false);
		assert.equal(serialized.includes("aiDailyAnalystNow"), false);
		assert.equal(serialized.includes("KI-Optimierung"), false);
	});
});
