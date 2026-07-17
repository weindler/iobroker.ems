import { TAKEOVER_REPLAY_CACHE_MAX_ENTRIES } from "./constants";

interface ReplayEntry {
	challengeId: string;
	expiresAtMs: number;
}

/**
 * In-memory consumed-challenge replay cache — session only, size-bounded.
 */
export class ChallengeReplayCache {
	private readonly entries: ReplayEntry[] = [];

	constructor(private readonly maxEntries = TAKEOVER_REPLAY_CACHE_MAX_ENTRIES) {}

	remember(challengeId: string, expiresAtMs: number): void {
		this.entries.push({ challengeId, expiresAtMs });
		while (this.entries.length > this.maxEntries) {
			this.entries.shift();
		}
	}

	has(challengeId: string, nowMs: number): boolean {
		this.prune(nowMs);
		return this.entries.some((e) => e.challengeId === challengeId);
	}

	prune(nowMs: number): void {
		for (let i = this.entries.length - 1; i >= 0; i--) {
			if (this.entries[i]!.expiresAtMs <= nowMs) {
				this.entries.splice(i, 1);
			}
		}
	}

	clear(): void {
		this.entries.length = 0;
	}

	size(): number {
		return this.entries.length;
	}
}
