/**
 * Perintah kulakan atomik: mutasi stok + kas + HPP dalam SATU batch D1.
 *
 * Menggantikan tiga request terpisah di halaman stok (insert bahan_mutasi,
 * insert buku_kas, update bahan) yang bisa gagal parsial. Idempoten via
 * `bahan_mutasi.operation_key` (partial unique per cabang): retry dengan kunci
 * sama hanya mengembalikan snapshot lama bila fingerprint immutable intent cocok.
 *
 * Tidak import SvelteKit. Error domain memakai PurchaseUseCaseError; route
 * memetakan ke kitError.
 */
import { createHash } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from './branchResolver';
import { getRawDb } from './dataApiHelpers';
import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';
import { convertToBaseUnit } from '$lib/utils/unitConversion';
import {
	validateManualLedgerRows,
	validateManualLedgerPatch,
	validateLedgerNominal,
	LedgerValidationError
} from './ledgerValidation';
import { decodeDecimalNumber } from '$lib/utils/currency';
import { loadStockPolicy } from './stockPolicy';
import { auditDataChange, publish } from './dataApiHelpers';

export class PurchaseUseCaseError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'PurchaseUseCaseError';
		this.status = status;
	}
}

function fail(status: number, message: string): never {
	throw new PurchaseUseCaseError(status, message);
}

export interface PurchaseKasInput {
	nominal: unknown;
	metode_bayar: unknown;
	jenis: unknown;
	deskripsi?: unknown;
}

export interface PurchaseHppInput {
	jumlah_beli: unknown;
	biaya_beli: unknown;
}

export interface PurchaseInput {
	bahan_id: unknown;
	arah: unknown;
	jumlah: unknown;
	satuan: unknown;
	catatan?: unknown;
	operation_key: unknown;
	kas?: PurchaseKasInput | null;
	update_hpp: unknown;
	/** HPP eksplisit tanpa kas (jalur parse belanja). Hanya tambah. */
	hpp?: PurchaseHppInput | null;
}

export interface PurchaseResult {
	ok: true;
	duplicate: boolean;
	mutasi_id: string;
	bahan_id: string;
	delta_jumlah: number;
	stok_setelah: number | null;
	kas_id: string | null;
}

type SessionUser = App.Locals['authSession'];

interface BahanRow {
	id: string;
	nama: string | null;
	satuan: string | null;
	isi_per_kemasan: number | null;
	yield_persen: number | null;
	stok_saat_ini: number | null;
}

interface PurchaseIntent {
	bahan_id: string;
	arah: 'tambah' | 'kurang';
	jumlah: number;
	satuan: string;
	catatan: string | null;
	kas: {
		nominal: number;
		metode_bayar: 'tunai' | 'non-tunai';
		jenis: 'beban_usaha' | 'lainnya';
		deskripsi: string | null;
	} | null;
	update_hpp: boolean;
	hpp: { jumlah_beli: number; biaya_beli: number } | null;
}

function intentText(value: unknown, label: string): string | null {
	if (value == null) return null;
	if (typeof value !== 'string') fail(400, `${label} tidak valid`);
	return value.trim() || null;
}

function purchaseQuantity(value: unknown): number {
	const amount = decodeDecimalNumber(value);
	if (amount === null || amount <= 0) fail(400, 'Jumlah harus angka lebih dari 0');
	if (amount > 1e12) fail(400, 'Jumlah melebihi batas wajar');
	return amount;
}

