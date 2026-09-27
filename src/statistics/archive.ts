/** Monthly, content-addressed accounting archive. Index activation is the commit point.
 * Old generations are deliberately retained: an interrupted write cannot damage them.
 * Only explicitly requested months enter the working cache; no date-specific states.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicStatisticsWrite, decodeStatistics, readStatisticsPersist, STATISTICS_PERSIST_FILE } from "./persist";
import type { StatisticsPersist, StatisticsDayRecord } from "./types";

export const STATISTICS_INDEX_FILE = "statistics_index_v2.json";
type MonthReference = { sha256: string; keys: string[] };
type Index = {
	version: 2;
	generatedAt: string;
	runtime: StatisticsPersist["runtime"];
	monthRewardsBilling: StatisticsPersist["monthRewardsBilling"];
	months: Record<string, MonthReference>;
	migration: { sourceSha256: string; verifiedDays: number };
};
const digest = (raw: string): string => createHash("sha256").update(raw).digest("hex");
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";
const monthPath = (dir: string, month: string, hash: string): string => join(dir, "months", `${month}-${hash}.json`);

function decodeIndex(raw: string): Index {
	const envelope = JSON.parse(raw) as { payload: Index; sha256: string };
	if (envelope.payload?.version !== 2) throw new Error("Unsupported statistics index version");
	if (digest(JSON.stringify(envelope.payload)) !== envelope.sha256) throw new Error("Statistics index checksum mismatch");
	for (const [month, ref] of Object.entries(envelope.payload.months)) {
		if (!/^\d{4}-\d{2}$/.test(month) || !/^[a-f0-9]{64}$/.test(ref.sha256) ||
			!Array.isArray(ref.keys) || new Set(ref.keys).size !== ref.keys.length ||
			ref.keys.some(key => !/^\d{4}-\d{2}-\d{2}$/.test(key) || !key.startsWith(`${month}-`))) {
			throw new Error("Invalid statistics month reference");
		}
	}
	return envelope.payload;
}

function readMonth(dir: string, month: string, ref: MonthReference): Record<string, StatisticsDayRecord> {
	const raw = readFileSync(monthPath(dir, month, ref.sha256), "utf8");
	if (digest(raw) !== ref.sha256) throw new Error(`Statistics month checksum mismatch: ${month}`);
	const days = JSON.parse(raw) as Record<string, StatisticsDayRecord>;
	if (JSON.stringify(Object.keys(days).sort()) !== JSON.stringify([...ref.keys].sort())) throw new Error("Statistics day index mismatch");
	decodeStatistics(JSON.stringify({ version: 1, days }));
	return days;
}

export class StatisticsArchive {
	private readonly cache = new Map<string, Record<string, StatisticsDayRecord>>();
	private readonly keys = new Set<string>();
	readonly data: StatisticsPersist;
	private constructor(private readonly dir: string, private index: Index) {
		for (const ref of Object.values(index.months)) for (const key of ref.keys) this.keys.add(key);
		const days = new Proxy({} as StatisticsPersist["days"], {
			ownKeys: () => [...this.keys].sort(),
			getOwnPropertyDescriptor: (_, key) => typeof key === "string" && this.keys.has(key)
				? { enumerable: true, configurable: true } : undefined,
			has: (_, key) => typeof key === "string" && this.keys.has(key),
			get: (_, key) => typeof key === "string" && this.keys.has(key) ? this.month(key.slice(0, 7))[key] : undefined,
			set: (_, key, value: StatisticsDayRecord) => {
				if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key) || value?.dateKey !== key) throw new Error("Invalid statistics day assignment");
				this.month(key.slice(0, 7))[key] = value;
				this.keys.add(key);
				return true;
			},
			deleteProperty: () => { throw new Error("Use explicit statistics archive reset"); },
		});
		this.data = { version: 1, generatedAt: index.generatedAt, days,
			runtime: structuredClone(index.runtime), monthRewardsBilling: structuredClone(index.monthRewardsBilling) };
	}
	private month(key: string): Record<string, StatisticsDayRecord> {
		let days = this.cache.get(key);
		if (!days) {
			days = this.index.months[key] ? readMonth(this.dir, key, this.index.months[key]) : {};
			this.cache.set(key, days);
		}
		return days;
	}
	get loadedMonths(): number { return this.cache.size; }
	removeDay(key: string): void {
		if (!this.keys.has(key)) return;
		delete this.month(key.slice(0, 7))[key];
		this.keys.delete(key);
	}
	async commit(): Promise<void> {
		const next: Index = { ...this.index, generatedAt: new Date().toISOString(),
			runtime: structuredClone(this.data.runtime), monthRewardsBilling: structuredClone(this.data.monthRewardsBilling),
			months: { ...this.index.months } };
		await mkdir(join(this.dir, "months"), { recursive: true });
		for (const [month, days] of this.cache) {
			decodeStatistics(JSON.stringify({ version: 1, days }));
			const raw = JSON.stringify(days);
			const sha256 = digest(raw);
			if (next.months[month]?.sha256 !== sha256) {
				const path = monthPath(this.dir, month, sha256);
				await atomicStatisticsWrite(path, raw);
				next.months[month] = { sha256, keys: Object.keys(days).sort() };
				// Verify disk content before publishing its reference.
				readMonth(this.dir, month, next.months[month]);
			}
		}
		const raw = JSON.stringify({ payload: next, sha256: digest(JSON.stringify(next)) });
		const path = join(this.dir, STATISTICS_INDEX_FILE);
		try {
			const previous = await readFile(path, "utf8");
			decodeIndex(previous);
			await atomicStatisticsWrite(`${path}.bak`, previous);
		} catch (error) { if (!missing(error)) throw error; }
		await atomicStatisticsWrite(path, raw);
		this.index = next;
		this.data.generatedAt = next.generatedAt;
		for (const month of this.cache.keys()) if (month !== this.data.runtime.dateKey.slice(0, 7)) this.cache.delete(month);
	}
	static async open(dir: string): Promise<StatisticsArchive> {
		try {
			const index = decodeIndex(await readFile(join(dir, STATISTICS_INDEX_FILE), "utf8"));
			// Check all referenced generations, one month at a time, without retaining history in RAM.
			for (const [month, ref] of Object.entries(index.months)) readMonth(dir, month, ref);
			return new StatisticsArchive(dir, index);
		} catch (error) {
			if (!missing(error)) throw error;
			// A missing referenced month must never be mistaken for an absent index.
			try { await readFile(join(dir, STATISTICS_INDEX_FILE)); throw error; }
			catch (indexError) { if (indexError === error || !missing(indexError)) throw indexError; }
		}
		const legacy = await readStatisticsPersist(dir);
		await mkdir(dir, { recursive: true });
		let source: string;
		try { source = await readFile(join(dir, STATISTICS_PERSIST_FILE), "utf8"); decodeStatistics(source); }
		catch (error) { if (!missing(error)) throw error; source = JSON.stringify(legacy); }
		const safetyPath = join(dir, "statistics_v1.pre-v2.json");
		try { await writeFile(safetyPath, source, { flag: "wx", mode: 0o600 }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
		if (digest(await readFile(safetyPath, "utf8")) !== digest(source)) throw new Error("Migration source changed; original backup preserved");
		const archive = new StatisticsArchive(dir, { version: 2, generatedAt: legacy.generatedAt,
			runtime: legacy.runtime, monthRewardsBilling: legacy.monthRewardsBilling, months: {},
			migration: { sourceSha256: digest(source), verifiedDays: Object.keys(legacy.days).length } });
		for (const [key, day] of Object.entries(legacy.days)) archive.data.days[key] = day;
		await archive.commit();
		return archive;
	}
}
