import assert from 'node:assert/strict';
import { createTestD1 } from './helpers/testD1';
import {
	ARCHIVE_CHUNK_HEADERS,
	ARCHIVE_CHUNK_MAX_BYTES,
	ARCHIVE_MAX_CHUNKS_PER_CALL,
	runArchive,
	type ArchiveResult
} from '../lib/server/archiveUseCase';
import { branchContext } from '../lib/server/branchResolver';

// AUD-039: chunk arsip bounded + resume tanpa OOM/duplikasi/kehilangan.
assert.ok(ARCHIVE_CHUNK_HEADERS <= 80, 'IN clause muat budget 100 bind-param D1');
assert.ok(ARCHIVE_CHUNK_MAX_BYTES <= 2_000_000);
assert.ok(ARCHIVE_MAX_CHUNKS_PER_CALL >= 1);

const { db, close } = await createTestD1();
try {
	const objects = new Map<string, string>();
	const storage = {
		async put(key: string, value: string) {
			objects.set(key, value);
		},
		async get(key: string) {
			if (!objects.has(key)) return null;
			const text = objects.get(key)!;
			return {
				text: async () => text,
				arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer
			};
		}
	};
	const branch = branchContext('samarinda');

	async function seedHeaders(
		count: number,
		opts: { prefix?: string; padSnapshot?: number; day?: string } = {}
	): Promise<string[]> {
		const ids: string[] = [];
		const day = opts.day ?? '2024-06-15';
		const pad = opts.padSnapshot ?? 0;
		const stmts = [];
		for (let i = 0; i < count; i++) {
			const id = `${opts.prefix ?? 'ck'}-${i}`;
			ids.push(id);
			stmts.push(
				db
					.prepare(
						`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar,receipt_snapshot,transaction_id,idempotency_key)
					 VALUES(?, 'samarinda', '${day}T02:00:00.000Z', 'catat', 'in', 'pendapatan_usaha', 1000, 'tunai', ?, ?, ?)`
					)
					.bind(id, 'x'.repeat(pad), `tx-${id}`, `key-${id}`)
			);
			stmts.push(
				db
					.prepare(
						`INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,jumlah,nominal,transaction_id,created_at)
					 VALUES(?, 'samarinda', ?, 1, 1000, ?, '${day}T02:00:00.000Z')`
					)
					.bind(`tk-${id}`, id, `tx-${id}`)
			);
		}
		for (let i = 0; i < stmts.length; i += 50) {
			await db.batch(stmts.slice(i, i + 50));
		}
		return ids;
	}
	async function ledgerTotal(): Promise<number> {
		const active = await db
			.prepare(`SELECT COALESCE(SUM(nominal),0) AS n FROM buku_kas WHERE cabang_id='samarinda'`)
			.first<number>('n');
		const archived = await db
			.prepare(
				`SELECT COALESCE(SUM(total_nominal),0) AS n FROM ringkasan_kas_arsip_harian WHERE cabang_id='samarinda'`
			)
			.first<number>('n');
		return Number(active || 0) + Number(archived || 0);
	}
	async function resetAll() {
		objects.clear();
		await db.batch(
			[
				'transaksi_kasir',
				'buku_kas',
				'archive_job_items',
				'archive_jobs',
				'ringkasan_kas_arsip_harian',
				'pengaturan'
			].map((t) => db.prepare(`DELETE FROM ${t}`))
		);
	}

	// 1. Multi-chunk menuntaskan semua + paritas + tiap part bounded.
	await resetAll();
	const ids = await seedHeaders(7);
	const before = await ledgerTotal();
	const done = (await runArchive(db, storage, branch, 2025, {
		chunkHeaders: 3,
		maxChunks: 10
	})) as Extract<ArchiveResult, { kind: 'completed' }>;
	assert.equal(done.kind, 'completed');
	assert.equal(done.count, 14);
	assert.equal(done.parts.length, 3);
	assert.equal(done.content, undefined);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 0);
	assert.equal(await ledgerTotal(), before);
	// Tiap id tepat sekali di seluruh objek (tak hilang/duplikat antar part).
	const seen = new Map<string, number>();
	for (const [, content] of objects) {
		const parsed = JSON.parse(content) as { buku_kas: Array<{ id: string }> };
		for (const row of parsed.buku_kas) seen.set(row.id, (seen.get(row.id) || 0) + 1);
	}
	assert.deepEqual([...seen.entries()].sort(), ids.map((id) => [id, 1]).sort());
	// Tiap part ≤ budget byte.
	for (const [, content] of objects) {
		assert.ok(Buffer.byteLength(content, 'utf8') <= ARCHIVE_CHUNK_MAX_BYTES);
	}

	// 2. Crash di tengah (put part-2 gagal) -> recall menuntaskan tanpa rugi.
	await resetAll();
	await seedHeaders(5);
	let puts = 0;
	const flaky = {
		async put(key: string, value: string) {
			puts += 1;
			if (puts === 2) throw new Error('R2 put part-2 meledak');
			objects.set(key, value);
		},
		async get(key: string) {
			if (!objects.has(key)) return null;
			const text = objects.get(key)!;
			return {
				text: async () => text,
				arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer
			};
		}
	};
	await assert.rejects(runArchive(db, flaky, branch, 2025, { chunkHeaders: 2, maxChunks: 10 }));
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 3);
	await runArchive(db, storage, branch, 2025, { chunkHeaders: 2, maxChunks: 10 });
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 0);
	assert.equal(await ledgerTotal(), 5000);

	// 3. Byte budget: 8 baris x 200KB -> pecah, tiap part ≤ 1MB.
	await resetAll();
	await seedHeaders(8, { prefix: 'big', padSnapshot: 200_000 });
	const big = (await runArchive(db, storage, branch, 2025, {
		chunkHeaders: 50,
		maxChunks: 10
	})) as Extract<ArchiveResult, { kind: 'completed' }>;
	assert.equal(big.kind, 'completed');
	assert.ok(big.parts.length >= 2);
	for (const [, content] of objects) {
		assert.ok(Buffer.byteLength(content, 'utf8') <= ARCHIVE_CHUNK_MAX_BYTES);
	}
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 0);

	// 4. Cap per panggilan -> partial jujur + recall menuntaskan.
	await resetAll();
	await seedHeaders(7, { prefix: 'cap' });
	const partial = (await runArchive(db, storage, branch, 2025, {
		chunkHeaders: 3,
		maxChunks: 1
	})) as Extract<ArchiveResult, { kind: 'partial' }>;
	assert.equal(partial.kind, 'partial');
	assert.ok(partial.remaining > 0);
	const resumed = (await runArchive(db, storage, branch, 2025, {
		chunkHeaders: 3,
		maxChunks: 10
	})) as Extract<ArchiveResult, { kind: 'completed' }>;
	assert.equal(resumed.kind, 'completed');
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 0);
	assert.equal(await ledgerTotal(), 7000);

	console.log('archive-chunk-tests: multi-chunk, crash-resume, byte-budget, partial passed');
} finally {
	await close();
}
