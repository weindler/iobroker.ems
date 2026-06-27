import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function writeGlobalPolicyPersist(
	baseDir: string,
	payload: { revision: string; configuredJson: string; effectiveJson: string },
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await fs.writeFile(
		path.join(baseDir, "policy_global_v1.json"),
		`${JSON.stringify({ module: "policy_global_v1", ...payload }, null, 2)}\n`,
		"utf8",
	);
}

export async function readGlobalPolicyPersistRevision(baseDir: string): Promise<string | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, "policy_global_v1.json"), "utf8");
		const parsed = JSON.parse(raw) as { revision?: string };
		return typeof parsed.revision === "string" ? parsed.revision : null;
	} catch {
		return null;
	}
}
