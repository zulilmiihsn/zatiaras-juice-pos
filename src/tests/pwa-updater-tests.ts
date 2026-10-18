import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	createPwaUpdater,
	startPwaUpdateChecks,
	PWA_UPDATE_TIMEOUT_MS,
	PWA_UPDATE_CHECK_MS,
	type PwaUpdateState
} from '../lib/utils/pwaUpdater';

function harness(initialWaiting: boolean) {
	const posted: unknown[] = [];
	const states: PwaUpdateState[] = [];
	const errors: string[] = [];
	let reloads = 0;
	let waiting: { postMessage: (m: unknown) => void } | null = initialWaiting
		? { postMessage: (m) => posted.push(m) }
		: null;
	const updater = createPwaUpdater({
		getWaiting: () => waiting as ServiceWorker | null,
		reload: () => void reloads++,
		onState: (s) => states.push(s),
		onError: (m) => errors.push(m)
	});
	return {
		updater,
		posted,
		states,
		errors,
		reloads: () => reloads,
		setWaiting: (w: boolean) => {
			waiting = w ? { postMessage: (m) => posted.push(m) } : null;
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

test('klik tanpa controlling: timeout mengembalikan tombol dan memberi tahu kasir', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const h = harness(true);
		h.updater.sync();
		h.updater.apply();
		mock.timers.tick(PWA_UPDATE_TIMEOUT_MS - 1);
		assert.equal(h.updater.state, 'updating');
		mock.timers.tick(1);
		assert.equal(h.updater.state, 'available');
		assert.equal(h.errors.length, 1);
		assert.equal(h.reloads(), 0);
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
		assert.equal(h.errors.length, 0);
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

test('klik saat waiting sudah hilang tidak diam: beralih ke muat ulang', () => {
	const h = harness(true);
	h.updater.sync();
	h.setWaiting(false);
	h.updater.apply();
	assert.equal(h.updater.state, 'reload');
	assert.equal(h.posted.length, 0);
});

test('postMessage melempar error: kembali available dan lapor', () => {
	const errors: string[] = [];
	const updater = createPwaUpdater({
		getWaiting: () =>
			({
				postMessage() {
					throw new Error('dead');
				}
			}) as unknown as ServiceWorker,
		reload: () => assert.fail('tidak boleh reload'),
		onState: () => {},
		onError: (m) => errors.push(m)
	});
	updater.sync();
	updater.apply();
	assert.equal(updater.state, 'available');
	assert.equal(errors.length, 1);
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
});

test('worker waiting menghilang saat available: banner ikut hilang', () => {
	const h = harness(true);
	h.updater.sync();
	h.setWaiting(false);
	h.updater.sync();
	assert.equal(h.updater.state, 'idle');
});

test('dispose membatalkan timeout', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const h = harness(true);
		h.updater.sync();
		h.updater.apply();
		h.updater.dispose();
		mock.timers.tick(PWA_UPDATE_TIMEOUT_MS * 2);
		assert.equal(h.errors.length, 0);
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
