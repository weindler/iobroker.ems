export interface ModuleInitMark {
	module: string;
	count: number;
	duplicate: boolean;
	atMs: number;
}

const initCounts = new Map<string, number>();
const initMarks: ModuleInitMark[] = [];

export function markModuleInit(module: string, atMs = Date.now()): ModuleInitMark {
	const count = (initCounts.get(module) ?? 0) + 1;
	initCounts.set(module, count);
	const mark: ModuleInitMark = {
		module,
		count,
		duplicate: count > 1,
		atMs,
	};
	initMarks.push(mark);
	return mark;
}

export function getModuleInitCounts(): ReadonlyMap<string, number> {
	return new Map(initCounts);
}

export function getModuleInitMarks(): readonly ModuleInitMark[] {
	return [...initMarks];
}

export function getDuplicateModuleInits(): ModuleInitMark[] {
	return initMarks.filter((m) => m.duplicate);
}

export function resetModuleInitGuardForTest(): void {
	initCounts.clear();
	initMarks.length = 0;
}
