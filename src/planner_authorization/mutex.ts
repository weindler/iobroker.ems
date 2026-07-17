/** Lightweight promise mutex for serialized authorization operations. */

export class AuthorizationMutex {
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
