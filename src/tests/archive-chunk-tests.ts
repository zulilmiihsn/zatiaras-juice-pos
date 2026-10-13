import assert from 'node:assert/strict';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
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

	// Observe actual rows returned by the real adapter, not SQL text or a mocked size detector.
	function observePayloadReads(onBeforeBatch?: () => Promise<void>) {
		let transferredRows = 0;
		const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
		const observe = (result: { results?: Record<string, unknown>[] }) => {
			transferredRows += (result.results || []).filter(
				(row) => 'receipt_snapshot' in row || 'catatan' in row
			).length;
		};
		function wrap(statement: D1PreparedStatement): D1PreparedStatement {
			const proxy = new Proxy(statement, {
				get(target, key) {
					if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
					if (key === 'all')
						return async () => {
							const result = await target.all<Record<string, unknown>>();
							observe(result);
							return result;
						};
					const value = Reflect.get(target, key);
					return typeof value === 'function' ? value.bind(target) : value;
				}
			});
			originals.set(proxy, statement);
			return proxy;
		}
		const observed = new Proxy(db, {
			get(target, key) {
				if (key === 'prepare') return (query: string) => wrap(target.prepare(query));
				if (key === 'batch')
					return async (statements: D1PreparedStatement[]) => {
						await onBeforeBatch?.();
						const results = await target.batch<Record<string, unknown>>(
							statements.map((statement) => originals.get(statement) || statement)
						);
						for (const result of results) observe(result);
						return results;
					};
				const value = Reflect.get(target, key);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		}) as D1Database;
		return { db: observed, transferredRows: () => transferredRows };
	}

	// An indivisible valid legacy sale/group cannot bypass the cap when shrinking reaches one header.
	for (const field of ['deskripsi', 'catatan'] as const) {
		await resetAll();
		await seedHeaders(1, { prefix: 'oversized' });
		await db.prepare("UPDATE buku_kas SET receipt_snapshot=NULL WHERE id='oversized-0'").run();
		await db
			.prepare(`UPDATE ${field === 'deskripsi' ? 'buku_kas' : 'transaksi_kasir'} SET ${field}=?`)
			.bind('ü🧾'.repeat(250000))
			.run();
		const tables = ['buku_kas', 'transaksi_kasir', 'ringkasan_kas_arsip_harian', 'pengaturan'];
		const snapshot = async () =>
			Object.fromEntries(
				await Promise.all(
					tables.map(async (table) => [
						table,
						(await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results.map((row) => ({
							...row
						}))
					])
				)
			);
		const beforeFailure = await snapshot();
		const observed = observePayloadReads();
		await assert.rejects(
			runArchive(observed.db, storage, branch, 2025),
			(error) => error instanceof Error && /batas ukuran|byte budget/i.test(error.message)
		);
		assert.equal(
			observed.transferredRows(),
			0,
			'Oversized header/detail is rejected before full fields cross the D1 adapter'
		);
		assert.equal(objects.size, 0, 'Oversized group never reaches R2 put');
		assert.deepEqual(
			await snapshot(),
			beforeFailure,
			'Oversized source business rows/summaries/markers stay intact'
		);
		assert.equal(
			await db
				.prepare(
					"SELECT COUNT(*) AS n FROM archive_jobs WHERE status IN ('claimed','uploading','finalizing')"
				)
				.first('n'),
			0,
			'Failure releases owned lease'
		);
	}

	// A preflight is not authority to read a subsequently enlarged group.
	for (const growth of ['header', 'details'] as const) {
		await resetAll();
		await seedHeaders(1, { prefix: 'race' });
		let injected = false;
		const observed = observePayloadReads(async () => {
			if (injected) return;
			injected = true;
			await db
				.prepare(
					growth === 'header'
						? "UPDATE buku_kas SET deskripsi=? WHERE id='race-0'"
						: "UPDATE transaksi_kasir SET catatan=? WHERE buku_kas_id='race-0'"
				)
				.bind('🧾'.repeat(400000))
				.run();
		});
		await assert.rejects(
			runArchive(observed.db, storage, branch, 2025),
			(error) => error instanceof Error && /berubah bersamaan/.test(error.message)
		);
		assert.equal(injected, true);
		assert.equal(observed.transferredRows(), 0, 'Guard rejects growth before field transfer');
		assert.equal(objects.size, 0);
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 1);
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM archive_jobs').first('n'), 0);
	}

	// Valid escaped UTF-8/NUL bytes and precise historical HPP survive raw reads.
	await resetAll();
	await seedHeaders(1, { prefix: 'escaped' });
	const originalText = 'ü🧾"\\\u0000'.repeat(10000);
	await db
		.prepare("UPDATE buku_kas SET deskripsi=?,receipt_snapshot=NULL WHERE id='escaped-0'")
		.bind(originalText)
		.run();
	await db
		.prepare("UPDATE transaksi_kasir SET catatan=?,nominal_hpp=? WHERE buku_kas_id='escaped-0'")
		.bind(originalText, 6000.062500000001)
		.run();
	await runArchive(db, storage, branch, 2025);
	const historical = JSON.parse([...objects.values()][0]) as {
		buku_kas: Array<{ deskripsi: string; receipt_snapshot: null }>;
		transaksi_kasir: Array<{ catatan: string; nominal_hpp: number }>;
	};
	assert.equal(historical.buku_kas[0].deskripsi, originalText);
	assert.equal(historical.buku_kas[0].receipt_snapshot, null);
	assert.equal(historical.transaksi_kasir[0].catatan, originalText);
	assert.equal(historical.transaksi_kasir[0].nominal_hpp, 6000.062500000001);

	// Fan-out cannot hide an oversized group behind many individually small details.
	await resetAll();
	await seedHeaders(1, { prefix: 'fanout' });
	for (let i = 0; i < 1200; i += 50) {
		await db.batch(
			Array.from({ length: 50 }, (_, n) =>
				db
					.prepare(
						`INSERT INTO transaksi_kasir
			(id,cabang_id,buku_kas_id,jumlah,nominal,catatan,created_at)
			VALUES(?,'samarinda','fanout-0',1,1,?,'2024-06-15T02:00:00.000Z')`
					)
					.bind(`fanout-extra-${i + n}`, 'x'.repeat(1000))
			)
		);
	}
	const fanout = observePayloadReads();
	await assert.rejects(
		runArchive(fanout.db, storage, branch, 2025),
		(error) => error instanceof Error && /batas ukuran/.test(error.message)
	);
	assert.equal(fanout.transferredRows(), 0);
	assert.equal(objects.size, 0);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM transaksi_kasir').first('n'), 1201);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM archive_jobs').first('n'), 0);

	// A later oversized group cannot roll back or erase a previously committed part.
	await resetAll();
	await seedHeaders(2, { prefix: 'later' });
	await db
		.prepare("UPDATE buku_kas SET deskripsi=? WHERE id='later-1'")
		.bind('ü🧾'.repeat(250000))
		.run();
	await assert.rejects(
		runArchive(db, storage, branch, 2025),
		(error) => error instanceof Error && /batas ukuran/.test(error.message)
	);
	assert.equal(objects.size, 1);
	assert.equal(
		await db.prepare("SELECT COUNT(*) AS n FROM buku_kas WHERE id='later-1'").first('n'),
		1
	);
	assert.equal(
		await db.prepare("SELECT COUNT(*) AS n FROM buku_kas WHERE id='later-0'").first('n'),
		0
	);
	assert.equal(await ledgerTotal(), 2000);
	assert.equal(
		await db.prepare("SELECT COUNT(*) AS n FROM archive_jobs WHERE status='completed'").first('n'),
		1
	);

	// SQL JSON sizing must fail closed on corrupt binary business fields, not rewrite bytes.
	await resetAll();
	await seedHeaders(1, { prefix: 'binary' });
	await db.prepare("UPDATE buku_kas SET deskripsi=x'00ff010203' WHERE id='binary-0'").run();
	const binary = observePayloadReads();
	await assert.rejects(
		runArchive(binary.db, storage, branch, 2025),
		(error) => error instanceof Error && /batas ukuran/.test(error.message)
	);
	assert.equal(binary.transferredRows(), 0);
	assert.equal(
		await db
			.prepare("SELECT hex(deskripsi) AS value FROM buku_kas WHERE id='binary-0'")
			.first('value'),
		'00FF010203'
	);
	assert.equal(objects.size, 0);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM archive_jobs').first('n'), 0);

	// Compact locators/guards are tenant-scoped even on a shared physical shard.
	await resetAll();
	await seedHeaders(1, { prefix: 'own' });
	await db
		.prepare(
			`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,deskripsi)
		VALUES('foreign-large','balikpapan','2024-06-01T02:00:00.000Z','catat','in','pendapatan_usaha',4321,?)`
		)
		.bind('ü🧾'.repeat(250000))
		.run();
	await runArchive(db, storage, branch, 2025);
	assert.equal(
		await db.prepare("SELECT nominal FROM buku_kas WHERE id='foreign-large'").first('nominal'),
		4321
	);
	assert.equal(objects.size, 1);
	assert.ok(![...objects.values()][0].includes('foreign-large'));

	// Options cannot turn compact/payload reads into an unbounded query.
	for (const options of [{ chunkHeaders: 10000 }, { chunkHeaders: 0 }, { maxChunks: 9999 }]) {
		await resetAll();
		await seedHeaders(1, { prefix: 'options' });
		await assert.rejects(
			runArchive(db, storage, branch, 2025, options),
			(error) => error instanceof Error && /Batas chunk/.test(error.message)
		);
		assert.equal(objects.size, 0);
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
	assert.equal(Object.hasOwn(done, 'content'), false);
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

	console.log(
		'archive-chunk-tests: compact preread/growth/fanout/binary/tenant/UTF8/NULL/HPP/later-part + indivisible byte cap/multi-chunk/crash-resume/partial passed'
	);
} finally {
	await close();
}
