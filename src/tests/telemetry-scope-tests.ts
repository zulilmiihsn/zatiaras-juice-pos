import assert from 'node:assert/strict';
import { createTestD1 } from './helpers/testD1';
import {
	branchFromObservation,
	recordErrorEvent,
	recordRequestMetric
} from '../lib/server/observability';

const { db, close } = await createTestD1();
try {
	const platform = { env: { DB_SAMARINDA_GROUP: db } } as unknown as App.Platform;

	// Cabang sesi otoritas: ?branch= palsu diabaikan.
	assert.equal(
		branchFromObservation(
			platform,
			{ userId: 'u', role: 'kasir', branch: 'samarinda' },
			'balikpapan'
		),
		'samarinda'
	);
	// Tanpa sesi: null walau ?branch= valid maupun binding ada.
	assert.equal(branchFromObservation(platform, null, 'samarinda'), null);
	assert.equal(branchFromObservation(platform, null, 'balikpapan'), null);
	assert.equal(branchFromObservation(platform, null, null), null);
	assert.equal(branchFromObservation(undefined, null, 'samarinda'), null);
	// Sesi invalid: null, bukan default samarinda.
	assert.equal(
		branchFromObservation(platform, { userId: 'u', branch: 'cabang-palsu' }, 'samarinda'),
		null
	);

	// Sink: anonim tak menulis ke tabel tenant mana pun.
	await recordRequestMetric(platform, null, {
		method: 'GET',
		path: '/api/data',
		status: 200,
		durationMs: 5
	});
	await recordErrorEvent(platform, null, { source: 'GET /x', error: new Error('boom') });
	assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM request_metrics`).first<number>('n'), 0);
	assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM error_events`).first<number>('n'), 0);

	// Terautentikasi masuk cabangnya sendiri, bukan cabang tempa.
	const session = { userId: 'u1', role: 'kasir', branch: 'samarinda' };
	const observed = branchFromObservation(platform, session, 'balikpapan');
	assert.equal(observed, 'samarinda');
	await recordRequestMetric(platform, observed, {
		method: 'GET',
		path: '/api/data',
		status: 200,
		durationMs: 5,
		session
	});
	await recordErrorEvent(platform, observed, {
		source: 'GET /x',
		error: new Error('boom'),
		session
	});
	assert.equal(
		await db
			.prepare(`SELECT COUNT(*) AS n FROM request_metrics WHERE cabang_id = 'samarinda'`)
			.first<number>('n'),
		1
	);
	assert.equal(
		await db
			.prepare(`SELECT COUNT(*) AS n FROM request_metrics WHERE cabang_id = 'balikpapan'`)
			.first<number>('n'),
		0
	);
	assert.equal(
		await db
			.prepare(`SELECT COUNT(*) AS n FROM error_events WHERE cabang_id = 'balikpapan'`)
			.first<number>('n'),
		0
	);

	// Outage logger tak menggagalkan commit sah.
	await recordRequestMetric(undefined, 'samarinda', {
		method: 'GET',
		path: '/api/data',
		status: 200,
		durationMs: 1
	});
	await recordErrorEvent(undefined, 'samarinda', { source: 'x', error: new Error('y') });

	console.log('telemetry-scope-tests: session otoritas, anonim drop, outage aman passed');
} finally {
	await close();
}
