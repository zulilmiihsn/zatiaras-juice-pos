import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
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

export const stockPolicy = sqliteTable(
	'stock_policy',
	{
		cabang_id: text('cabang_id').primaryKey(),
		mode: text('mode', { enum: ['tracked', 'ignored'] }).notNull(),
		revision: integer('revision').notNull(),
		disabled_at: text('disabled_at'),
		reconciled_at: text('reconciled_at'),
		updated_at: text('updated_at').notNull(),
		updated_by: text('updated_by').notNull(),
		updated_by_role: text('updated_by_role').notNull(),
		reconciliation_job_id: text('reconciliation_job_id')
	},
	(table) => [
		check('chk_stock_policy_mode', sql`${table.mode} IN ('tracked', 'ignored')`),
		check('chk_stock_policy_revision', sql`${table.revision} >= 1`),
		check('chk_stock_policy_updated_at', sql`length(trim(${table.updated_at})) > 0`),
		check('chk_stock_policy_updated_by', sql`length(trim(${table.updated_by})) > 0`),
		check('chk_stock_policy_updated_by_role', sql`length(trim(${table.updated_by_role})) > 0`),
		check(
			'chk_stock_policy_disabled_at',
			sql`${table.mode} <> 'ignored' OR ${table.disabled_at} IS NOT NULL`
		),
		check(
			'chk_stock_policy_reconciliation',
			sql`${table.reconciliation_job_id} IS NULL OR ${table.reconciled_at} IS NOT NULL`
		)
	]
);

export const stockPolicyTransitions = sqliteTable(
	'stock_policy_transitions',
	{
		cabang_id: text('cabang_id').notNull(),
		revision: integer('revision').notNull(),
		previous_revision: integer('previous_revision').notNull(),
		previous_mode: text('previous_mode', { enum: ['tracked', 'ignored'] }).notNull(),
		mode: text('mode', { enum: ['tracked', 'ignored'] }).notNull(),
		effective_at: text('effective_at').notNull(),
		disabled_at: text('disabled_at'),
		reconciled_at: text('reconciled_at'),
		actor_user_id: text('actor_user_id').notNull(),
		actor_role: text('actor_role').notNull(),
		reconciliation_job_id: text('reconciliation_job_id')
	},
	(table) => [
		primaryKey({ columns: [table.cabang_id, table.revision] }),
		check('chk_stock_policy_transition_revision', sql`${table.revision} >= 1`),
		check('chk_stock_policy_transition_effective_at', sql`length(trim(${table.effective_at})) > 0`),
		check('chk_stock_policy_transition_actor_user', sql`length(trim(${table.actor_user_id})) > 0`),
		check('chk_stock_policy_transition_actor_role', sql`length(trim(${table.actor_role})) > 0`),
		check(
			'chk_stock_policy_transition_previous_revision',
			sql`${table.previous_revision} >= 0 AND ${table.revision} = ${table.previous_revision} + 1`
		),
		check(
			'chk_stock_policy_transition_previous_mode',
			sql`${table.previous_mode} IN ('tracked', 'ignored')`
		),
		check('chk_stock_policy_transition_mode', sql`${table.mode} IN ('tracked', 'ignored')`),
		check(
			'chk_stock_policy_transition_disabled_at',
			sql`${table.mode} <> 'ignored' OR ${table.disabled_at} IS NOT NULL`
		),
		check(
			'chk_stock_policy_transition_reconciliation',
			sql`${table.reconciliation_job_id} IS NULL OR ${table.reconciled_at} IS NOT NULL`
		)
	]
);

export const stockReconciliations = sqliteTable(
	'stock_reconciliations',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		expected_policy_revision: integer('expected_policy_revision').notNull(),
		status: text('status', { enum: ['draft', 'ready', 'applied', 'cancelled'] }).notNull(),
		inventory_fingerprint: text('inventory_fingerprint').notNull(),
		created_by: text('created_by').notNull(),
		created_at: text('created_at').notNull(),
		finalized_at: text('finalized_at')
	},
	(table) => [
		uniqueIndex('idx_stock_reconciliations_one_active_branch')
			.on(table.cabang_id)
			.where(sql`${table.status} IN ('draft', 'ready')`),
		index('idx_stock_reconciliations_branch_status').on(table.cabang_id, table.status),
		index('idx_stock_reconciliations_branch_created').on(table.cabang_id, table.created_at),
		check('chk_stock_reconciliations_revision', sql`${table.expected_policy_revision} >= 1`),
		check(
			'chk_stock_reconciliations_status',
			sql`${table.status} IN ('draft', 'ready', 'applied', 'cancelled')`
		),
		check(
			'chk_stock_reconciliations_finalized',
			sql`(${table.status} = 'applied' AND ${table.finalized_at} IS NOT NULL) OR (${table.status} <> 'applied' AND ${table.finalized_at} IS NULL)`
		)
	]
);

