/** Lightweight promise mutex for serialized authority operations. */

export class AuthorityMutex {
	private tail: Promise<void> = Promise.resolve();

	runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
		const run = this.tail.then(() => fn());
		this.tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}
