import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

const now = () => sql`CURRENT_TIMESTAMP`;

export const profil = sqliteTable(
	'profil',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		role: text('role').notNull(),
		username: text('username').notNull(),
		password: text('password').notNull(),
		nama_lengkap: text('nama_lengkap'),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [index('idx_profil_branch_username').on(table.cabang_id, table.username)]
);

export const authSessions = sqliteTable(
	'auth_sessions',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		user_id: text('user_id').notNull(),
		username: text('username').notNull(),
		role: text('role').notNull(),
		created_at: integer('created_at').notNull(),
		expires_at: integer('expires_at').notNull(),
		unlocked_pages: text('unlocked_pages', { mode: 'json' })
			.$type<string[]>()
			.notNull()
			.default([]),
		unlock_expires_at: integer('unlock_expires_at').notNull().default(0)
	},
	(table) => [
		index('idx_auth_sessions_expires').on(table.expires_at),
		index('idx_auth_sessions_user').on(table.cabang_id, table.user_id)
	]
);

export const produk = sqliteTable(
	'produk',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		nama: text('nama').notNull(),
		harga: real('harga').notNull(),
		harga_jumbo: real('harga_jumbo'),
		stok: integer('stok').default(0),
		lacak_stok: integer('lacak_stok', { mode: 'boolean' }).default(false),
		lacak_bahan: integer('lacak_bahan', { mode: 'boolean' }).default(false),
		gambar: text('gambar'),
		kategori_id: text('kategori_id'),
		tipe: text('tipe').default('minuman'),
		deskripsi: text('deskripsi'),
		ekstra_ids: text('ekstra_ids', { mode: 'json' }).$type<Array<string | number>>().default([]),
		is_active: integer('is_active', { mode: 'boolean' }).default(true),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_produk_branch_created').on(table.cabang_id, table.created_at),
		index('idx_produk_branch_kategori').on(table.cabang_id, table.kategori_id)
	]
);

export const bahan = sqliteTable(
	'bahan',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		nama: text('nama').notNull(),
		satuan: text('satuan').notNull().default('gram'),
		tipe_satuan: text('tipe_satuan').default('berat'),
		isi_per_kemasan: real('isi_per_kemasan').default(1),
		satuan_beli: text('satuan_beli'),
		kategori: text('kategori').default('Bahan Baku'),
		stok_saat_ini: real('stok_saat_ini').notNull().default(0),
		ambang_stok: real('ambang_stok').notNull().default(0),
		yield_persen: real('yield_persen').notNull().default(100),
		biaya_per_satuan: real('biaya_per_satuan').notNull().default(0),
		jumlah_beli_terakhir: real('jumlah_beli_terakhir').notNull().default(0),
		biaya_beli_terakhir: real('biaya_beli_terakhir').notNull().default(0),
		is_active: integer('is_active', { mode: 'boolean' }).default(true),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_bahan_branch_created').on(table.cabang_id, table.created_at),
		index('idx_bahan_branch_name').on(table.cabang_id, table.nama),
		index('idx_bahan_branch_kategori').on(table.cabang_id, table.kategori),
		check('chk_bahan_yield_persen', sql`${table.yield_persen} > 0 AND ${table.yield_persen} <= 100`)
	]
);

export const hppSettings = sqliteTable(
	'pengaturan_hpp',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		sewa_bulanan: real('sewa_bulanan').notNull().default(0),
		listrik_bulanan: real('listrik_bulanan').notNull().default(0),
		air_bulanan: real('air_bulanan').notNull().default(0),
		gaji_bulanan: real('gaji_bulanan').notNull().default(0),
		lainnya_bulanan: real('lainnya_bulanan').notNull().default(0),
		rincian_biaya: text('rincian_biaya'),
		target_item_bulanan: integer('target_item_bulanan').notNull().default(1000),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [index('idx_hpp_settings_branch').on(table.cabang_id)]
);