export const stockReconciliationItems = sqliteTable(
	'stock_reconciliation_items',
	{
		job_id: text('job_id').notNull(),
		cabang_id: text('cabang_id').notNull(),
		entity_type: text('entity_type', { enum: ['produk', 'bahan'] }).notNull(),
		entity_id: text('entity_id').notNull(),
		inventory_marker: text('inventory_marker').notNull(),
		counted_quantity: real('counted_quantity')
	},
	(table) => [
		primaryKey({ columns: [table.job_id, table.entity_type, table.entity_id] }),
		index('idx_stock_reconciliation_items_branch_job').on(table.cabang_id, table.job_id),
		index('idx_stock_reconciliation_items_branch_entity').on(
			table.cabang_id,
			table.entity_type,
			table.entity_id
		),
		check('chk_stock_reconciliation_items_type', sql`${table.entity_type} IN ('produk', 'bahan')`),
		check(
			'chk_stock_reconciliation_items_quantity',
			sql`${table.counted_quantity} IS NULL OR (${table.counted_quantity} >= 0 AND typeof(${table.counted_quantity}) IN ('integer', 'real'))`
		)
	]
);

export const offlineStockReviews = sqliteTable(
	'offline_stock_reviews',
	{
		cabang_id: text('cabang_id').notNull(),
		idempotency_key: text('idempotency_key').notNull(),
		request_fingerprint: text('request_fingerprint').notNull(),
		queued_at: integer('queued_at').notNull(),
		policy_revision_at_queue: integer('policy_revision_at_queue'),
		current_policy_revision: integer('current_policy_revision').notNull(),
		revision: integer('revision').notNull().default(0),
		status: text('status', {
			enum: [
				'pending',
				'attached_to_reconciliation',
				'approved_current',
				'approved_after_recount',
				'consumed'
			]
		}).notNull(),
		resolution: text('resolution', { enum: ['apply_current', 'after_recount'] }),
		reconciliation_job_id: text('reconciliation_job_id'),
		approved_policy_revision: integer('approved_policy_revision'),
		reviewed_by: text('reviewed_by'),
		reviewed_at: text('reviewed_at'),
		consumed_at: text('consumed_at')
	},
	(table) => [
		primaryKey({ columns: [table.cabang_id, table.idempotency_key] }),
		index('idx_offline_stock_reviews_branch_status').on(table.cabang_id, table.status),
		index('idx_offline_stock_reviews_branch_job').on(table.cabang_id, table.reconciliation_job_id),
		check(
			'chk_offline_stock_reviews_status',
			sql`${table.status} IN ('pending', 'attached_to_reconciliation', 'approved_current', 'approved_after_recount', 'consumed')`
		),
		check(
			'chk_offline_stock_reviews_consumed',
			sql`${table.status} <> 'consumed' OR ${table.consumed_at} IS NOT NULL`
		)
	]
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

export const produkMutasi = sqliteTable(
	'produk_mutasi',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		produk_id: text('produk_id').notNull(),
		delta_jumlah: integer('delta_jumlah').notNull(),
		stok_setelah: integer('stok_setelah').notNull(),
		sumber: text('sumber', { enum: ['pos', 'void', 'manual', 'reconciliation'] }).notNull(),
		referensi_id: text('referensi_id').notNull(),
		dibuat_oleh: text('dibuat_oleh'),
		created_at: text('created_at').notNull().default(now())
	},
	(table) => [
		uniqueIndex('idx_produk_mutasi_unique_effect').on(
			table.cabang_id,
			table.referensi_id,
			table.produk_id,
			table.sumber
		),
		index('idx_produk_mutasi_branch_created').on(table.cabang_id, table.created_at),
		index('idx_produk_mutasi_branch_produk').on(table.cabang_id, table.produk_id),
		index('idx_produk_mutasi_branch_reference').on(table.cabang_id, table.referensi_id),
		check(
			'chk_produk_mutasi_delta',
			sql`typeof(${table.delta_jumlah}) = 'integer' AND ${table.delta_jumlah} <> 0`
		),
		check('chk_produk_mutasi_balance', sql`typeof(${table.stok_setelah}) = 'integer'`),
		check(
			'chk_produk_mutasi_source',
			sql`${table.sumber} IN ('pos', 'void', 'manual', 'reconciliation')`
		)
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
		stock_policy_mode: text('stock_policy_mode', { enum: ['tracked', 'ignored'] }),
		stock_policy_revision: integer('stock_policy_revision'),
		stock_replay_disposition: text('stock_replay_disposition', {
			enum: ['normal', 'stale_to_ignored', 'owner_approved_current', 'owner_approved_after_recount']
		}),
		restored_from_archive: integer('restored_from_archive', { mode: 'boolean' })
			.notNull()
			.default(false),
		revision: integer('revision').notNull().default(0),
		mutation_token: text('mutation_token'),
		id_sesi_toko: text('id_sesi_toko'),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_buku_kas_branch_waktu').on(table.cabang_id, table.waktu),
		index('idx_buku_kas_branch_waktu_id').on(table.cabang_id, table.waktu, table.id),
		index('idx_buku_kas_branch_transaction').on(table.cabang_id, table.transaction_id),
		index('idx_buku_kas_branch_sesi').on(table.cabang_id, table.id_sesi_toko),
		uniqueIndex('idx_buku_kas_cabang_idempotency').on(table.cabang_id, table.idempotency_key),
		check(
			'chk_buku_kas_stock_policy_mode',
			sql`${table.stock_policy_mode} IS NULL OR ${table.stock_policy_mode} IN ('tracked', 'ignored')`
		),
		check(
			'chk_buku_kas_stock_policy_revision',
			sql`${table.stock_policy_revision} IS NULL OR ${table.stock_policy_revision} >= 0`
		),
		check(
			'chk_buku_kas_stock_policy_pair',
			sql`(${table.stock_policy_mode} IS NULL) = (${table.stock_policy_revision} IS NULL)`
		),
		check(
			'chk_buku_kas_stock_replay_disposition',
			sql`${table.stock_replay_disposition} IS NULL OR ${table.stock_replay_disposition} IN ('normal', 'stale_to_ignored', 'owner_approved_current', 'owner_approved_after_recount')`
		),
		check('chk_buku_kas_restored_from_archive', sql`${table.restored_from_archive} IN (0, 1)`)
	]
);