function normalizeIntent(input: PurchaseInput): PurchaseIntent {
	if (typeof input.bahan_id !== 'string' || !input.bahan_id) fail(400, 'Bahan tidak valid');
	if (input.arah !== 'tambah' && input.arah !== 'kurang')
		fail(400, 'Arah harus tambah atau kurang');
	if (typeof input.satuan !== 'string' || !input.satuan.trim())
		fail(400, 'Satuan jumlah tidak valid');
	if (input.update_hpp != null && typeof input.update_hpp !== 'boolean')
		fail(400, 'Pilihan pembaruan HPP tidak valid');
	if ((input.update_hpp === true || input.hpp != null) && input.arah !== 'tambah')
		fail(400, 'Pembaruan HPP hanya untuk kulakan (tambah)');
	let kas: PurchaseIntent['kas'] = null;
	let hpp: PurchaseIntent['hpp'] = null;
	try {
		if (input.kas != null) {
			if (typeof input.kas !== 'object' || Array.isArray(input.kas)) fail(400, 'Kas tidak valid');
			const checked = validateManualLedgerPatch(
				{
					nominal: input.kas.nominal,
					jenis: input.kas.jenis,
					metode_bayar: input.kas.metode_bayar
				},
				{ tipe: 'out', jenis: 'beban_usaha' }
			);
			kas = {
				nominal: checked.nominal as number,
				metode_bayar: checked.metode_bayar as 'tunai' | 'non-tunai',
				jenis: checked.jenis as 'beban_usaha' | 'lainnya',
				deskripsi: intentText(input.kas.deskripsi, 'Deskripsi kas')
			};
		}
		if (input.hpp != null) {
			if (typeof input.hpp !== 'object' || Array.isArray(input.hpp)) fail(400, 'HPP tidak valid');
			hpp = {
				jumlah_beli: purchaseQuantity(input.hpp.jumlah_beli),
				biaya_beli: validateLedgerNominal(input.hpp.biaya_beli)
			};
		}
	} catch (error) {
		if (error instanceof LedgerValidationError) fail(error.status, error.message);
		throw error;
	}
	return {
		bahan_id: input.bahan_id,
		arah: input.arah,
		jumlah: purchaseQuantity(input.jumlah),
		satuan: input.satuan.trim().toLowerCase(),
		catatan: intentText(input.catatan, 'Catatan')?.slice(0, 160) || null,
		kas,
		update_hpp: input.update_hpp === true,
		hpp
	};
}

interface ExistingPurchase {
	id: string;
	bahan_id: string;
	delta_jumlah: number;
	stok_setelah: number | null;
	kas_id: string | null;
	request_fingerprint: string | null;
}

async function findExistingByKey(
	rawDb: D1Database,
	branch: BranchContext,
	operationKey: string
): Promise<ExistingPurchase | null> {
	return rawDb
		.prepare(
			`SELECT id, bahan_id, delta_jumlah, stok_setelah, referensi_id AS kas_id, request_fingerprint
		 FROM bahan_mutasi WHERE cabang_id = ? AND operation_key = ? LIMIT 1`
		)
		.bind(branch, operationKey)
		.first<ExistingPurchase>();
}

function replayPurchase(row: ExistingPurchase, fingerprint: string): PurchaseResult {
	// Histori tanpa intent tidak dapat dibuktikan setara; jangan menebak/backfill atau commit ulang.
	if (!row.request_fingerprint)
		fail(409, 'Kulakan lama belum memiliki fingerprint. Periksa riwayat sebelum melanjutkan.');
	if (row.request_fingerprint !== fingerprint)
		fail(409, 'Kunci kulakan sudah digunakan untuk permintaan berbeda. Periksa riwayat kulakan.');
	return {
		ok: true,
		duplicate: true,
		mutasi_id: row.id,
		bahan_id: row.bahan_id,
		delta_jumlah: row.delta_jumlah,
		stok_setelah: row.stok_setelah,
		kas_id: row.kas_id
	};
}

