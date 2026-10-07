#!/usr/bin/env node
/**
 * Restore drill lokal — bukti dump backup dapat direstore dan SEHAT.
 *
 * Memuat file .sql backup ke database sekali-pakai (SQLite in-memory,
 * atau workerd D1 terisolasi via --d1), lalu mewajibkan:
 * schema/versi/kolom POS aktual, PRAGMA integrity/quick_check ok,
 * orphan domain nol, stok negatif nol, pasangan nomor harian lengkap,
 * dan counter nomor tidak tertinggal dari MAX aktual.
 * Dump mainan/parsial/orphan GAGAL nonzero; backup lengkap lulus PASS.
 * TIDAK menyentuh D1 remote maupun lokal proyek.
 *
 * Usage:
 *   node scripts/restore-drill-local.mjs --file <backup.sql> [--d1]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/** Kolom bisnis POS yang wajib ada (sumber: drizzle schema aktual). */
export const POS_REQUIRED_COLUMNS = Object.freeze({
	buku_kas: [
		'id',
		'cabang_id',
		'waktu',
		'sumber',
		'tipe',
		'jenis',
		'nominal',
		'metode_bayar',
		'receipt_snapshot',
		'nomor_harian',
		'tanggal_nomor'
	],
	transaksi_kasir: ['id', 'cabang_id', 'buku_kas_id', 'jumlah', 'nominal']
});

/**
 * Jalankan seluruh pemeriksaan drill pada adapter { all(sql), get(sql) }.
 * Kembalikan { tables, total, checks[] }. Lempar bila satu pun gagal.
 * `scope`: 'full' (SQLite) atau 'data' (workerd D1 tanpa PRAGMA/schema —
 * schema/PRAGMA sudah dibuktikan pada salinan SQLite sumber).
 */
export function checkDrillDatabase(adapter, scope = 'full') {
	/** @type {Array<{ name: string, detail: string }>} */
	const checks = [];
	const fail = (name, detail) => {
		throw new Error(`DRILL FAIL ${name}: ${detail}`);
	};
	const tables = adapter
		.all(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
		)
		.map((r) => r.name);
	if (!tables.length) fail('schema', 'tidak ada tabel hasil restore');
	if (scope === 'full') {
		for (const [table, columns] of Object.entries(POS_REQUIRED_COLUMNS)) {
			if (!tables.includes(table)) fail('schema', `tabel POS hilang: ${table}`);
			const have = new Set(adapter.all(`PRAGMA table_info("${table}")`).map((c) => c.name));
			const missing = columns.filter((c) => !have.has(c));
			if (missing.length) fail('schema', `${table} kolom hilang: ${missing.join(', ')}`);
		}
		checks.push({
			name: 'schema',
			detail: `POS ${Object.keys(POS_REQUIRED_COLUMNS).join('+')} lengkap`
		});

		const integrity = String(adapter.get('PRAGMA integrity_check')?.integrity_check ?? '');
		if (integrity.toLowerCase() !== 'ok') fail('integrity_check', integrity.slice(0, 200));
		checks.push({ name: 'integrity_check', detail: 'ok' });
		const quick = String(adapter.get('PRAGMA quick_check')?.quick_check ?? '');
		if (quick.toLowerCase() !== 'ok') fail('quick_check', quick.slice(0, 200));
		checks.push({ name: 'quick_check', detail: 'ok' });
	}

	// Domain orphan (cermin detector dataHealth.ts; D1 tak menegakkan FK — ADR 0003).
	const orphanTk = Number(
		adapter.get(
			`SELECT COUNT(*) AS n FROM transaksi_kasir t LEFT JOIN buku_kas b ON b.id = t.buku_kas_id WHERE b.id IS NULL`
		)?.n ?? 0
	);
	if (orphanTk > 0) fail('orphan', `transaksi_kasir yatim: ${orphanTk}`);
	checks.push({ name: 'orphan', detail: 'transaksi_kasir 0 yatim' });
	if (tables.includes('bahan_mutasi')) {
		const orphanMut = Number(
			adapter.get(
				`SELECT COUNT(*) AS n FROM bahan_mutasi m LEFT JOIN bahan b ON b.id = m.bahan_id WHERE b.id IS NULL`
			)?.n ?? 0
		);
		if (orphanMut > 0) fail('orphan', `bahan_mutasi yatim: ${orphanMut}`);
		checks.push({ name: 'orphan-mutasi', detail: '0 yatim' });
	}
	if (tables.includes('bahan')) {
		const neg = Number(
			adapter.get(`SELECT COUNT(*) AS n FROM bahan WHERE stok_saat_ini < 0`)?.n ?? 0
		);
		if (neg > 0) fail('stok-negatif', `${neg} bahan stok negatif`);
		checks.push({ name: 'stok-negatif', detail: '0' });
	}

	// Pasangan nomor harian lengkap (cermin preflight restore AUD-042).
	const pairBad = Number(
		adapter.get(
			`SELECT COUNT(*) AS n FROM buku_kas WHERE (nomor_harian IS NULL) != (tanggal_nomor IS NULL)`
		)?.n ?? 0
	);
	if (pairBad > 0) fail('nomor-pair', `${pairBad} baris pasangan nomor tak lengkap`);
	checks.push({ name: 'nomor-pair', detail: 'lengkap' });

	// Counter tak boleh tertinggal dari MAX aktual (anti pakai-ulang nomor).
	if (tables.includes('pos_nomor_harian')) {
		const behind = adapter.all(
			`SELECT n.cabang_id, n.tanggal, n.terakhir, MAX(b.nomor_harian) AS maks
			 FROM pos_nomor_harian n JOIN buku_kas b
			   ON b.cabang_id = n.cabang_id AND b.tanggal_nomor = n.tanggal
			 GROUP BY n.cabang_id, n.tanggal, n.terakhir HAVING n.terakhir < MAX(b.nomor_harian)`
		);
		if (behind.length)
			fail('counter', `counter tertinggal: ${JSON.stringify(behind).slice(0, 200)}`);
		checks.push({ name: 'counter', detail: 'counter >= MAX' });
	}

	let total = 0;
	for (const name of tables) {
		const n = Number(adapter.get(`SELECT COUNT(*) AS n FROM "${name}"`)?.n ?? 0);
		total += n;
	}
	return { tables, total, checks };
}

