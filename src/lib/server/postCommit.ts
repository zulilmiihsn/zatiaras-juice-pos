/**
 * Penyelesaian efek post-commit bounded (AUD-049).
 *
 * Commit bisnis sudah sah sebelum fungsi ini dipanggil; audit/log/realtime
 * adalah best-effort dan TAK BOLEH menunda balasan tanpa deadline.
 * - Tiap task tak boleh melempar (bungkus .catch di caller).
 * - Timer selalu dibersihkan; upstream realtime membawa AbortSignal sendiri
 *   (REALTIME_PUBLISH_TIMEOUT_MS) plus timer backstop, jadi tak ada janji
 *   yatim tanpa cleanup.
 * - Timeout di sini hanya membebaskan respons; task latar tetap dirujuk
 *   allSettled sampai selesai (tanpa unhandled rejection).
 */

/** Budget maksimum efek post-commit menahan respons checkout. */
export const POST_COMMIT_EFFECTS_TIMEOUT_MS = 5000;

export async function settlePostCommitEffects(
	tasks: Array<Promise<unknown>>,
	timeoutMs: number = POST_COMMIT_EFFECTS_TIMEOUT_MS
): Promise<void> {
	if (tasks.length === 0) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// Timer SENGAJA menahan event loop sampai budget (tanpa unref):
		// budget adalah jaminan respons, bukan beban latar.
		await Promise.race([
			Promise.allSettled(tasks),
			new Promise<void>((resolve) => {
				timer = setTimeout(() => resolve(), Math.max(1, timeoutMs));
			})
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
