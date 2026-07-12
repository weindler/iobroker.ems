import { isSecretKey } from "./schema";

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const IP_V4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IP_V6_RE = /\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/g;
const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ABS_PATH_RE = /(?:\/[\w.-]+){2,}/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const COOKIE_RE = /\b(?:Set-Cookie|cookie)\s*[:=]/i;
const SECRET_QUERY_RE = /[?&](?:token|key|password|secret|access_token|api_key)=/i;
const MQTT_TOPIC_RE = /\bmqtt\.\d+\.[^\s"'\\]+/i;

export type PseudonymContext = {
	nextVehicle: number;
	nextDevice: number;
	nextForeignState: number;
	nextHost: number;
	vehicle: Map<string, string>;
	device: Map<string, string>;
	foreignState: Map<string, string>;
	host: Map<string, string>;
	profileName: Map<string, string>;
};

export function createPseudonymContext(): PseudonymContext {
	return {
		nextVehicle: 0,
		nextDevice: 0,
		nextForeignState: 0,
		nextHost: 0,
		vehicle: new Map(),
		device: new Map(),
		foreignState: new Map(),
		host: new Map(),
		profileName: new Map(),
	};
}

function pseudonym(map: Map<string, string>, prefix: string, counter: () => number, value: string): string {
	const key = value.trim();
	if (!key) return value;
	const existing = map.get(key);
	if (existing) return existing;
	const id = `${prefix}_${String(counter()).padStart(2, "0")}`;
	map.set(key, id);
	return id;
}

export function sanitizeString(text: string, ctx: PseudonymContext): string {
	let out = text;
	out = out.replace(VIN_RE, () => pseudonym(ctx.vehicle, "vehicle", () => ++ctx.nextVehicle, "VIN"));
	out = out.replace(IP_V4_RE, () => pseudonym(ctx.host, "host", () => ++ctx.nextHost, "ip"));
	out = out.replace(IP_V6_RE, () => pseudonym(ctx.host, "host_v6", () => ++ctx.nextHost, "ipv6"));
	out = out.replace(MAC_RE, "mac_xx");
	out = out.replace(EMAIL_RE, "email_redacted");
	out = out.replace(MQTT_TOPIC_RE, (m) => pseudonym(ctx.foreignState, "mqtt_topic", () => ++ctx.nextForeignState, m));
	out = out.replace(BEARER_RE, "Bearer <redacted>");
	out = out.replace(JWT_RE, "jwt_redacted");
	out = out.replace(SECRET_QUERY_RE, "?<secret_query_redacted>");
	out = out.replace(ABS_PATH_RE, (m) => {
		if (m.includes("node_modules") || m.includes("iobroker")) {
			return "<adapter_root>/...";
		}
		return "<path_redacted>";
	});
	return out;
}

export function sanitizeValue(value: unknown, ctx: PseudonymContext, keyPath = ""): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") {
		if (isSecretKey(keyPath.split(".").pop() ?? "")) {
			return undefined;
		}
		if (keyPath.endsWith("vehicle_id") || keyPath.includes("evcc_vehicle_id")) {
			return pseudonym(ctx.vehicle, "vehicle", () => ++ctx.nextVehicle, value);
		}
		if (keyPath.endsWith("display_name")) {
			return pseudonym(ctx.profileName, "profile", () => ++ctx.nextVehicle, value);
		}
		if (keyPath.endsWith("_target") || keyPath.endsWith("_state") || keyPath.includes("state_id")) {
			return pseudonym(ctx.foreignState, "foreign_state", () => ++ctx.nextForeignState, value);
		}
		return sanitizeString(value, ctx);
	}
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) {
		return value.map((v, i) => sanitizeValue(v, ctx, `${keyPath}[${i}]`)).filter((v) => v !== undefined);
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (isSecretKey(k)) continue;
			const sv = sanitizeValue(v, ctx, keyPath ? `${keyPath}.${k}` : k);
			if (sv !== undefined) out[k] = sv;
		}
		return out;
	}
	return value;
}

export function sanitizeForSupport<T>(value: T): T {
	const ctx = createPseudonymContext();
	return sanitizeValue(value, ctx) as T;
}

function resetRegex(re: RegExp): void {
	re.lastIndex = 0;
}

export function scanForForbiddenSecrets(text: string): string | null {
	const lower = text.toLowerCase();
	if (/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*\S+/i.test(text)) {
		return "secret pattern in text";
	}
	if (/\bpass(word|wd)\s*[:=]\s*\S+/i.test(text)) {
		return "password pattern in text";
	}
	if (BEARER_RE.test(text)) {
		return "bearer token in support export";
	}
	if (JWT_RE.test(text)) {
		return "jwt-like value in support export";
	}
	if (COOKIE_RE.test(text)) {
		return "cookie header in support export";
	}
	if (SECRET_QUERY_RE.test(text)) {
		return "secret query parameter in support export";
	}
	resetRegex(VIN_RE);
	if (VIN_RE.test(text) && !text.includes("vehicle_")) {
		return "vin-like value in support export";
	}
	resetRegex(IP_V4_RE);
	if (IP_V4_RE.test(text) && !text.includes("host_")) {
		return "ip address in support export";
	}
	resetRegex(IP_V6_RE);
	if (IP_V6_RE.test(text) && !text.includes("host_v6")) {
		return "ipv6 address in support export";
	}
	resetRegex(EMAIL_RE);
	if (EMAIL_RE.test(text)) {
		return "email in support export";
	}
	resetRegex(MAC_RE);
	if (MAC_RE.test(text) && !text.includes("mac_xx")) {
		return "mac address in support export";
	}
	resetRegex(MQTT_TOPIC_RE);
	if (MQTT_TOPIC_RE.test(text) && !text.includes("mqtt_topic_")) {
		return "mqtt topic in support export";
	}
	if (lower.includes("authorization: bearer")) {
		return "authorization header in support export";
	}
	resetRegex(ABS_PATH_RE);
	if (ABS_PATH_RE.test(text) && !text.includes("<path_redacted>")) {
		return "absolute path in support export";
	}
	return null;
}

export function assertSupportBundleClean(entries: Array<{ path: string; content: string }>): void {
	for (const e of entries) {
		const pathHit = scanForForbiddenSecrets(e.path);
		if (pathHit) {
			throw new Error(`support secret scan failed (${e.path} path): ${pathHit}`);
		}
		const hit = scanForForbiddenSecrets(e.content);
		if (hit) {
			throw new Error(`support secret scan failed (${e.path}): ${hit}`);
		}
	}
}
