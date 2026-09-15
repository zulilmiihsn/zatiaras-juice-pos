import { createHash, randomUUID } from 'node:crypto';

/**
 * Builder + validasi restore arsip (F20). Dipakai CLI scripts/restore-archive.mjs
 * dan tes. Default dry-run; tidak ada efek samping saat build.
 */

export function parseRestoreArgs(argv) {
	const at = (name) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : null;
	};
	return {
		file: at('--file'),
		apply: argv.includes('--apply'),
		remote: argv.includes('--remote'),
		binding: at('--binding'),
		expectSha256: at('--expect-sha256')
	};
}

export function sha256Hex(content) {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function sqlVal(val) {
	if (val === null || val === undefined) return 'NULL';
	if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
	if (typeof val === 'boolean') return val ? '1' : '0';
	return `'${String(val).replace(/'/g, "''")}'`;
}

export function validateArchive(archive) {
	const errors = [];
	if (
		!archive ||
		typeof archive !== 'object' ||
		!archive.meta ||
		!Array.isArray(archive.buku_kas)
	) {
		return {
			ok: false,
			errors: ['Struktur arsip tidak memenuhi spesifikasi (missing meta / buku_kas)']
		};
	}
	const schemaVersion = Number(archive.meta.schema_version || 1);
	if (![1, 2].includes(schemaVersion))
		errors.push(`Versi skema arsip tidak didukung: ${archive.meta.schema_version}`);
	const buku_kas = archive.buku_kas;
	const transaksi_kasir = Array.isArray(archive.transaksi_kasir) ? archive.transaksi_kasir : [];
	const branch = archive.meta.branch || 'samarinda';
	if (archive.meta.counts) {
		if (archive.meta.counts.buku_kas !== buku_kas.length)
			errors.push(`MISMATCH buku_kas (${buku_kas.length} != ${archive.meta.counts.buku_kas})`);
		if (archive.meta.counts.transaksi_kasir !== transaksi_kasir.length)
			errors.push(
				`MISMATCH transaksi_kasir (${transaksi_kasir.length} != ${archive.meta.counts.transaksi_kasir})`
			);
	}
	const bkIds = new Set();
	for (const r of buku_kas) {
		if (!r.id || bkIds.has(r.id)) {
			errors.push(`Duplikat/ID invalid buku_kas: ${r.id}`);
			break;
		}
		bkIds.add(r.id);
		if (r.cabang_id && r.cabang_id !== branch)
			errors.push(`Cabang row ${r.id} != metadata ${branch}`);
	}
	for (const t of transaksi_kasir) {
		if (t.cabang_id && t.cabang_id !== branch)
			errors.push(`Cabang detail ${t.id} != metadata ${branch}`);
		if (t.buku_kas_id && !bkIds.has(t.buku_kas_id))
			errors.push(`Orphan detail ${t.id} -> ${t.buku_kas_id}`);
	}
	return { ok: errors.length === 0, errors, branch, buku_kas, transaksi_kasir };
}

/**
 * Bandingkan snapshot vs row target yang sudah ada.
 * - identik -> skip (idempoten, apply kedua no-op)
 * - beda -> conflict (hentikan, jangan timpa transaksi baru)
 */
export function diffAgainstExisting(snapshotRows, existingById, fields) {
	const skip = [];
	const conflict = [];
	const insert = [];
	for (const row of snapshotRows) {
		const cur = existingById.get(String(row.id));
		if (!cur) {
			insert.push(row);
			continue;
		}
		const same = fields.every((f) => String(cur[f] ?? '') === String(row[f] ?? ''));
		if (same) skip.push(row);
		else conflict.push({ id: row.id, expected: row, actual: cur });
	}
	return { skip, conflict, insert };
}

const BK_FIELDS = ['cabang_id', 'waktu', 'sumber', 'tipe', 'jenis', 'nominal', 'transaction_id'];
const TK_FIELDS = ['cabang_id', 'buku_kas_id', 'jumlah', 'nominal', 'transaction_id'];

export function buildRestoreSql(archive, opts = {}) {
	const { branch, buku_kas, transaksi_kasir } = validateArchive(archive);
	const archiveId = archive.meta.archive_id || archive.meta.id || 'unknown';
	const now = new Date().toISOString();
	const lines = ['-- ZatiarasPOS Archive Restore Transaction', 'BEGIN TRANSACTION;'];
	// Hapus ringkasan manual arsip yang sama (cabang+archive), satu unit commit restore.
	lines.push(
		`DELETE FROM ringkasan_kas_arsip_harian WHERE cabang_id = ${sqlVal(branch)} AND archive_id = ${sqlVal(archiveId)};`
	);
	// sumber DIPERTAHANKAN persis (pos tetap pos) agar laporan tidak ganda.
	// Penanda restore ada di pengaturan, bukan field bisnis.
	for (const b of buku_kas) {
		lines.push(
			`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, deskripsi, nama_pelanggan, metode_bayar, transaction_id, idempotency_key, request_fingerprint, receipt_snapshot, id_sesi_toko, created_at, updated_at) SELECT ${sqlVal(b.id)}, ${sqlVal(b.cabang_id || branch)}, ${sqlVal(b.waktu)}, ${sqlVal(b.sumber)}, ${sqlVal(b.tipe)}, ${sqlVal(b.jenis)}, ${sqlVal(b.nominal)}, ${sqlVal(b.jumlah)}, ${sqlVal(b.deskripsi)}, ${sqlVal(b.nama_pelanggan)}, ${sqlVal(b.metode_bayar)}, ${sqlVal(b.transaction_id)}, ${sqlVal(b.idempotency_key)}, ${sqlVal(b.request_fingerprint)}, ${sqlVal(b.receipt_snapshot)}, ${sqlVal(b.id_sesi_toko)}, ${sqlVal(b.created_at)}, ${sqlVal(b.updated_at || now)} WHERE NOT EXISTS (SELECT 1 FROM buku_kas WHERE id = ${sqlVal(b.id)});`
		);
	}
	for (const t of transaksi_kasir) {
		lines.push(
			`INSERT INTO transaksi_kasir (id, cabang_id, buku_kas_id, produk_id, nama_kustom, jumlah, nominal, harga, nama_produk, harga_dasar, total_tambahan, snapshot_tambahan, gula, es, catatan, snapshot_hpp, nominal_hpp, transaction_id, created_at, updated_at) SELECT ${sqlVal(t.id)}, ${sqlVal(t.cabang_id || branch)}, ${sqlVal(t.buku_kas_id)}, ${sqlVal(t.produk_id)}, ${sqlVal(t.nama_kustom)}, ${sqlVal(t.jumlah)}, ${sqlVal(t.nominal)}, ${sqlVal(t.harga)}, ${sqlVal(t.nama_produk)}, ${sqlVal(t.harga_dasar)}, ${sqlVal(t.total_tambahan || 0)}, ${sqlVal(t.snapshot_tambahan)}, ${sqlVal(t.gula)}, ${sqlVal(t.es)}, ${sqlVal(t.catatan)}, ${sqlVal(t.snapshot_hpp)}, ${sqlVal(t.nominal_hpp || 0)}, ${sqlVal(t.transaction_id)}, ${sqlVal(t.created_at)}, ${sqlVal(t.updated_at || now)} WHERE NOT EXISTS (SELECT 1 FROM transaksi_kasir WHERE id = ${sqlVal(t.id)});`
		);
	}
	lines.push(
		`INSERT INTO pengaturan (id, cabang_id, kunci, nilai, updated_at) VALUES (${sqlVal(randomUUID())}, ${sqlVal(branch)}, ${sqlVal('archive_restore_' + archiveId)}, ${sqlVal(JSON.stringify({ restored_at: now, archive_id: archiveId, sha256: opts.sha256 || null }))}, ${sqlVal(now)}) ON CONFLICT(cabang_id, kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = excluded.updated_at;`
	);
	lines.push('COMMIT;');
	return { sql: lines.join('\n'), branch, archiveId };
}

export { BK_FIELDS, TK_FIELDS };
