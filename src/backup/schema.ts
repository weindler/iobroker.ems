import { EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, SANITIZER_VERSION, type ExportKind, type ExportManifest } from "./types";

const SECRET_KEY_RE =
	/(password|passwd|token|access_token|refresh_token|secret|api_key|authorization|cookie|private_key|client_secret)/i;

export function isSecretKey(key: string): boolean {
	return SECRET_KEY_RE.test(key);
}

export function assertJsonSerializable(value: unknown, path = "root"): void {
	if (value === undefined) {
		throw new Error(`undefined not allowed at ${path}`);
	}
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
		if (typeof value === "string" && value.length > 512_000) {
			throw new Error(`string too long at ${path}`);
		}
		return;
	}
	if (Array.isArray(value)) {
		if (value.length > 10_000) {
			throw new Error(`array too long at ${path}`);
		}
		value.forEach((v, i) => assertJsonSerializable(v, `${path}[${i}]`));
		return;
	}
	if (typeof value === "object") {
		const seen = new Set<object>();
		const walk = (obj: Record<string, unknown>, p: string): void => {
			if (seen.has(obj)) {
				throw new Error(`cycle at ${p}`);
			}
			seen.add(obj);
			for (const [k, v] of Object.entries(obj)) {
				if (isSecretKey(k)) {
					throw new Error(`forbidden secret key at ${p}.${k}`);
				}
				assertJsonSerializable(v, `${p}.${k}`);
			}
		};
		walk(value as Record<string, unknown>, path);
		return;
	}
	throw new Error(`non-serializable type at ${path}`);
}

export function validateManifest(manifest: ExportManifest, kind: ExportKind): void {
	if (manifest.format !== EXPORT_FORMAT) {
		throw new Error("invalid manifest format");
	}
	if (manifest.schema_version !== EXPORT_SCHEMA_VERSION) {
		throw new Error("unsupported schema_version");
	}
	if (manifest.kind !== kind) {
		throw new Error("manifest kind mismatch");
	}
	if (!manifest.export_id || !manifest.created_at) {
		throw new Error("manifest missing export_id or created_at");
	}
	if (!manifest.safety.restore_must_start_dryrun || manifest.safety.automatic_live_resume_allowed) {
		throw new Error("invalid safety block");
	}
	if (manifest.privacy.sanitizer_version !== SANITIZER_VERSION) {
		throw new Error("unsupported sanitizer_version");
	}
	if (kind === "support" && !manifest.privacy.support_bundle_anonymized) {
		throw new Error("support manifest must be anonymized");
	}
	if (kind === "support") {
		if (manifest.restore?.supported !== false) {
			throw new Error("support manifest must declare restore.supported=false");
		}
	}
	if (kind === "backup" && manifest.restore?.supported === true) {
		throw new Error("backup manifest must not claim restore via support kind");
	}
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		throw new Error("manifest files empty");
	}
	for (const f of manifest.files) {
		if (!f.path || !f.sha256 || f.size_bytes < 0) {
			throw new Error(`invalid manifest file entry: ${f.path}`);
		}
	}
}

export function stableJsonStringify(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}
