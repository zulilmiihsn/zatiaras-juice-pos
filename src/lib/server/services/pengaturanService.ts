import { and, eq, isNull } from 'drizzle-orm';
import { pengaturan } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
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

	await db.insert(pengaturan).values(
		requestedRows.map((r) => {
			const { kunci: _k, nilai: _n, pajak_config: _p, ...rest } = r as Record<string, unknown>;
			return {
				...rest,
				kunci: null,
				nilai: null,
				cabang_id: branch
			} as typeof pengaturan.$inferInsert;
		})
	);
	await publish(platform, branch, 'pengaturan', 'insert', {
		id: (requestedRows[0] as { id?: string | number })?.id
	});
	await auditDataChange(
		rawDb,
		branch,
		session,
		'pengaturan',
		'insert',
		(requestedRows[0] as { id?: string | number })?.id
	);
	return { ok: true, data: requestedRows };
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