export const resepProduk = sqliteTable(
	'resep_produk',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		produk_id: text('produk_id').notNull(),
		bahan_id: text('bahan_id').notNull(),
		porsi: text('porsi').default('reguler'),
		jumlah_per_item: real('jumlah_per_item').notNull(),
		satuan_resep: text('satuan_resep'),
		jumlah_dasar_per_item: real('jumlah_dasar_per_item'),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_resep_produk_branch_product').on(table.cabang_id, table.produk_id),
		index('idx_resep_produk_branch_bahan').on(table.cabang_id, table.bahan_id),
		uniqueIndex('idx_resep_produk_product_bahan_porsi').on(
			table.cabang_id,
			table.produk_id,
			table.bahan_id,
			table.porsi
		)
	]
);

// [CATATAN]: Ledger append-only: tidak punya updated_at karena baris koreksi ditulis sebagai mutasi baru.
// [CATATAN]: stok_setelah nullable dan tanpa FK dipertahankan untuk kompatibilitas data D1 lama; service
// [CATATAN]: wajib menjaga bahan_id tetap dalam cabang yang sama sampai migrasi constraint terjadwal.
export const bahanMutasi = sqliteTable(
	'bahan_mutasi',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		bahan_id: text('bahan_id').notNull(),
		delta_jumlah: real('delta_jumlah').notNull(),
		stok_setelah: real('stok_setelah'),
		sumber: text('sumber').notNull().default('manual'),
		referensi_id: text('referensi_id'),
		catatan: text('catatan'),
		dibuat_oleh: text('dibuat_oleh'),
		created_at: text('created_at').default(now())
	},
	(table) => [
		index('idx_bahan_mutasi_branch_created').on(table.cabang_id, table.created_at),
		index('idx_bahan_mutasi_branch_bahan').on(table.cabang_id, table.bahan_id)
	]
);

export const kategori = sqliteTable(
	'kategori',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		nama: text('nama').notNull(),
		deskripsi: text('deskripsi'),
		is_active: integer('is_active', { mode: 'boolean' }).default(true),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [index('idx_kategori_branch_created').on(table.cabang_id, table.created_at)]
);

export const tambahan = sqliteTable(
	'tambahan',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		nama: text('nama').notNull(),
		harga: real('harga').notNull(),
		bahan_id: text('bahan_id'),
		jumlah_bahan: real('jumlah_bahan'),
		satuan_resep: text('satuan_resep'),
		jumlah_dasar_per_item: real('jumlah_dasar_per_item'),
		is_active: integer('is_active', { mode: 'boolean' }).default(true),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_tambahan_branch_created').on(table.cabang_id, table.created_at),
		index('idx_tambahan_branch_bahan').on(table.cabang_id, table.bahan_id)
	]
);

export const bukuKas = sqliteTable(
	'buku_kas',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		waktu: text('waktu').notNull(),
		sumber: text('sumber').notNull(),
		tipe: text('tipe').notNull(),
		jenis: text('jenis').notNull(),
		nominal: real('nominal').notNull(),
		jumlah: integer('jumlah'),
		deskripsi: text('deskripsi'),
		nama_pelanggan: text('nama_pelanggan'),
		metode_bayar: text('metode_bayar'),
		transaction_id: text('transaction_id'),
		idempotency_key: text('idempotency_key'),
		request_fingerprint: text('request_fingerprint'),
		receipt_snapshot: text('receipt_snapshot'),
		id_sesi_toko: text('id_sesi_toko'),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_buku_kas_branch_waktu').on(table.cabang_id, table.waktu),
		index('idx_buku_kas_branch_waktu_id').on(table.cabang_id, table.waktu, table.id),
		index('idx_buku_kas_branch_transaction').on(table.cabang_id, table.transaction_id),
		index('idx_buku_kas_branch_sesi').on(table.cabang_id, table.id_sesi_toko),
		uniqueIndex('idx_buku_kas_cabang_idempotency').on(table.cabang_id, table.idempotency_key)
	]
);