export async function executePurchase(
	rawDb: D1Database,
	branch: BranchContext,
	session: SessionUser,
	platform: App.Platform | undefined,
	input: PurchaseInput
): Promise<PurchaseResult> {
	const operationKey = typeof input.operation_key === 'string' ? input.operation_key.trim() : '';
	if (operationKey.length < 8) fail(400, 'operation_key tidak valid');
	const intent = normalizeIntent(input);
	// Intent tidak bergantung katalog/unit/yield saat retry. Hasil lama tetap snapshot commit.
	const fingerprint = createHash('sha256')
		.update(JSON.stringify({ version: 1, branch, ...intent }))
		.digest('hex');
	const done = await findExistingByKey(rawDb, branch, operationKey);
	if (done) return replayPurchase(done, fingerprint);
	const bahanId = intent.bahan_id;

	const bahan = (await rawDb
		.prepare(
			`SELECT id, nama, satuan, isi_per_kemasan, yield_persen, stok_saat_ini
			 FROM bahan WHERE cabang_id = ? AND id = ? LIMIT 1`
		)
		.bind(branch as string, bahanId as string)
		.first()) as BahanRow | null;
	if (!bahan) fail(404, 'Bahan tidak ditemukan');

	// Kebijakan stok: mode ignored menolak mutasi manual (alur rekonsiliasi),
	// sama seperti POST /api/bahan-mutasi. Bukan bypass.
	const policy = await loadStockPolicy(rawDb, branch);
	if (policy.mode === 'ignored') {
		fail(409, 'Mutasi stok manual dijeda. Gunakan alur rekonsiliasi untuk menyesuaikan stok.');
	}

	// Konversi otoritatif di server (satuan valid + faktor sama dengan UI).
	const amount = intent.jumlah;
	let baseQty = 0;
	try {
		baseQty = convertToBaseUnit(
			amount,
			intent.satuan,
			bahan.satuan || 'gram',
			Number(bahan.isi_per_kemasan) || 1
		);
	} catch {
		fail(400, 'Satuan jumlah tidak valid untuk bahan ini');
	}
	if (!Number.isFinite(baseQty) || baseQty <= 0) fail(400, 'Jumlah harus lebih dari 0');
	if (baseQty > 1e12) fail(400, 'Jumlah melebihi batas wajar');

	const delta = intent.arah === 'tambah' ? baseQty : -baseQty;
	const catatan =
		intent.catatan ||
		(intent.arah === 'tambah'
			? `Kulakan: ${bahan.nama || bahanId}`
			: `Koreksi: ${bahan.nama || bahanId}`);
	// Kas nol tetap kompatibel sebagai tanpa kas, tetapi tipe/nominal harus valid dahulu.
	const kasNominal = intent.kas?.nominal ?? 0;
	const withKas = intent.kas !== null && kasNominal > 0;
	const explicitHpp = intent.hpp
		? { jumlah: intent.hpp.jumlah_beli, biaya: intent.hpp.biaya_beli }
		: null;

	let kasRow: Record<string, unknown> | null = null;
	if (withKas) {
		const kasInput = intent.kas!;
		const now = new Date().toISOString();
		const kasId = crypto.randomUUID();
		let checked: Record<string, unknown>;
		try {
			[checked] = validateManualLedgerRows([
				{
					id: kasId,
					tipe: 'out',
					jenis: kasInput.jenis,
					sumber: 'stok',
					nominal: kasNominal,
					waktu: now,
					metode_bayar: kasInput.metode_bayar,
					deskripsi: kasInput.deskripsi || catatan
				}
			]);
		} catch (error) {
			if (error instanceof LedgerValidationError) fail(error.status, error.message);
			throw error;
		}
		kasRow = {
			...checked,
			id: kasId,
			cabang_id: branch as string,
			transaction_id: null,
			idempotency_key: `purchase:${operationKey}`,
			id_sesi_toko: null
		};
	}

	// HPP dihitung server dari nominal kas + jumlah dasar + yield (cermin UI),
	// atau dari input HPP eksplisit (jalur parse belanja).
	let hppUpdate: { jumlah: number; biaya: number; satuan: number } | null = null;
	const hppSource =
		intent.update_hpp && withKas ? { jumlah: baseQty, biaya: kasNominal } : explicitHpp;
	if (hppSource) {
		const yieldFactor = Math.min(100, Math.max(1, Number(bahan.yield_persen) || 100)) / 100;
		const netUsable = hppSource.jumlah * yieldFactor;
		hppUpdate = {
			jumlah: hppSource.jumlah,
			biaya: hppSource.biaya,
			satuan: netUsable > 0 ? calculateEffectiveUnitCost(hppSource.biaya, netUsable) : 0
		};
	}

	const now = new Date().toISOString();
	const mutasiId = crypto.randomUUID();
	const statements = [
		hppUpdate
			? rawDb
					.prepare(
						`UPDATE bahan SET stok_saat_ini = COALESCE(stok_saat_ini, 0) + ?,
						 jumlah_beli_terakhir = ?, biaya_beli_terakhir = ?, biaya_per_satuan = ?,
						 updated_at = ? WHERE cabang_id = ? AND id = ?`
					)
					.bind(
						delta,
						hppUpdate.jumlah,
						hppUpdate.biaya,
						hppUpdate.satuan,
						now,
						branch as string,
						bahanId as string
					)
			: rawDb
					.prepare(
						`UPDATE bahan SET stok_saat_ini = COALESCE(stok_saat_ini, 0) + ?, updated_at = ?
						 WHERE cabang_id = ? AND id = ?`
					)
					.bind(delta, now, branch as string, bahanId as string),
		rawDb
			.prepare(
				`INSERT INTO bahan_mutasi (
					id, cabang_id, bahan_id, delta_jumlah, stok_setelah, sumber,
					referensi_id, catatan, dibuat_oleh, operation_key, request_fingerprint, created_at
				) VALUES (
					?, ?, ?, ?,
					(SELECT stok_saat_ini FROM bahan WHERE cabang_id = ? AND id = ?),
					'manual', ?, ?, ?, ?, ?, ?
				)`
			)
			.bind(
				mutasiId,
				branch as string,
				bahanId as string,
				delta,
				branch as string,
				bahanId as string,
				kasRow ? String(kasRow.id) : null,
				catatan,
				(session?.username as string) || (session?.userId as string) || null,
				operationKey,
				fingerprint,
				now
			)
	];
	if (kasRow) {
		statements.push(
			rawDb
				.prepare(
					`INSERT INTO buku_kas (
						id, cabang_id, waktu, sumber, tipe, jenis, nominal, deskripsi,
						metode_bayar, transaction_id, idempotency_key, id_sesi_toko
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					kasRow.id,
					branch as string,
					kasRow.waktu,
					kasRow.sumber,
					kasRow.tipe,
					kasRow.jenis,
					kasRow.nominal,
					kasRow.deskripsi,
					kasRow.metode_bayar,
					kasRow.transaction_id,
					kasRow.idempotency_key,
					kasRow.id_sesi_toko
				)
		);
	}

	try {
		await rawDb.batch(statements);
	} catch (error) {
		// Balapan kirim ganda: kunci sama lolos cek awal, satu pemenang oleh unique index.
		const message = error instanceof Error ? error.message : String(error);
		if (/UNIQUE constraint failed/i.test(message)) {
			const raced = await findExistingByKey(rawDb, branch, operationKey);
			if (raced) return replayPurchase(raced, fingerprint);
		}
		throw error;
	}

	const after = (await rawDb
		.prepare(`SELECT stok_setelah AS stok FROM bahan_mutasi WHERE cabang_id = ? AND id = ? LIMIT 1`)
		.bind(branch, mutasiId)
		.first()) as { stok?: number } | null;

	await publish(platform, branch as string, 'bahan_mutasi', 'insert', { id: mutasiId });
	await publish(platform, branch as string, 'bahan', 'update', { id: bahanId as string });
	if (kasRow) {
		await publish(platform, branch as string, 'buku_kas', 'insert', {
			id: String(kasRow.id)
		});
	}
	await auditDataChange(rawDb, branch as string, session, 'bahan_mutasi', 'purchase', mutasiId, {
		bahan_id: bahanId,
		delta_jumlah: delta,
		kas_id: kasRow ? String(kasRow.id) : null
	});

	return {
		ok: true,
		duplicate: false,
		mutasi_id: mutasiId,
		bahan_id: bahanId as string,
		delta_jumlah: delta,
		stok_setelah: typeof after?.stok === 'number' ? after.stok : null,
		kas_id: kasRow ? String(kasRow.id) : null
	};
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function executePurchaseForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	input: PurchaseInput
): Promise<PurchaseResult> {
	return executePurchase(getRawDb(platform, branch), branch, session, platform, input);
}
