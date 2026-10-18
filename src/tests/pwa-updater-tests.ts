import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	createPwaUpdater,
	startPwaUpdateChecks,
	PWA_UPDATE_TIMEOUT_MS,
	PWA_UPDATE_CHECK_MS,
	type PwaUpdateState
} from '../lib/utils/pwaUpdater';

class FakeWorker extends EventTarget {
	state: ServiceWorkerState = 'installed';

	constructor(readonly postMessage: (message: unknown) => void) {
		super();
	}

	transition(state: ServiceWorkerState) {
		this.state = state;
		this.dispatchEvent(new Event('statechange'));
	}
}

function harness(initialWaiting: boolean) {
	const posted: unknown[] = [];
	const states: PwaUpdateState[] = [];
	let reloads = 0;
	let waiting = initialWaiting ? new FakeWorker((message) => posted.push(message)) : null;
	const updater = createPwaUpdater({
		getWaiting: () => waiting as unknown as ServiceWorker | null,
		reload: () => void reloads++,
		onState: (s) => states.push(s)
	});
	return {
		updater,
		posted,
		states,
		reloads: () => reloads,
		worker: () => {
			assert.ok(waiting);
			return waiting;
		},
		setWaiting: (w: boolean) => {
			waiting = w ? new FakeWorker((message) => posted.push(message)) : null;
		}
	};
}

test('waiting terdeteksi lalu klik mengirim SKIP_WAITING dan reload saat controlling', () => {
	const h = harness(true);
	h.updater.sync();
	assert.equal(h.updater.state, 'available');
	h.updater.apply();
	assert.equal(h.updater.state, 'updating');
	assert.deepEqual(h.posted, [{ type: 'SKIP_WAITING' }]);
	h.updater.controlled();
	assert.equal(h.reloads(), 1);
});

test('controlling instalasi awal tidak meminta reload tanpa update', () => {
	const h = harness(false);
	h.updater.controlled();
	assert.equal(h.updater.state, 'idle');
	assert.equal(h.reloads(), 0);
});

test('worker aktif tanpa controlling tetap menyelesaikan update dan membatalkan timeout', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const h = harness(true);
		h.updater.sync();
		h.updater.apply();
		h.worker().transition('activating');
		assert.equal(h.reloads(), 0, 'tunggu aktivasi selesai');
		h.worker().transition('activated');
		assert.equal(h.reloads(), 1, 'tab tanpa controller harus memakai worker yang sudah aktif');
		mock.timers.tick(PWA_UPDATE_TIMEOUT_MS * 2);
		assert.equal(h.updater.state, 'updating', 'timeout lama tidak mengubah hasil aktivasi');
	} finally {
		mock.timers.reset();
	}
});

test('aktivasi dan controlling bersamaan hanya me-reload sekali', () => {
	const h = harness(true);
	h.updater.sync();
	h.updater.apply();
	h.worker().transition('activated');
	h.updater.controlled();
	h.updater.apply();
	assert.equal(h.reloads(), 1);
});

test('aktivasi tertunda: tersedia pemulihan muat ulang tanpa toast gagal', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const h = harness(true);
		h.updater.sync();
		h.updater.apply();
		mock.timers.tick(PWA_UPDATE_TIMEOUT_MS - 1);
		assert.equal(h.updater.state, 'updating');
		mock.timers.tick(1);
		assert.equal(h.updater.state, 'retry');
		assert.equal(h.reloads(), 0);
		h.updater.sync();
		assert.equal(h.updater.state, 'retry', 'pesan pemulihan tetap terlihat');
		h.updater.apply();
		assert.equal(h.reloads(), 1);
	} finally {
		mock.timers.reset();
	}
});

