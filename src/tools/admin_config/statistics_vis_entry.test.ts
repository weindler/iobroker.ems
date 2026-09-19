import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const config = fs.readFileSync(path.join(ROOT, "admin", "jsonConfig.json"), "utf8");

describe("statistics entries live in VIS", () => {
	it("does not require raw adjust_request JSON in admin", () => {
		assert.doesNotMatch(config, /JSON schreiben/);
		assert.doesNotMatch(config, /ems\.0\.statistics\.adjust_request/);
		assert.match(config, /direkt in der VIS im Tab/);
	});
});