export const posVoidMarkers = sqliteTable(
	'pos_void_markers',
	{
		cabang_id: text('cabang_id').notNull(),
		transaction_id: text('transaction_id').notNull(),
		idempotency_key: text('idempotency_key'),
		request_fingerprint: text('request_fingerprint'),
		actor: text('actor'),
		created_at: text('created_at').default(now())
	},
	(table) => [
		primaryKey({ columns: [table.cabang_id, table.transaction_id] }),
		index('idx_pos_void_markers_branch_key').on(table.cabang_id, table.idempotency_key)
	]
);

export const archiveJobs = sqliteTable(
	'archive_jobs',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		before_year: integer('before_year').notNull(),
		cutoff: text('cutoff').notNull(),
		status: text('status').notNull(),
		owner_token: text('owner_token').notNull(),
		lease_expires_at: integer('lease_expires_at').notNull(),
		object_key: text('object_key'),
		checksum: text('checksum'),
		counts: text('counts'),
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [index('idx_archive_jobs_branch_status').on(table.cabang_id, table.status)]
);

export const archiveJobItems = sqliteTable(
	'archive_job_items',
	{
		job_id: text('job_id').notNull(),
		cabang_id: text('cabang_id').notNull(),
		buku_kas_id: text('buku_kas_id').notNull(),
		transaction_id: text('transaction_id'),
		revision: integer('revision').notNull().default(0)
	},
	(table) => [
		primaryKey({ columns: [table.job_id, table.buku_kas_id] }),
		index('idx_archive_job_items_job').on(table.job_id)
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
		created_at: text('created_at').default(now()),
		updated_at: text('updated_at').default(now())
	},
	(table) => [
		index('idx_pengaturan_branch').on(table.cabang_id),
		uniqueIndex('idx_pengaturan_branch_kunci').on(table.cabang_id, table.kunci),
		uniqueIndex('idx_pengaturan_branch_main')
			.on(table.cabang_id)
			.where(sql`${table.kunci} IS NULL`)
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

export const auditLogQuarantine = sqliteTable(
	'audit_log_quarantine',
	{
		id: text('id').primaryKey(),
		cabang_id: text('cabang_id').notNull(),
		payload: text('payload').notNull(),
		reason: text('reason'),
		attempt_count: integer('attempt_count').notNull().default(0),
		created_at: text('created_at').default(now()),
		quarantined_at: text('quarantined_at').default(now())
	},
	(table) => [index('idx_audit_log_quarantine_branch').on(table.cabang_id)]
);
