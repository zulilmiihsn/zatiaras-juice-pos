export type PwaUpdateState = 'idle' | 'available' | 'updating' | 'reload';

export const PWA_UPDATE_TIMEOUT_MS = 5_000;
export const PWA_UPDATE_CHECK_MS = 30 * 60 * 1000;
// Cek karena tab kembali terlihat tidak boleh lebih sering dari ini.
const MIN_VISIBLE_CHECK_GAP_MS = 5 * 60 * 1000;

interface PwaUpdaterDeps {
	getWaiting: () => ServiceWorker | null;
	reload: () => void;
	onState: (state: PwaUpdateState) => void;
	onError: (message: string) => void;
}

/**
 * Mesin status update PWA. Worker baru hanya diaktifkan atas klik kasir (SKIP_WAITING),
 * jadi reload tidak memotong transaksi. Tiga jalan keluar dijaga agar tombol tidak diam:
 * aktivasi yang tak kunjung datang (timeout), worker diaktifkan tab lain, dan waiting hilang.
 */
export function createPwaUpdater(deps: PwaUpdaterDeps) {
	let state: PwaUpdateState = 'idle';
	let timer: ReturnType<typeof setTimeout> | null = null;

	const set = (next: PwaUpdateState) => {
		if (state === next) return;
		state = next;
		deps.onState(next);
	};
	const clearTimer = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	const idleOrAvailable = () => (deps.getWaiting() ? 'available' : 'idle');

	return {
		get state() {
			return state;
		},
		/** Baca ulang registration.waiting; tidak menimpa updating/reload. */
		sync() {
			if (state === 'updating' || state === 'reload') return;
			set(idleOrAvailable());
		},
		apply() {
			if (state === 'reload') {
				deps.reload();
				return;
			}
			if (state !== 'available') return;
			const waiting = deps.getWaiting();
			if (!waiting) {
				// Worker sudah diaktifkan di tempat lain; halaman ini masih memakai JS lama.
				set('reload');
				return;
			}
			set('updating');
			try {
				waiting.postMessage({ type: 'SKIP_WAITING' });
			} catch {
				set(idleOrAvailable());
				deps.onError('Update belum dapat diterapkan. Muat ulang lalu coba lagi.');
				return;
			}
			timer = setTimeout(() => {
				timer = null;
				if (state !== 'updating') return;
				set(idleOrAvailable());
				deps.onError('Update tidak merespons. Coba lagi, atau muat ulang halaman.');
			}, PWA_UPDATE_TIMEOUT_MS);
		},
		/** Event `controlling`: worker baru mengambil alih halaman ini. */
		controlled() {
			if (state === 'updating') {
				clearTimer();
				deps.reload();
				return;
			}
			// Diaktifkan dari tab lain: jangan reload paksa, minta kasir yang memutuskan.
			clearTimer();
			set('reload');
		},
		dispose: clearTimer
	};
}

interface UpdateCheckEnv {
	doc?: Document;
	isOnline?: () => boolean;
}

/** Cek update berkala dan saat tab kembali terlihat; browser sendiri hanya cek saat navigasi. */
export function startPwaUpdateChecks(
	registration: ServiceWorkerRegistration,
	{ doc = document, isOnline = () => navigator.onLine }: UpdateCheckEnv = {}
): () => void {
	let lastCheck = Date.now();
	const check = () => {
		if (!isOnline()) return;
		lastCheck = Date.now();
		registration.update().catch(() => {
			// Cek gagal tak masalah; percobaan berikutnya menyusul.
		});
	};
	const interval = setInterval(check, PWA_UPDATE_CHECK_MS);
	const onVisible = () => {
		if (doc.visibilityState === 'visible' && Date.now() - lastCheck >= MIN_VISIBLE_CHECK_GAP_MS) {
			check();
		}
	};
	doc.addEventListener('visibilitychange', onVisible);
	return () => {
		clearInterval(interval);
		doc.removeEventListener('visibilitychange', onVisible);
	};
}
