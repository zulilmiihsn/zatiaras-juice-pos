import type { BranchContext } from '../branchResolver';
import { recordErrorEvent } from '../observability';
import type { CheckoutSession, IngredientDeductions, StockDeductions } from './types';
import { CheckoutUseCaseError } from './utils';

interface KnownFailure {
	/** Dicocokkan ke pesan error D1/trigger; urutan entri menentukan pemenang bila lebih dari satu cocok. */
	pattern: RegExp;
	status: number;
	message: string;
	/** Potongan stok yang ikut dicatat ke log operasional untuk kegagalan stok. */
	logDeductions?: 'stockDeductions' | 'ingredientDeductions';
}

const KNOWN_FAILURES: KnownFailure[] = [
	{
		pattern: /no such table:\s*(?:main\.)?audit_log_outbox/i,
		status: 503,
		message: 'Skema audit belum tersedia di cabang ini. Minta pemilik menerapkan migrasi 0018.'
	},
	{
		pattern: /no such table:\s*(?:main\.)?antrean_notification_events/i,
		status: 503,
		message:
			'Skema notifikasi Antrean belum tersedia di cabang ini. Minta pemilik menerapkan migrasi 0037.'
	},
	{
		pattern: /TRANSACTION_VOIDED/,
		status: 409,
		message: 'Transaksi sudah dibatalkan (void). Buat transaksi baru.'
	},
	{
		pattern: /STOCK_POLICY_CONFLICT/,
		status: 412,
		message: 'Pengaturan stok berubah. Muat ulang lalu konfirmasi transaksi kembali.'
	},
	{
		pattern: /STOCK_REVIEW_NOT_APPROVED/,
		status: 428,
		message: 'Transaksi offline melewati perubahan kebijakan stok dan perlu ditinjau pemilik'
	},
	{
		pattern: /INSUFFICIENT_STOCK/,
		status: 409,
		message: 'Stok tidak cukup untuk salah satu item',
		logDeductions: 'stockDeductions'
	},
	{
		pattern: /INSUFFICIENT_INGREDIENT/,
		status: 409,
		message: 'Stok bahan tidak cukup untuk salah satu menu',
		logDeductions: 'ingredientDeductions'
	}
];

/**
 * Menerjemahkan kegagalan `db.batch` checkout ke error terkontrol. Kegagalan yang tidak
 * dikenal dicatat sebagai 500 dan dilempar ulang apa adanya.
 */
export async function failCheckoutCommit(
	error: unknown,
	context: {
		platform: App.Platform | undefined;
		branch: BranchContext;
		session: CheckoutSession;
		idempotencyKey: string;
		totalAmount: number;
		totalQty: number;
		stockDeductions: StockDeductions;
		ingredientDeductions: IngredientDeductions;
	}
): Promise<never> {
	const { platform, branch, session, idempotencyKey } = context;
	const message = error instanceof Error ? error.message : String(error);
	const known = KNOWN_FAILURES.find((failure) => failure.pattern.test(message));

	if (!known) {
		await recordErrorEvent(platform, branch, {
			source: 'POST /api/pos/transaction',
			error,
			status: 500,
			session,
			context: { idempotencyKey, totalAmount: context.totalAmount, totalQty: context.totalQty }
		});
		throw error;
	}

	if (known.logDeductions) {
		await recordErrorEvent(platform, branch, {
			source: 'POST /api/pos/transaction',
			error,
			status: known.status,
			session,
			context: {
				idempotencyKey,
				[known.logDeductions]: Object.fromEntries(context[known.logDeductions])
			}
		});
	}
	throw new CheckoutUseCaseError(known.status, known.message);
}