function sqliteAdapter(db) {
	return {
		all: (sql) => db.prepare(sql).all(),
		get: (sql) => db.prepare(sql).get()
	};
}

async function workerdAdapter() {
	const { getPlatformProxy } = await import('wrangler');
	const proxy = await getPlatformProxy({ configPath: 'wrangler.pages.jsonc', persist: false });
	const db = proxy.env.DB_SAMARINDA_GROUP;
	return {
		db,
		close: () => proxy.dispose(),
		all: async (sql) => (await db.prepare(sql).all()).results ?? [],
		get: async (sql) => db.prepare(sql).first()
	};
}

const at = (name) => {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : null;
};

export async function main(argv = process.argv.slice(2)) {
	const file = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : at('--file');
	if (!file) {
		console.error('Usage: node scripts/restore-drill-local.mjs --file <backup.sql> [--d1]');
		process.exit(1);
	}
	const useD1 = argv.includes('--d1');
	const full = resolve(file);
	let sql;
	try {
		sql = readFileSync(full, 'utf8');
	} catch {
		console.error(`Restore drill gagal: file tidak terbaca: ${file}`);
		process.exit(1);
	}
	if (!sql.trim()) {
		console.error('Restore drill gagal: file kosong.');
		process.exit(1);
	}
	if (useD1) {
		// Parse via SQLite dulu (gagal parse = drill gagal), lalu salin
		// baris-per-baris ke D1 terisolasi agar pemeriksaan jalan di workerd.
		const mem = new DatabaseSync(':memory:');
		try {
			mem.exec('PRAGMA foreign_keys=OFF;');
			mem.exec(sql);
		} catch (error) {
			console.error(`Restore drill gagal saat apply: ${error.message}`);
			process.exit(1);
		}
		try {
			checkDrillDatabase(sqliteAdapter(mem), 'full');
		} catch (error) {
			console.error(`Restore drill gagal: ${error.message}`);
			mem.close();
			process.exit(1);
		}
		const proxy = await workerdAdapter();
		try {
			const tables = mem
				.prepare(
					`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
				)
				.all();
			for (const { name, sql: ddl } of tables) {
				await proxy.db.batch([
					proxy.db.prepare(`DROP TABLE IF EXISTS "${name}"`),
					proxy.db.prepare(ddl)
				]);
				const cols = mem
					.prepare(`PRAGMA table_info("${name}")`)
					.all()
					.map((c) => c.name);
				const rows = mem.prepare(`SELECT * FROM "${name}"`).all();
				const CHUNK = 50;
				for (let i = 0; i < rows.length; i += CHUNK) {
					const batch = rows
						.slice(i, i + CHUNK)
						.map((r) =>
							proxy.db
								.prepare(
									`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
								)
								.bind(...cols.map((c) => r[c] ?? null))
						);
					await proxy.db.batch(batch);
				}
			}
			const report = await checkDrillDatabase({ all: proxy.all, get: proxy.get }, 'data');
			for (const c of report.checks) console.log(`- cek ${c.name}: ${c.detail}`);
			console.log(
				`PASS restore drill lokal: ${report.tables.length} tabel dari ${file} (workerd D1)`
			);
		} catch (error) {
			console.error(`Restore drill gagal: ${error.message}`);
			process.exit(1);
		} finally {
			await proxy.close();
			mem.close();
		}
		return;
	}
	const db = new DatabaseSync(':memory:');
	try {
		db.exec('PRAGMA foreign_keys=OFF;');
		db.exec(sql);
	} catch (error) {
		console.error(`Restore drill gagal saat apply: ${error.message}`);
		process.exit(1);
	}
	try {
		const report = checkDrillDatabase(sqliteAdapter(db));
		let total = 0;
		for (const name of report.tables) {
			const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()?.n || 0);
			total += n;
			console.log(`- ${name}: ${n} rows`);
		}
		for (const c of report.checks) console.log(`- cek ${c.name}: ${c.detail}`);
		console.log(
			`PASS restore drill lokal: ${report.tables.length} tabel, ${total} rows dari ${file}`
		);
	} catch (error) {
		console.error(`Restore drill gagal: ${error.message}`);
		process.exit(1);
	} finally {
		db.close();
	}
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	main().catch((error) => {
		console.error(`Restore drill gagal: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
