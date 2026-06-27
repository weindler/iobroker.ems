import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ImmersionFaultCode, RuntimePersistData, ThermalControlMode } from "./types";

const FILE = "immersion_heater_runtime_v1.json";

export function emptyPersist(): RuntimePersistData {
	return {
		resolvedMode: "auto",
		forceTargetTempC: null,
		forceUntil: null,
		lastSwitchAtMs: null,
		lastOffAtMs: null,
		faultLockout: false,
		faultCode: "none",
		faultSince: null,
		commandedStage: 0,
		minRuntimeUntilMs: null,
		pauseUntilMs: null,
	};
}

export async function readRuntimePersist(baseDir: string): Promise<RuntimePersistData | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, FILE), "utf8");
		const p = JSON.parse(raw) as Partial<RuntimePersistData>;
		return { ...emptyPersist(), ...p };
	} catch {
		return null;
	}
}

export async function writeRuntimePersist(baseDir: string, data: RuntimePersistData): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await fs.writeFile(path.join(baseDir, FILE), `${JSON.stringify({ module: FILE, ...data }, null, 2)}\n`, "utf8");
}

export function isForceExpired(forceUntil: string | null, nowMs: number): boolean {
	if (!forceUntil) return false;
	const t = Date.parse(forceUntil);
	return Number.isFinite(t) && nowMs >= t;
}

export function normalizePersistMode(mode: string | null | undefined): ThermalControlMode {
	if (mode === "off" || mode === "force") return mode;
	return "auto";
}

export function isLockingFault(code: ImmersionFaultCode): boolean {
	return code !== "none" && code !== "temperature_missing" && code !== "temperature_stale" && code !== "temperature_implausible";
}
