import assert from 'node:assert/strict';
import { createTestD1 } from './helpers/testD1';
import { POST as cachePost, GET as cacheGet } from '../routes/api/cache-metrics/+server';
import { POST as secPost, GET as secGet } from '../routes/api/security-events/+server';

const { db, close } = await createTestD1();
const testPlatform = {
	env: { DB_SAMARINDA_GROUP: db, DB_BALIKPAPAN_GROUP: db, DB_BERAU_GROUP: db }
} as unknown as App.Platform;
try {
	function session(branch: string, role = 'pemilik', userId = `u-${branch}-${role}`) {
		return {
			id: `sess-${userId}`,
			userId,
			username: userId,
			role,
			branch,
			createdAt: 0,
			expiresAt: 9999999999,
			unlockedPages: [],
			unlockExpiresAt: 0
		};
	}

	function cachePostEvent(branch: string, page = 'pos') {
		return {
			request: new Request('https://test.invalid/api/cache-metrics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					page,
					timestamp: Date.now(),
					stats: { memoryHits: 3, indexedDBHits: 1, networkFetches: 1, requests: 5 }
				})
			}),
			getClientAddress: () => `10.0.0.${branch === 'samarinda' ? 11 : 12}`,
			locals: { authSession: session(branch) }
		};
	}

	function cacheGetEvent(branch: string, role = 'pemilik') {
		return {
			url: new URL('https://test.invalid/api/cache-metrics?windowMinutes=60'),
			locals: { authSession: session(branch, role, `reader-${branch}-${role}`) }
		};
	}

	function secPostEvent(auth: unknown, eventType = 'client_error', ip: string) {
		return {
			request: new Request('https://test.invalid/api/security-events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					eventType,
					data: { endpoint: '/api/data', code: 'SERVER_ERROR', status: 500 }
				})
			}),
			getClientAddress: () => ip,
			locals: { authSession: auth },
			platform: testPlatform
		};
	}

	function secGetEvent(branch: string, role = 'pemilik') {
		return {
			url: new URL('https://test.invalid/api/security-events?windowHours=24'),
			locals: { authSession: session(branch, role, `reader-${branch}-${role}`) }
		};
	}

	// Isolasi sama, dua cabang: tiap owner hanya melihat cabangnya.
	const samarindaRes = (await cachePost(cachePostEvent('samarinda') as never)) as Response;
	assert.equal(samarindaRes.status, 200);
	const balikpapanRes = (await cachePost(
		cachePostEvent('balikpapan', 'dashboard') as never
	)) as Response;
	assert.equal(balikpapanRes.status, 200);

	const samarindaView = (
		(await await cacheGet(cacheGetEvent('samarinda') as never)) as Response
	).json() as Promise<{
		success: boolean;
		summary: { totals: { samples: number }; byPage: Array<{ page: string; samples: number }> };
	}>;
	const samarindaJson = await samarindaView;
	assert.equal(samarindaJson.success, true);
	assert.equal(samarindaJson.summary.totals.samples, 1);
	assert.deepEqual(
		samarindaJson.summary.byPage.map((p) => p.page),
		['pos']
	);

	const balikpapanJson = (await (
		(await cacheGet(cacheGetEvent('balikpapan') as never)) as Response
	).json()) as {
		success: boolean;
		summary: { totals: { samples: number }; byPage: Array<{ page: string }> };
	};
	assert.equal(balikpapanJson.summary.totals.samples, 1);
	assert.deepEqual(
		balikpapanJson.summary.byPage.map((p) => p.page),
		['dashboard']
	);

	const adminJson = (await (
		(await cacheGet(cacheGetEvent('samarinda', 'admin') as never)) as Response
	).json()) as {
		summary: { totals: { samples: number } };
	};
	assert.equal(adminJson.summary.totals.samples, 2);

	// Anonim + dua cabang: owner tak kecampur anonim/cabang lain.
	assert.equal(
		((await secPost(secPostEvent(null, 'client_error', '10.9.0.1') as never)) as Response).status,
		200
	);
	assert.equal(
		(
			(await secPost(
				secPostEvent(session('samarinda'), 'login_failed', '10.9.0.2') as never
			)) as Response
		).status,
		200
	);
	assert.equal(
		(
			(await secPost(
				secPostEvent(session('balikpapan'), 'login_failed', '10.9.0.3') as never
			)) as Response
		).status,
		200
	);
	const secSamarinda = (await (
		(await secGet(secGetEvent('samarinda') as never)) as Response
	).json()) as {
		success: boolean;
		totalEvents: number;
		eventTypeCounts: Record<string, number>;
	};
	assert.equal(secSamarinda.success, true);
	assert.equal(secSamarinda.totalEvents, 1);
	assert.equal(secSamarinda.eventTypeCounts['login_failed'], 1);

	const secAdmin = (await (
		(await secGet(secGetEvent('samarinda', 'admin') as never)) as Response
	).json()) as {
		totalEvents: number;
	};
	assert.equal(secAdmin.totalEvents, 3);

	console.log('diagnostic-scope-tests: owner terisolasi, admin global, anonim tak campur passed');
} finally {
	await close();
}
