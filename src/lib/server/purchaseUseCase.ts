/**
 * Perintah kulakan atomik (AUD-006): mutasi stok + kas + HPP dalam SATU batch D1.
 *
 * Menggantikan tiga request terpisah di halaman stok (insert bahan_mutasi,
 * insert buku_kas, update bahan) yang bisa gagal parsial. Idempoten via
 * `bahan_mutasi.operation_key` (partial unique per cabang): retry dengan kunci
 * sama mengembalikan hasil lama tanpa mutasi kedua.
 *
 * Tidak import SvelteKit. Error domain memakai PurchaseUseCaseError; route
 * memetakan ke kitError.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from './branchResolver';
import { getRawDb } from './dataApiHelpers';
import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';
import { convertToBaseUnit } from '$lib/utils/unitConversion';
import { validateManualLedgerRows, LedgerValidationError } from './ledgerValidation';
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

async function findExistingByKey(
	rawDb: D1Database,
	branch: string,
	operationKey: string
): Promise<{ id: string; bahan_id: string; kas_id: string | null } | null> {
	const row = (await rawDb
		.prepare(
			`SELECT m.id AS id, m.bahan_id AS bahan_id,
				(SELECT k.id FROM buku_kas k WHERE k.cabang_id = m.cabang_id AND k.idempotency_key = ? LIMIT 1) AS kas_id
			 FROM bahan_mutasi m WHERE m.cabang_id = ? AND m.operation_key = ? LIMIT 1`
		)
		.bind(`purchase:${operationKey}`, branch, operationKey)
		.first()) as { id?: string; bahan_id?: string; kas_id?: string | null } | null;
	if (!row?.id || !row.bahan_id) return null;
	return { id: row.id, bahan_id: row.bahan_id, kas_id: row.kas_id ?? null };
}

export async function executePurchase(
	rawDb: D1Database,
	branch: BranchContext,
	session: SessionUser,
	platform: App.Platform | undefined,
	input: PurchaseInput
): Promise<PurchaseResult> {
	const bahanId = typeof input.bahan_id === 'string' && input.bahan_id ? input.bahan_id : null;
	if (!bahanId) fail(400, 'Bahan tidak valid');
	if (input.arah !== 'tambah' && input.arah !== 'kurang')
		fail(400, 'Arah harus tambah atau kurang');
	const operationKey = typeof input.operation_key === 'string' ? input.operation_key.trim() : '';
	if (operationKey.length < 8) fail(400, 'operation_key tidak valid');

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
	const amount = Number(input.jumlah);
	let baseQty = 0;
	try {
		baseQty = convertToBaseUnit(
			amount,
			String(input.satuan || ''),
			bahan.satuan || 'gram',
			Number(bahan.isi_per_kemasan) || 1
		);
	} catch {
		fail(400, 'Satuan jumlah tidak valid untuk bahan ini');
	}
	if (!Number.isFinite(baseQty) || baseQty <= 0) fail(400, 'Jumlah harus lebih dari 0');
	if (baseQty > 1e12) fail(400, 'Jumlah melebihi batas wajar');

	const delta = input.arah === 'tambah' ? baseQty : -baseQty;
	const catatanRaw = typeof input.catatan === 'string' ? input.catatan.trim() : '';
	const catatan =
		catatanRaw.slice(0, 160) ||
		(input.arah === 'tambah'
			? `Kulakan: ${bahan.nama || bahanId}`
			: `Koreksi: ${bahan.nama || bahanId}`);

	// Kas opsional: nominal <= 0 berarti tanpa kas (cermin UI). Negatif ditolak.
	const kasNominal = input.kas == null ? 0 : Number(input.kas.nominal);
	if (Number.isFinite(kasNominal) && kasNominal < 0) fail(400, 'Nominal kas tidak boleh negatif');
	const withKas = input.kas != null && Number.isFinite(kasNominal) && kasNominal > 0;
	if (input.update_hpp === true && input.arah !== 'tambah')
		fail(400, 'Pembaruan HPP hanya untuk kulakan (tambah)');
	// Tanpa kas, update_hpp diabaikan (cermin UI: blok HPP bersarang dalam blok kas).
	const hppInput = input.hpp ?? null;
	if (hppInput != null && input.arah !== 'tambah') fail(400, 'HPP eksplisit hanya untuk tambah');
	let explicitHpp: { jumlah: number; biaya: number } | null = null;
	if (hppInput != null) {
		const jumlahBeli = Number(hppInput.jumlah_beli);
		const biayaBeli = Number(hppInput.biaya_beli);
		if (!Number.isFinite(jumlahBeli) || jumlahBeli <= 0) fail(400, 'Jumlah beli HPP tidak valid');
		if (!Number.isFinite(biayaBeli) || biayaBeli < 0) fail(400, 'Biaya beli HPP tidak valid');
		explicitHpp = { jumlah: jumlahBeli, biaya: biayaBeli };
	}

	let kasRow: Record<string, unknown> | null = null;
	if (withKas) {
		const kasInput = input.kas as PurchaseKasInput;
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
					deskripsi:
						typeof kasInput.deskripsi === 'string' && kasInput.deskripsi.trim()
							? kasInput.deskripsi.trim()
							: catatan
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
		input.update_hpp === true && withKas
			? { jumlah: baseQty, biaya: Math.round(kasNominal) }
			: explicitHpp;
	if (hppSource) {
		const yieldFactor = Math.min(100, Math.max(1, Number(bahan.yield_persen) || 100)) / 100;
		const netUsable = hppSource.jumlah * yieldFactor;
		hppUpdate = {
			jumlah: hppSource.jumlah,
			biaya: hppSource.biaya,
			satuan: netUsable > 0 ? calculateEffectiveUnitCost(hppSource.biaya, netUsable) : 0
		};
	}

	const done = await findExistingByKey(rawDb, branch as string, operationKey);
	if (done) {
		return {
			ok: true,
			duplicate: true,
			mutasi_id: done.id,
			bahan_id: done.bahan_id,
			delta_jumlah: delta,
			stok_setelah: null,
			kas_id: done.kas_id
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
					referensi_id, catatan, dibuat_oleh, operation_key, created_at
				) VALUES (
					?, ?, ?, ?,
					(SELECT stok_saat_ini FROM bahan WHERE cabang_id = ? AND id = ?),
					'manual', ?, ?, ?, ?, ?
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
			const raced = await findExistingByKey(rawDb, branch as string, operationKey);
			if (raced) {
				return {
					ok: true,
					duplicate: true,
					mutasi_id: raced.id,
					bahan_id: raced.bahan_id,
					delta_jumlah: delta,
					stok_setelah: null,
					kas_id: raced.kas_id
				};
			}
		}
		throw error;
	}

	const after = (await rawDb
		.prepare(`SELECT stok_saat_ini AS stok FROM bahan WHERE cabang_id = ? AND id = ? LIMIT 1`)
		.bind(branch as string, bahanId as string)
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
