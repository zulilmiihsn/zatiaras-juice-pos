import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { BranchId } from '$lib/server/branchResolver';
import type {
	ComputedTransactionItem,
	StockDeductions,
	IngredientDeductions,
	CheckoutCapabilities
} from '$lib/server/checkout/types';

interface BuildStatementsParams {
	db: D1Database;
	branch: BranchId;
	items: ComputedTransactionItem[];
	stockDeductions: StockDeductions;
	ingredientDeductions: IngredientDeductions;
	totalAmount: number;
	totalQty: number;
	totalHpp: number;
	paymentMethod: 'tunai' | 'non-tunai';
	customerName: string | null;
	salesDate: string;
	bukuKasId: string;
	transactionId: string;
	createdAt: string;
	idSesiToko: string | null;
	idempotencyKey: string;
	requestFingerprint?: string | null;
	receiptSnapshot?: unknown;
	session: { userId: string; username?: string };
	capabilities: CheckoutCapabilities;
}

export function buildCheckoutStatements(params: BuildStatementsParams): D1PreparedStatement[] {
	const {
		db,
		branch,
		items,
		stockDeductions,
		ingredientDeductions,
		totalAmount,
		totalQty,
		totalHpp,
		paymentMethod,
		customerName,
		salesDate,
		bukuKasId,
		transactionId,
		createdAt,
		idSesiToko,
		idempotencyKey,
		requestFingerprint,
		receiptSnapshot,
		session,
		capabilities: { idempotencyAvailable, salesSummaryAvailable, transactionSnapshotAvailable }
	} = params;

	const deskripsi = `Penjualan ${items.map((i) => i.product_name).join(', ')}`.slice(0, 240);

	const productSummaries = new Map<
		string,
		{ productName: string; jumlah: number; grossSales: number; transactionCount: number }
	>();
	for (const item of items) {
		const summaryKey = item.produk_id || `custom:${item.product_name}`;
		const cleanProductName = item.produk_id
			? item.product_name.replace(/\s*\((?:Jumbo|Reguler)\)/gi, '').trim()
			: item.product_name;
		const current = productSummaries.get(summaryKey) || {
			productName: cleanProductName,
			jumlah: 0,
			grossSales: 0,
			transactionCount: 0
		};
		current.jumlah += item.jumlah;
		current.grossSales += item.nominal;
		current.transactionCount = 1;
		productSummaries.set(summaryKey, current);
	}

	return [
		// [CATATAN]: ── Stock deductions ───────────────────────────────────────────────────
		...Array.from(stockDeductions.entries()).map(([productId, deduction]) =>
			db
				.prepare(
					`UPDATE produk
					 SET stok = COALESCE(stok, 0) - ?, updated_at = ?
					 WHERE cabang_id = ? AND id = ? AND lacak_stok = 1`
				)
				.bind(deduction.jumlah, createdAt, branch, productId)
		),

		// [CATATAN]: ── Ingredient deductions ──────────────────────────────────────────────
		...Array.from(ingredientDeductions.entries()).flatMap(([bahanId, deduction]) => [
			db
				.prepare(
					`UPDATE bahan
					 SET stok_saat_ini = COALESCE(stok_saat_ini, 0) - ?, updated_at = ?
					 WHERE cabang_id = ? AND id = ?`
				)
				.bind(deduction.jumlah, createdAt, branch, bahanId),
			db
				.prepare(
					`INSERT INTO bahan_mutasi (
						id, cabang_id, bahan_id, delta_jumlah, stok_setelah, sumber,
						keterangan, user_id, username, created_at
					) VALUES (?, ?, ?, ?, COALESCE((SELECT stok_saat_ini FROM bahan WHERE cabang_id = ? AND id = ?), 0),
						'pos', ?, ?, ?, ?)`
				)
				.bind(
					crypto.randomUUID(),
					branch,
					bahanId,
					-deduction.jumlah,
					branch,
					bahanId,
					`Pengurangan resep transaksi POS ${transactionId}`,
					session.userId,
					session.username || 'Kasir',
					createdAt
				)
		]),

		// [CATATAN]: ── buku_kas insert ────────────────────────────────────────────────────
		db
			.prepare(
				`INSERT INTO buku_kas (
					id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, deskripsi,
					nama_pelanggan, metode_bayar, transaction_id,
					${idempotencyAvailable ? 'idempotency_key, request_fingerprint, receipt_snapshot,' : ''}
					id_sesi_toko, created_at, updated_at
				) VALUES (?, ?, ?, 'pos', 'in', 'pendapatan_usaha', ?, ?, ?, ?, ?, ?,
					${idempotencyAvailable ? '?, ?, ?,' : ''} ?, ?, ?)`
			)
			.bind(
				bukuKasId,
				branch,
				createdAt,
				totalAmount,
				totalQty,
				deskripsi,
				customerName,
				paymentMethod,
				transactionId,
				...(idempotencyAvailable
					? [
							idempotencyKey,
							requestFingerprint || null,
							receiptSnapshot ? JSON.stringify(receiptSnapshot) : null
						]
					: []),
				idSesiToko,
				createdAt,
				createdAt
			),

		// [CATATAN]: ── transaksi_kasir inserts ────────────────────────────────────────────
		...items.map((item) => {
			if (!transactionSnapshotAvailable) {
				return db
					.prepare(
						`INSERT INTO transaksi_kasir (
							id, cabang_id, buku_kas_id, produk_id, nama_kustom,
							jumlah, nominal, harga, transaction_id, created_at, updated_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(
						item.id,
						branch,
						item.buku_kas_id,
						item.produk_id,
						item.nama_kustom,
						item.jumlah,
						item.nominal,
						item.harga,
						item.transaction_id,
						createdAt,
						createdAt
					);
			}
			return db
				.prepare(
					`INSERT INTO transaksi_kasir (
						id, cabang_id, buku_kas_id, produk_id, nama_kustom,
						jumlah, nominal, harga, nama_produk, harga_dasar, total_tambahan,
						snapshot_tambahan, gula, es, catatan, snapshot_hpp, nominal_hpp,
						transaction_id, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					item.id,
					branch,
					item.buku_kas_id,
					item.produk_id,
					item.nama_kustom,
					item.jumlah,
					item.nominal,
					item.harga,
					item.product_name,
					item.harga_dasar,
					item.total_tambahan,
					item.snapshot_tambahan,
					item.gula,
					item.es,
					item.catatan,
					item.snapshot_hpp,
					item.nominal_hpp,
					item.transaction_id,
					createdAt,
					createdAt
				);
		}),

		// [CATATAN]: ── ringkasan_penjualan_harian + penjualan_produk_harian ──────────────
		...(salesSummaryAvailable
			? [
					db
						.prepare(
							`INSERT INTO ringkasan_penjualan_harian (
								id, cabang_id, tanggal_penjualan, jumlah_transaksi, jumlah_item,
								penjualan_kotor, penjualan_tunai, penjualan_nontunai, total_hpp, created_at, updated_at
							)
							VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
							ON CONFLICT(cabang_id, tanggal_penjualan) DO UPDATE SET
								jumlah_transaksi = jumlah_transaksi + 1,
								jumlah_item = jumlah_item + excluded.jumlah_item,
								penjualan_kotor = penjualan_kotor + excluded.penjualan_kotor,
								penjualan_tunai = penjualan_tunai + excluded.penjualan_tunai,
								penjualan_nontunai = penjualan_nontunai + excluded.penjualan_nontunai,
								total_hpp = total_hpp + excluded.total_hpp,
								updated_at = excluded.updated_at`
						)
						.bind(
							`${branch}:${salesDate}`,
							branch,
							salesDate,
							totalQty,
							totalAmount,
							paymentMethod === 'tunai' ? totalAmount : 0,
							paymentMethod === 'non-tunai' ? totalAmount : 0,
							totalHpp,
							createdAt,
							createdAt
						),
					...Array.from(productSummaries.entries()).map(([productId, summary]) =>
						db
							.prepare(
								`INSERT INTO penjualan_produk_harian (
									id, cabang_id, tanggal_penjualan, produk_id, nama_produk, jumlah,
									penjualan_kotor, penjualan_tunai, penjualan_nontunai, jumlah_transaksi, created_at, updated_at
								)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
								ON CONFLICT(cabang_id, tanggal_penjualan, produk_id) DO UPDATE SET
									nama_produk = excluded.nama_produk,
									jumlah = jumlah + excluded.jumlah,
									penjualan_kotor = penjualan_kotor + excluded.penjualan_kotor,
									penjualan_tunai = penjualan_tunai + excluded.penjualan_tunai,
									penjualan_nontunai = penjualan_nontunai + excluded.penjualan_nontunai,
									jumlah_transaksi = jumlah_transaksi + excluded.jumlah_transaksi,
									updated_at = excluded.updated_at`
							)
							.bind(
								`${branch}:${salesDate}:${productId}`,
								branch,
								salesDate,
								productId,
								summary.productName,
								summary.jumlah,
								summary.grossSales,
								paymentMethod === 'tunai' ? summary.grossSales : 0,
								paymentMethod === 'tunai' ? 0 : summary.grossSales,
								summary.transactionCount,
								createdAt,
								createdAt
							)
					)
				]
			: [])
	];
}
