import { and, eq, isNull } from 'drizzle-orm';
import { pengaturan } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { getDb, getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { sanitizeUpdatePayload } from '$lib/server/resourceRouteHelpers';
import { error as kitError } from '@sveltejs/kit';

export type Database = ReturnType<typeof getDb>;
export type SessionUser = App.Locals['authSession'];

const DETAIL_UPDATE_ALLOW = new Set([
	'nama_toko',
	'alamat',
	'telepon',
	'instagram',
	'ucapan',
	'halaman_terkunci'
]);

function containsPinFields(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return Object.hasOwn(value, 'pin') || Object.hasOwn(value, 'pin_hash');
}

function containsProtectedDetailFields(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return (
		Object.hasOwn(value, 'pin') ||
		Object.hasOwn(value, 'pin_hash') ||
		Object.hasOwn(value, 'kunci') ||
		Object.hasOwn(value, 'nilai') ||
		Object.hasOwn(value, 'pajak_config')
	);
}

/**
 * Mengambil pengaturan cabang toko (1 baris utama per cabang, kunci IS NULL).
 */
export async function getPengaturan(db: Database, branch: string) {
	const rows = await db
		.select()
		.from(pengaturan)
		.where(and(eq(pengaturan.cabang_id, branch), isNull(pengaturan.kunci)))
		.limit(1);
	return rows.map(({ pin, pin_hash, ...row }) => ({
		...row,
		pinConfigured: Boolean(pin_hash || (pin && pin !== '1234'))
	}));
}

/**
 * Menyisipkan pengaturan toko dengan proteksi PIN.
 */
export async function insertPengaturanRows(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	requestedRows: Array<Record<string, unknown>>
) {
	if (requestedRows.some(containsPinFields)) {
		throw kitError(400, 'PIN hanya dapat diubah melalui endpoint keamanan');
	}
	if (requestedRows.some(containsProtectedDetailFields)) {
		throw kitError(400, 'Kolom kunci/nilai/pajak hanya via endpoint khusus');
	}

	// Satu baris utama per cabang (index unik parsial idx_pengaturan_branch_main), jadi hanya
	// baris pertama yang dipakai. Klien (halaman Pengaturan Printer) tidak mengirim id dan
	// kolom id NOT NULL: server yang membuatnya, dan hanya kolom detail yang diterima.
	const clean = sanitizeUpdatePayload(requestedRows[0] ?? {});
	const fields = Object.fromEntries(
		Object.entries(clean).filter(([k, v]) => DETAIL_UPDATE_ALLOW.has(k) && v !== undefined)
	);
	const id = crypto.randomUUID();
	const inserted = await db
		.insert(pengaturan)
		.values({ ...fields, id, cabang_id: branch, kunci: null, nilai: null })
		.onConflictDoNothing()
		.returning({ id: pengaturan.id });
	if (inserted.length === 0) {
		throw kitError(409, 'Pengaturan cabang sudah ada. Muat ulang halaman lalu coba lagi.');
	}

	await publish(platform, branch, 'pengaturan', 'insert', { id });
	await auditDataChange(rawDb, branch, session, 'pengaturan', 'insert', id);
	return { ok: true, data: [{ ...fields, id }] };
}

/**
 * Memperbarui pengaturan toko dengan proteksi PIN.
 * Hanya row utama (kunci IS NULL). 0 row berubah -> 404/409, tanpa publish/audit sukses.
 */
export async function updatePengaturanRow(
	_db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	id: string,
	payload: Record<string, unknown>
) {
	if (containsProtectedDetailFields(payload)) {
		throw kitError(400, 'PIN/kunci/nilai hanya via endpoint khusus');
	}

	const clean = sanitizeUpdatePayload(payload as Record<string, unknown>);
	const fields = Object.entries(clean).filter(
		([k, v]) => DETAIL_UPDATE_ALLOW.has(k) && v !== undefined
	);
	if (fields.length === 0) throw kitError(400, 'Tidak ada field detail valid');

	const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
	const values = fields.map(([, v]) =>
		typeof v === 'object' ? JSON.stringify(v) : (v as unknown)
	);

	const result = (await rawDb
		.prepare(
			`UPDATE pengaturan SET ${setClause}, updated_at = ? WHERE cabang_id = ? AND id = ? AND kunci IS NULL`
		)
		.bind(...values, new Date().toISOString(), branch, String(id))
		.run()) as unknown as { meta?: { changes?: number }; success?: boolean };

	const changes = Number(result?.meta?.changes ?? 0);
	if (!changes) throw kitError(404, 'Pengaturan cabang tidak ditemukan');

	await publish(platform, branch, 'pengaturan', 'update', { id });
	await auditDataChange(rawDb, branch, session, 'pengaturan', 'update', id, {
		fields: fields.map(([k]) => k)
	});
	return { ok: true };
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function getPengaturanForBranch(platform: App.Platform | undefined, branch: BranchContext) {
	return getPengaturan(getDb(platform, branch), branch);
}

export function insertPengaturanRowsForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	requestedRows: Array<Record<string, unknown>>
) {
	return insertPengaturanRows(
		getDb(platform, branch),
		getRawDb(platform, branch),
		branch,
		session,
		platform,
		requestedRows
	);
}

export function updatePengaturanRowForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	id: string,
	payload: Record<string, unknown>
) {
	return updatePengaturanRow(
		getDb(platform, branch),
		getRawDb(platform, branch),
		branch,
		session,
		platform,
		id,
		payload
	);
}
