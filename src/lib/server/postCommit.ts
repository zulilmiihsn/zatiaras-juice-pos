/** Post-commit work is expendable; durable intent must already belong to the business batch. */
export const POST_COMMIT_EFFECTS_TIMEOUT_MS = 5000;
export type PostCommitTask = Promise<unknown> | ((signal: AbortSignal) => Promise<unknown>);
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

/** Legacy promises remain supported, but cannot be cancelled. New I/O uses signal-aware factories. */
export async function settlePostCommitEffects(
	tasks: PostCommitTask[],
	timeoutMs: number = POST_COMMIT_EFFECTS_TIMEOUT_MS,
	context?: ExecutionContext
): Promise<void> {
	if (tasks.length === 0) return;
	const controller = new AbortController();
	const budget = Number.isFinite(timeoutMs)
		? Math.min(POST_COMMIT_EFFECTS_TIMEOUT_MS, Math.max(1, timeoutMs))
		: POST_COMMIT_EFFECTS_TIMEOUT_MS;
	const completion = (async () => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				Promise.allSettled(
					tasks.map((task) =>
						Promise.resolve().then(() =>
							typeof task === 'function' ? task(controller.signal) : task
						)
					)
				),
				new Promise<void>((resolve) => {
					timer = setTimeout(() => {
						controller.abort(new Error('post-commit deadline'));
						resolve();
					}, budget);
				})
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	})();
	if (context) {
		try {
			context.waitUntil(completion);
			return;
		} catch {
			/* Unavailable execution context: bounded awaited fallback, never invalidate the commit. */
		}
	}
	await completion;
}