test('worker aktif sesudah timeout menunggu klik baru, tidak memotong transaksi', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const h = harness(true);
		h.updater.sync();
		h.updater.apply();
		mock.timers.tick(PWA_UPDATE_TIMEOUT_MS);
		h.worker().transition('activated');
		assert.equal(h.updater.state, 'reload');
		assert.equal(h.reloads(), 0);
		h.updater.apply();
		assert.equal(h.reloads(), 1);
	} finally {
		mock.timers.reset();
	}
});

test('controlling datang sebelum timeout membatalkan timeout', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const h = harness(true);
		h.updater.sync();
		h.updater.apply();
		h.updater.controlled();
		mock.timers.tick(PWA_UPDATE_TIMEOUT_MS * 2);
		assert.equal(h.updater.state, 'updating');
		assert.equal(h.reloads(), 1);
	} finally {
		mock.timers.reset();
	}
});

test('tab lain mengaktifkan worker: banner minta muat ulang, klik reload', () => {
	const h = harness(true);
	h.updater.sync();
	h.setWaiting(false);
	h.updater.controlled();
	assert.equal(h.updater.state, 'reload');
	assert.equal(h.reloads(), 0, 'tidak reload otomatis di tengah transaksi');
	h.updater.apply();
	assert.equal(h.reloads(), 1);
});

test('tab tanpa controller melihat aktivasi dari tab lain, tanpa reload otomatis', () => {
	const h = harness(true);
	h.updater.sync();
	const worker = h.worker();
	h.setWaiting(false);
	worker.transition('activated');
	assert.equal(h.updater.state, 'reload');
	assert.equal(h.reloads(), 0);
	h.updater.apply();
	assert.equal(h.reloads(), 1);
});

test('klik saat waiting sudah hilang langsung memuat ulang, tanpa klik kedua', () => {
	const h = harness(true);
	h.updater.sync();
	h.setWaiting(false);
	h.updater.apply();
	assert.equal(h.updater.state, 'reload');
	assert.equal(h.posted.length, 0);
	assert.equal(h.reloads(), 1);
});

test('postMessage melempar error: pemulihan muat ulang tersedia tanpa toast gagal', () => {
	let reloads = 0;
	const updater = createPwaUpdater({
		getWaiting: () =>
			new FakeWorker(() => {
				throw new Error('dead');
			}) as unknown as ServiceWorker,
		reload: () => void reloads++,
		onState: () => {}
	});
	updater.sync();
	updater.apply();
	assert.equal(updater.state, 'retry');
	assert.equal(reloads, 0);
	updater.apply();
	assert.equal(reloads, 1);
});

test('worker redundant menyediakan pemulihan, tanpa mengaku update berhasil', () => {
	const h = harness(true);
	h.updater.sync();
	h.updater.apply();
	h.worker().transition('redundant');
	assert.equal(h.updater.state, 'retry');
	assert.equal(h.reloads(), 0);
	h.updater.dispose();
});

test('worker waiting pengganti melepas listener worker lama', () => {
	const h = harness(true);
	h.updater.sync();
	const previous = h.worker();
	h.setWaiting(true);
	h.updater.sync();
	previous.transition('activated');
	assert.equal(h.updater.state, 'available');
	assert.equal(h.reloads(), 0);
	h.worker().transition('activated');
	assert.equal(h.updater.state, 'reload');
	assert.equal(h.reloads(), 0);
});

test('sync saat aktivasi berlangsung tetap memantau worker meski waiting sudah kosong', () => {
	const h = harness(true);
	h.updater.sync();
	const worker = h.worker();
	worker.transition('activating');
	h.setWaiting(false);
	h.updater.sync();
	assert.equal(h.updater.state, 'available');
	worker.transition('activated');
	assert.equal(h.updater.state, 'reload');
	assert.equal(h.reloads(), 0);
});

test('sync memeriksa aktivasi selesai sebelum event statechange dikirim browser', () => {
	const h = harness(true);
	h.updater.sync();
	h.worker().state = 'activated';
	h.setWaiting(false);
	h.updater.sync();
	assert.equal(h.updater.state, 'reload');
	assert.equal(h.reloads(), 0);
});

