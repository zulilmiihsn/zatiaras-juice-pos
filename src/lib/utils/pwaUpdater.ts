export type PwaUpdateState = 'idle' | 'available' | 'updating' | 'reload' | 'retry';

export const PWA_UPDATE_TIMEOUT_MS = 5_000;
export const PWA_UPDATE_CHECK_MS = 30 * 60 * 1000;
// Cek karena tab kembali terlihat tidak boleh lebih sering dari ini.
const MIN_VISIBLE_CHECK_GAP_MS = 5 * 60 * 1000;

interface PwaUpdaterDeps {
	getWaiting: () => ServiceWorker | null;
	reload: () => void;
	onState: (state: PwaUpdateState) => void;
}

/**
 * Mesin status update PWA. Worker baru hanya diaktifkan atas klik kasir (SKIP_WAITING),
 * jadi reload tidak memotong transaksi. Tiga jalan keluar dijaga agar tombol tidak diam:
 * aktivasi yang tak kunjung datang (timeout), worker diaktifkan tab lain, dan waiting hilang.
 * Tab yang belum dikontrol worker tidak menerima controlling; statechange pada worker
 * waiting juga menjadi bukti aktivasi. Setelah timeout, reload perlu klik baru.
 */
export function createPwaUpdater(deps: PwaUpdaterDeps) {
	let state: PwaUpdateState = 'idle';
	let timer: ReturnType<typeof setTimeout> | null = null;
	let worker: ServiceWorker | null = null;
	let reloadStarted = false;
	let disposed = false;

	const set = (next: PwaUpdateState) => {
		if (state === next) return;
		state = next;
		deps.onState(next);
	};
	const clearTimer = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	const stopWatching = () => {
		worker?.removeEventListener('statechange', onWorkerStateChange);
		worker = null;
	};
	const reload = () => {
		if (reloadStarted || disposed) return;
		reloadStarted = true;
		clearTimer();
		stopWatching();
		deps.reload();
	};
	const activated = () => {
		if (reloadStarted || disposed) return;
		clearTimer();
		stopWatching();
		if (state === 'updating') reload();
		else set('reload');
	};
	function onWorkerStateChange() {
		if (worker?.state === 'activated') activated();
		else if (worker?.state === 'redundant') {
			clearTimer();
			stopWatching();
			set('retry');
		}
	}
	const watch = (next: ServiceWorker | null) => {
		if (worker === next) return;
		stopWatching();
		worker = next;
		worker?.addEventListener('statechange', onWorkerStateChange);
	};

	return {
		get state() {
			return state;
		},
		/** Baca ulang registration.waiting; tidak menimpa updating/reload maupun pemulihan. */
		sync() {
			if (disposed || reloadStarted || (state !== 'idle' && state !== 'available')) return;
			const waiting = deps.getWaiting();
			if (!waiting && worker?.state === 'activated') {
				activated();
				return;
			}
			if (!waiting && worker?.state === 'activating') return;
			watch(waiting);
			set(waiting ? 'available' : 'idle');
			onWorkerStateChange();
		},
		apply() {
			if (disposed || reloadStarted) return;
			if (state === 'reload' || state === 'retry') {
				reload();
				return;
			}
			if (state !== 'available') return;
			const waiting = deps.getWaiting();
			if (!waiting) {
				// Worker sudah diaktifkan di tempat lain; halaman ini masih memakai JS lama.
				set('reload');
				reload();
				return;
			}
			watch(waiting);
			set('updating');
			timer = setTimeout(() => {
				timer = null;
				if (state !== 'updating') return;
				onWorkerStateChange();
				if (state === 'updating' && !reloadStarted) set('retry');
			}, PWA_UPDATE_TIMEOUT_MS);
			onWorkerStateChange();
			if (reloadStarted || waiting.state === 'redundant') return;
			try {
				waiting.postMessage({ type: 'SKIP_WAITING' });
			} catch {
				// Worker bisa berhenti saat pesan dikirim; banner menyediakan pemulihan manual.
				clearTimer();
				set('retry');
			}
		},
		/** Event `controlling`: worker baru mengambil alih halaman ini. */
		controlled() {
			if (state === 'idle') return;
			// Diaktifkan dari tab lain: jangan reload paksa, minta kasir yang memutuskan.
			activated();
		},
		dispose() {
			disposed = true;
			clearTimer();
			stopWatching();
		}
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
