import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// R02: guard finalisasi arsip — satu klaim per cabang, manifest utuh, sesi tutup.
const dir = resolve('drizzle');
const files = readdirSync(dir)
	.filter((f) => f.endsWith('.sql'))
	.sort();
const db = new DatabaseSync(':memory:');
for (const f of files) {
	const c = readFileSync(join(dir, f), 'utf8');
	for (const s of c
		.split('--> statement-breakpoint')
		.map((x) => x.trim())
		.filter(Boolean)) {
		db.exec(s);
	}
}

// 1. Dua cutoff berbeda tak bisa klaim bersamaan dalam satu cabang.
db.prepare(
	'INSERT INTO archive_jobs (id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at) VALUES (?,?,?,?,?,?,?)'
).run('j1', 'samarinda', 2026, 'x', 'claimed', 'o1', Date.now() + 600000);
assert.throws(() => {
	db.prepare(
		'INSERT INTO archive_jobs (id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at) VALUES (?,?,?,?,?,?,?)'
	).run('j2', 'samarinda', 2027, 'x', 'claimed', 'o2', Date.now() + 600000);
}, /UNIQUE/i);
db.prepare(
	'INSERT INTO archive_jobs (id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at) VALUES (?,?,?,?,?,?,?)'
).run('j3', 'balikpapan', 2027, 'x', 'claimed', 'o3', Date.now() + 600000);

// 2. Edit saat upload: drift revision menggagalkan SEMUA efek termasuk summary+completed.
const now = new Date().toISOString();
db.prepare(
	'INSERT INTO buku_kas (id,cabang_id,waktu,sumber,tipe,jenis,nominal,revision) VALUES (?,?,?,?,?,?,?,?)'
).run('bk1', 'samarinda', '2024-01-01T00:00:00.000Z', 'catat', 'in', 'pendapatan_usaha', 150000, 0);
db.prepare(
	'INSERT INTO archive_job_items (job_id,cabang_id,buku_kas_id,revision) VALUES (?,?,?,?)'
).run('j1', 'samarinda', 'bk1', 0);
// nominal diubah + revision naik setelah snapshot
db.prepare('UPDATE buku_kas SET nominal = ?, revision = revision + 1 WHERE id = ?').run(
	200000,
	'bk1'
);
const manifestOk =
	'NOT EXISTS (SELECT 1 FROM archive_job_items m LEFT JOIN buku_kas b ON b.cabang_id = ? AND b.id = m.buku_kas_id WHERE m.job_id = ? AND (b.id IS NULL OR b.revision != m.revision))';
const sum = db
	.prepare(
		`INSERT INTO ringkasan_kas_arsip_harian (id,cabang_id,archive_id,tanggal_wita,tipe,jenis,jumlah_transaksi,total_nominal,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${manifestOk} AND NOT EXISTS (SELECT 1 FROM ringkasan_kas_arsip_harian WHERE id = ?)`
	)
	.run(
		's1',
		'samarinda',
		'a1',
		'2024-01-01',
		'in',
		'pendapatan_usaha',
		1,
		150000,
		now,
		'samarinda',
		'j1',
		's1'
	);
assert.equal(sum.changes, 0, 'summary tidak boleh masuk saat manifest drift');
const del = db
	.prepare(`DELETE FROM buku_kas WHERE cabang_id = ? AND id IN ('bk1') AND ${manifestOk}`)
	.run('samarinda', 'samarinda', 'j1');
assert.equal(del.changes, 0, 'ledger tidak boleh terhapus saat drift');
assert.equal(
	(db.prepare('SELECT nominal FROM buku_kas WHERE id = ?').get('bk1') as { nominal: number })
		.nominal,
	200000
);

// 3. Sesi dibuka saat upload: klaim finalisasi kalah.
db.prepare(
	'INSERT INTO sesi_toko (id,cabang_id,kas_awal,waktu_buka,is_active) VALUES (?,?,?,?,?)'
).run('s1', 'samarinda', 100000, now, 1);
const claim = db
	.prepare(
		`UPDATE archive_jobs SET status='finalizing' WHERE id=? AND owner_token=? AND status IN ('claimed','uploading') AND lease_expires_at > ? AND NOT EXISTS (SELECT 1 FROM sesi_toko WHERE cabang_id=? AND is_active=1)`
	)
	.run('j1', 'o1', Date.now(), 'samarinda');
assert.equal(claim.changes, 0, 'klaim kalah saat sesi aktif');

// 4. Lease habis: klaim kalah.
db.prepare(
	"UPDATE archive_jobs SET status='uploading', owner_token='o9', lease_expires_at=? WHERE id='j3'"
).run(Date.now() - 1000);
const claimExpired = db
	.prepare(
		`UPDATE archive_jobs SET status='finalizing' WHERE id=? AND owner_token=? AND status IN ('claimed','uploading') AND lease_expires_at > ? AND NOT EXISTS (SELECT 1 FROM sesi_toko WHERE cabang_id=? AND is_active=1)`
	)
	.run('j3', 'o9', Date.now(), 'balikpapan');
assert.equal(claimExpired.changes, 0, 'klaim kalah saat lease habis');

console.log('archive-guard-tests: all assertions passed');
