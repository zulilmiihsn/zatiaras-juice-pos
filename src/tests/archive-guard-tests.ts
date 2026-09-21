import assert from 'node:assert/strict';
import { POST } from '../routes/api/archive/+server';
import { acquireArchiveJob } from '../lib/server/archiveService';
import { createTestD1 } from './helpers/testD1';

const { db, close } = await createTestD1();
const objects = new Map<string, string>();
let onUpload: () => Promise<void> = async () => {};
let corrupt = false;
const storage = {
	async put(key: string, value: string) {
		objects.set(key, value);
		await onUpload();
	},
	async get(key: string) {
		return objects.has(key)
			? { text: async () => (corrupt ? 'CORRUPT' : objects.get(key)!) }
			: null;
	}
};
async function archive(year = 2026) {
	return POST({
		request: new Request('https://test.invalid/api/archive', {
			method: 'POST',
			body: JSON.stringify({ before_year: year })
		}),
		locals: {
			authSession: { id: 's', userId: 'u', username: 'owner', role: 'pemilik', branch: 'samarinda' }
		},
		platform: { env: { DB_SAMARINDA_GROUP: db, STORAGE: storage } }
	} as unknown as Parameters<typeof POST>[0]);
}
async function reset(count: number) {
	objects.clear();
	corrupt = false;
	onUpload = async () => {};
	await db.batch(
		[
			'DROP TRIGGER IF EXISTS fail_archive',
			...[
				'transaksi_kasir',
				'buku_kas',
				'archive_job_items',
				'archive_jobs',
				'ringkasan_kas_arsip_harian',
				'sesi_toko',
				'pengaturan'
			].map((table) => `DELETE FROM ${table}`)
		].map((q) => db.prepare(q))
	);
	await db.batch(
		Array.from({ length: count }, (_, i) =>
			db
				.prepare(
					`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar)
		 VALUES(?,'samarinda','2025-12-01','catat','in','pendapatan_usaha',1000,'tunai')`
				)
				.bind(`bk${i}`)
		)
	);
}
async function totals() {
	return {
		rows: await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first<number>('n'),
		amount: await db
			.prepare('SELECT COALESCE(SUM(total_nominal),0) AS n FROM ringkasan_kas_arsip_harian')
			.first<number>('n'),
		active: await db
			.prepare(
				"SELECT COUNT(*) AS n FROM archive_jobs WHERE status IN ('claimed','uploading','finalizing')"
			)
			.first<number>('n')
	};
}
try {
	for (const count of [1, 20, 21, 45, 101]) {
		await reset(count);
		assert.equal((await archive()).status, 200);
		assert.deepEqual(await totals(), { rows: 0, amount: count * 1000, active: 0 });
		assert.equal(await db.prepare('SELECT status FROM archive_jobs').first('status'), 'completed');
		const retry = (await (await archive()).json()) as { resumed?: boolean };
		assert.equal(retry.resumed, true);
		assert.equal(objects.size, 1);
		assert.deepEqual(await totals(), { rows: 0, amount: count * 1000, active: 0 });
	}
	// New eligible data must not be hidden by the prior completed pointer.
	await db
		.prepare(
			"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal) VALUES('new','samarinda','2025-12-02','catat','in','pendapatan_usaha',500)"
		)
		.run();
	assert.equal((await archive()).status, 200);
	assert.equal((await totals()).amount, 101500);
	for (const conflict of ['edit', 'delete', 'session', 'lease', 'takeover']) {
		await reset(45);
		onUpload = async () => {
			if (conflict === 'edit')
				await db
					.prepare("UPDATE buku_kas SET revision=revision+1, nominal=2000 WHERE id='bk0'")
					.run();
			if (conflict === 'delete') await db.prepare("DELETE FROM buku_kas WHERE id='bk0'").run();
			if (conflict === 'session')
				await db
					.prepare(
						"INSERT INTO sesi_toko(id,cabang_id,waktu_buka,is_active,kas_awal) VALUES('open','samarinda','2026-09-16',1,0)"
					)
					.run();
			if (conflict === 'lease' || conflict === 'takeover')
				await db.prepare('UPDATE archive_jobs SET lease_expires_at=0').run();
			if (conflict === 'takeover') await acquireArchiveJob(db, 'samarinda', 2027, '2027-01-01');
		};
		await assert.rejects(archive, (e: { status?: number }) => e.status === 409);
		assert.deepEqual(await totals(), {
			rows: conflict === 'delete' ? 44 : 45,
			amount: 0,
			active: conflict === 'takeover' ? 1 : 0
		});
	}
	await reset(45);
	await db
		.prepare(
			"CREATE TRIGGER fail_archive BEFORE DELETE ON buku_kas WHEN OLD.id='bk25' BEGIN SELECT RAISE(ABORT,'injected failure'); END"
		)
		.run();
	await assert.rejects(archive);
	assert.deepEqual(await totals(), { rows: 45, amount: 0, active: 0 });
	await reset(1);
	corrupt = true;
	await assert.rejects(archive);
	assert.deepEqual(await totals(), { rows: 1, amount: 0, active: 0 });
	await reset(1);
	let release!: () => void;
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	let uploaded!: () => void;
	const ready = new Promise<void>((resolve) => {
		uploaded = resolve;
	});
	onUpload = async () => {
		uploaded();
		await barrier;
	};
	const first = archive();
	await ready;
	try {
		await assert.rejects(
			() => archive(2027),
			(e: { status?: number }) => e.status === 409
		);
	} finally {
		release();
	}
	assert.equal((await first).status, 200);
	assert.deepEqual(await totals(), { rows: 0, amount: 1000, active: 0 });
	console.log(
		'archive-guard-tests: actual handler normal/chunks/retry/conflicts/rollback passed',
		process.argv.includes('--d1') ? '(workerd D1)' : '(SQLite)'
	);
} finally {
	await close();
}