export const ringkasanKasArsipHarian = sqliteTable(
	'ringkasan_kas_arsip_harian',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		archive_id: text('archive_id').notNull(),
		tanggal_wita: text('tanggal_wita').notNull(),
		tipe: text('tipe').notNull(),
		jenis: text('jenis').notNull(),
		metode_bayar: text('metode_bayar'),
		jumlah_transaksi: integer('jumlah_transaksi').notNull().default(0),
		total_nominal: real('total_nominal').notNull().default(0),
		created_at: text('created_at').default(now())
	},
	(table) => [
		index('idx_ringkasan_kas_arsip_branch_tanggal').on(table.cabang_id, table.tanggal_wita),
		index('idx_ringkasan_kas_arsip_archive').on(table.archive_id)
	]
);

export const transaksiKasir = sqliteTable(
	'transaksi_kasir',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		buku_kas_id: text('buku_kas_id').notNull(),
		produk_id: text('produk_id'),
		nama_kustom: text('nama_kustom'),
		jumlah: integer('jumlah').notNull(),
		nominal: real('nominal').notNull(),
		harga: real('harga'),
		nama_produk: text('nama_produk'),
		harga_dasar: real('harga_dasar'),
		total_tambahan: real('total_tambahan').default(0),
		snapshot_tambahan: text('snapshot_tambahan'),
		gula: text('gula'),
		es: text('es'),
		catatan: text('catatan'),
		snapshot_hpp: text('snapshot_hpp'),
		nominal_hpp: real('nominal_hpp').default(0),
		transaction_id: text('transaction_id'),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_transaksi_kasir_branch_created').on(table.cabang_id, table.created_at),
		index('idx_transaksi_kasir_branch_created_id').on(table.cabang_id, table.created_at, table.id),
		index('idx_transaksi_kasir_branch_transaction').on(table.cabang_id, table.transaction_id),
		index('idx_transaksi_kasir_branch_buku').on(table.cabang_id, table.buku_kas_id)
	]
);

export const dailySalesSummary = sqliteTable(
	'ringkasan_penjualan_harian',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		tanggal_penjualan: text('tanggal_penjualan').notNull(),
		jumlah_transaksi: integer('jumlah_transaksi').notNull().default(0),
		jumlah_item: integer('jumlah_item').notNull().default(0),
		penjualan_kotor: real('penjualan_kotor').notNull().default(0),
		penjualan_tunai: real('penjualan_tunai').notNull().default(0),
		penjualan_nontunai: real('penjualan_nontunai').notNull().default(0),
		total_hpp: real('total_hpp').notNull().default(0),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		// [CATATAN]: Unique index melindungi satu summary per cabang/tanggal. Index range lama
		// [CATATAN]: dipertahankan sampai migrasi produksi eksplisit dapat menghapusnya dengan aman.
		uniqueIndex('idx_daily_sales_branch_date').on(table.cabang_id, table.tanggal_penjualan),
		index('idx_daily_sales_branch_date_range').on(table.cabang_id, table.tanggal_penjualan)
	]
);

export const dailyProductSales = sqliteTable(
	'penjualan_produk_harian',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		tanggal_penjualan: text('tanggal_penjualan').notNull(),
		produk_id: text('produk_id').notNull(),
		nama_produk: text('nama_produk').notNull(),
		jumlah: integer('jumlah').notNull().default(0),
		penjualan_kotor: real('penjualan_kotor').notNull().default(0),
		penjualan_tunai: real('penjualan_tunai').notNull().default(0),
		penjualan_nontunai: real('penjualan_nontunai').notNull().default(0),
		jumlah_transaksi: integer('jumlah_transaksi').notNull().default(0),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		uniqueIndex('idx_daily_product_sales_unique').on(
			table.cabang_id,
			table.tanggal_penjualan,
			table.produk_id
		),
		index('idx_daily_product_sales_branch_date').on(table.cabang_id, table.tanggal_penjualan),
		index('idx_daily_product_sales_branch_product').on(table.cabang_id, table.produk_id)
	]
);

export const pengaturan = sqliteTable(
	'pengaturan',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		kunci: text('kunci'),
		nilai: text('nilai'),
		pin: text('pin'),
		pin_hash: text('pin_hash'),
		halaman_terkunci: text('halaman_terkunci', { mode: 'json' }).$type<string[]>().default([]),
		nama_toko: text('nama_toko'),
		alamat: text('alamat'),
		telepon: text('telepon'),
		instagram: text('instagram'),
		ucapan: text('ucapan'),
		pajak_config: text('pajak_config'),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_pengaturan_branch').on(table.cabang_id),
		uniqueIndex('idx_pengaturan_branch_kunci').on(table.cabang_id, table.kunci)
	]
);

