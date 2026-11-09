#!/usr/bin/env node
/**
 * Pemeriksaan kesehatan data pra-migrasi (ADR 0003). Hanya membaca: memuat backup .sql
 * ke SQLite di memori, lalu menjalankan detektor src/lib/server/dataHealth.ts untuk tiap
 * cabang pada shard itu. Tidak pernah menyentuh produksi dan tidak memperbaiki apa pun;
 * temuan diperbaiki manual.
 *
 *   node scripts/data-health.mjs --file <backup.sql> --shard <BINDING>
 *
 * Exit: 0 semua cabang bersih, 1 ada temuan, 2 pemeriksaan tidak dapat dijalankan.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { BRANCH_GROUPS } from '../src/lib/server/branchResolver.ts';
import { DATA_HEALTH_LIMIT, checkDataHealth } from '../src/lib/server/dataHealth.ts';
import { decodeVerifiedSql } from './restore-drill-local.mjs';

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;

const FLAGS = { '--file': 'file', '--shard': 'shard' };

export function parseArgs(argv) {
	const options = {};
	for (let i = 0; i < argv.length; i++) {
		const key = FLAGS[argv[i]];
		if (!key) throw new Error(`Argumen tidak dikenal: ${argv[i]}`);
		const value = argv[++i];
		if (!value || value.startsWith('--')) throw new Error(`Nilai ${argv[i - 1]} wajib diisi`);
		options[key] = value;
	}
	if (!options.file) throw new Error('--file <backup.sql> wajib diisi');
	if (!options.shard) throw new Error('--shard <BINDING> wajib diisi');
	if (!Object.hasOwn(BRANCH_GROUPS, options.shard))
		throw new Error(
			`Shard tidak dikenal: ${options.shard}. Pilih: ${Object.keys(BRANCH_GROUPS).join(', ')}`
		);
	return options;
}

/** Detektor hanya memakai prepare().bind().all(); cukup adaptor sekecil ini. */
function d1Like(sql) {
	const statement = (query, args = []) => ({
		bind: (...next) => statement(query, next),
		all: async () => ({ results: sql.prepare(query).all(...args) })
	});
	return { prepare: (query) => statement(query) };
}

const capped = (rows) =>
	rows.length >= DATA_HEALTH_LIMIT ? ` (dibatasi ${DATA_HEALTH_LIMIT} baris)` : '';

function describeFindings(report) {
	const lines = [];
	if (report.orphanTransaksiKasir.length)
		lines.push(
			`  detail transaksi tanpa header buku_kas${capped(report.orphanTransaksiKasir)}:`,
			...report.orphanTransaksiKasir.map((r) => `    - ${r.id} (buku_kas_id=${r.buku_kas_id})`)
		);
	if (report.orphanBahanMutasi.length)
		lines.push(
			`  mutasi bahan tanpa bahan induk${capped(report.orphanBahanMutasi)}:`,
			...report.orphanBahanMutasi.map((r) => `    - ${r.id} (bahan_id=${r.bahan_id})`)
		);
	if (report.negativeStock.length)
		lines.push(
			`  stok negatif${capped(report.negativeStock)}:`,
			...report.negativeStock.map((r) => `    - ${r.kind} ${r.id} "${r.nama ?? ''}" stok=${r.stok}`)
		);
	return lines;
}

/** @returns {Promise<number>} exit code */
export async function main(argv = process.argv.slice(2), out = console) {
	const { file, shard } = parseArgs(argv);
	const sql = decodeVerifiedSql(file, readFileSync(resolve(file)));
	const memory = new DatabaseSync(':memory:');
	try {
		// Dump memuat data apa adanya, termasuk orphan yang justru dicari.
		memory.exec('PRAGMA foreign_keys=OFF;');
		memory.exec(sql);
		const db = d1Like(memory);
		out.log(`Shard ${shard}, backup ${file}`);
		let clean = true;
		for (const branch of BRANCH_GROUPS[shard]) {
			const report = await checkDataHealth(db, branch);
			if (report.clean) {
				out.log(`${branch}: BERSIH`);
				continue;
			}
			clean = false;
			out.log([`${branch}: ADA TEMUAN`, ...describeFindings(report)].join('\n'));
		}
		out.log(
			clean
				? 'Hasil: bersih. Migrasi enforcement boleh dilanjutkan untuk shard ini.'
				: 'Hasil: ada temuan. Hentikan migrasi enforcement; perbaiki data manual, jangan dedup/hapus otomatis.'
		);
		return clean ? EXIT_CLEAN : EXIT_FINDINGS;
	} finally {
		memory.close();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			console.error(`Pemeriksaan gagal: ${error instanceof Error ? error.message : String(error)}`);
			process.exitCode = EXIT_ERROR;
		}
	);
}