test('sync tidak menimpa updating/reload dan klik ganda diabaikan', () => {
	const h = harness(true);
	h.updater.sync();
	h.updater.apply();
	h.updater.apply();
	assert.equal(h.posted.length, 1);
	h.setWaiting(false);
	h.updater.sync();
	assert.equal(h.updater.state, 'updating');
	h.updater.dispose();
});

test('worker waiting menghilang saat available: banner ikut hilang', () => {
	const h = harness(true);
	h.updater.sync();
	h.setWaiting(false);
	h.updater.sync();
	assert.equal(h.updater.state, 'idle');
});

test('dispose membatalkan timeout dan listener aktivasi', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const h = harness(true);
		h.updater.sync();
		h.updater.apply();
		h.updater.dispose();
		h.worker().transition('activated');
		mock.timers.tick(PWA_UPDATE_TIMEOUT_MS * 2);
		assert.equal(h.updater.state, 'updating');
		assert.equal(h.reloads(), 0);
	} finally {
		mock.timers.reset();
	}
});

test('pengecekan berkala memanggil update() dan berhenti setelah stop', async () => {
	mock.timers.enable({ apis: ['setInterval'] });
	try {
		let calls = 0;
		const registration = {
			update: async () => void calls++
		} as unknown as ServiceWorkerRegistration;
		const doc = new EventTarget() as unknown as Document;
		Object.defineProperty(doc, 'visibilityState', { value: 'visible' });
		const stop = startPwaUpdateChecks(registration, { doc, isOnline: () => true });
		mock.timers.tick(PWA_UPDATE_CHECK_MS);
		assert.equal(calls, 1);
		stop();
		mock.timers.tick(PWA_UPDATE_CHECK_MS * 3);
		assert.equal(calls, 1);
	} finally {
		mock.timers.reset();
	}
});

test('pengecekan dilewati saat offline dan error update() tidak bocor', async () => {
	mock.timers.enable({ apis: ['setInterval'] });
	try {
		let calls = 0;
		let online = false;
		const registration = {
			update: async () => {
				calls++;
				throw new Error('network');
			}
		} as unknown as ServiceWorkerRegistration;
		const doc = new EventTarget() as unknown as Document;
		Object.defineProperty(doc, 'visibilityState', { value: 'visible' });
		const stop = startPwaUpdateChecks(registration, { doc, isOnline: () => online });
		mock.timers.tick(PWA_UPDATE_CHECK_MS);
		assert.equal(calls, 0);
		online = true;
		mock.timers.tick(PWA_UPDATE_CHECK_MS);
		await Promise.resolve();
		assert.equal(calls, 1);
		stop();
	} finally {
		mock.timers.reset();
	}
});

test('tab kembali terlihat memicu cek (dengan jeda), tab tersembunyi tidak', () => {
	mock.timers.enable({ apis: ['Date'] });
	try {
		let calls = 0;
		const registration = {
			update: async () => void calls++
		} as unknown as ServiceWorkerRegistration;
		let visibility: DocumentVisibilityState = 'hidden';
		const doc = new EventTarget() as unknown as Document;
		Object.defineProperty(doc, 'visibilityState', { get: () => visibility });
		const stop = startPwaUpdateChecks(registration, { doc, isOnline: () => true });
		mock.timers.tick(6 * 60 * 1000);
		doc.dispatchEvent(new Event('visibilitychange'));
		assert.equal(calls, 0, 'tersembunyi tidak mengecek');
		visibility = 'visible';
		doc.dispatchEvent(new Event('visibilitychange'));
		assert.equal(calls, 1);
		doc.dispatchEvent(new Event('visibilitychange'));
		assert.equal(calls, 1, 'jeda minimal antar cek');
		stop();
		mock.timers.tick(6 * 60 * 1000);
		doc.dispatchEvent(new Event('visibilitychange'));
		assert.equal(calls, 1);
	} finally {
		mock.timers.reset();
	}
});