export const sesiToko = sqliteTable(
	'sesi_toko',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		kas_awal: real('kas_awal').notNull(),
		waktu_buka: text('waktu_buka').notNull(),
		waktu_tutup: text('waktu_tutup'),
		is_active: integer('is_active', { mode: 'boolean' }).default(true),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_sesi_toko_branch_active').on(table.cabang_id, table.is_active),
		index('idx_sesi_toko_branch_opening').on(table.cabang_id, table.waktu_buka)
	]
);

export const auditLogs = sqliteTable(
	'audit_logs',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		actor_user_id: text('actor_user_id'),
		actor_username: text('actor_username'),
		actor_role: text('actor_role'),
		action: text('action').notNull(),
		entity_type: text('entity_type').notNull(),
		entity_id: text('entity_id'),
		transaction_id: text('transaction_id'),
		amount: real('amount'),
		metadata: text('metadata'),
		ip_hash: text('ip_hash'),
		created_at: text('created_at').default(now())
	},
	(table) => [
		index('idx_audit_logs_branch_created').on(table.cabang_id, table.created_at),
		index('idx_audit_logs_branch_action').on(table.cabang_id, table.action),
		index('idx_audit_logs_branch_transaction').on(table.cabang_id, table.transaction_id)
	]
);

export const rateLimits = sqliteTable(
	'rate_limits',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		identifier: text('identifier').notNull(),
		count: integer('count').notNull(),
		reset_at: integer('reset_at').notNull(),
		updated_at: integer('updated_at').notNull()
	},
	(table) => [
		index('idx_rate_limits_cabang_identifier').on(table.cabang_id, table.identifier),
		index('idx_rate_limits_reset').on(table.reset_at)
	]
);

export const errorEvents = sqliteTable(
	'error_events',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		source: text('source').notNull(),
		message: text('message').notNull(),
		stack: text('stack'),
		status: integer('status'),
		context: text('context'),
		user_id: text('user_id'),
		role: text('role'),
		created_at: text('created_at').default(now())
	},
	(table) => [
		index('idx_error_events_branch_created').on(table.cabang_id, table.created_at),
		index('idx_error_events_branch_source').on(table.cabang_id, table.source)
	]
);

export const requestMetrics = sqliteTable(
	'request_metrics',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		method: text('method').notNull(),
		path: text('path').notNull(),
		status: integer('status').notNull(),
		duration_ms: real('duration_ms').notNull(),
		db_meta: text('db_meta'),
		user_id: text('user_id'),
		role: text('role'),
		created_at: text('created_at').default(now())
	},
	(table) => [
		index('idx_request_metrics_branch_created').on(table.cabang_id, table.created_at),
		index('idx_request_metrics_branch_path').on(table.cabang_id, table.path)
	]
);

export const d1BackupRuns = sqliteTable(
	'd1_backup_runs',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		database_name: text('database_name').notNull(),
		operation: text('operation').notNull(),
		status: text('status').notNull(),
		file_path: text('file_path'),
		file_size_bytes: integer('file_size_bytes'),
		message: text('message'),
		started_at: text('started_at').notNull(),
		finished_at: text('finished_at')
	},
	(table) => [
		index('idx_d1_backup_runs_branch_started').on(table.cabang_id, table.started_at),
		index('idx_d1_backup_runs_db_started').on(table.database_name, table.started_at)
	]
);

export const auditLogOutbox = sqliteTable(
	'audit_log_outbox',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		payload: text('payload').notNull(),
		attempt_count: integer('attempt_count').notNull().default(0),
		last_error: text('last_error'),
		created_at: text('created_at').notNull(),
		updated_at: text('updated_at').notNull()
	},
	(table) => [index('idx_audit_log_outbox_branch_created').on(table.cabang_id, table.created_at)]
);
