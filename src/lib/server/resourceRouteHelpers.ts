import { error as kitError, json, type RequestHandler } from '@sveltejs/kit';
import { requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import { auditDataChange, getDb, getRawDb, payloadRows, publish } from '$lib/server/dataApiHelpers';
import type { BranchId } from '$lib/server/branchResolver';
import type { RealtimeTable } from '$lib/server/realtimePublisher';
import { parseDataLimit } from '$lib/server/dataPagination';

/**
 * Helper bersama untuk resource routes RESTful (pengganti dispatch /api/data).
 * Dipakai oleh semua route di src/routes/api/<resource>/+server.ts.
 */

/** Body tulis (POST/PATCH/DELETE): mengikuti bentuk lama dbPost({ table, action, payload, where, branch }). */
export type WriteBody = {
	payload?: Record<string, unknown> | Record<string, unknown>[];
	branch?: string;
	where?: {
		id?: string | number;
		ids?: string;
		transaction_id?: string;
		kategori_id?: string | number;
		produk_id?: string | number;
		bahan_id?: string | number;
	};
};

/** Parse body JSON dengan aman (default null bila bukan JSON valid). */
export async function parseBody<T = WriteBody>(request: Request): Promise<T | null> {
	return (await request.json().catch(() => null)) as T | null;
}

/** Ambil `payload` non-kosong dari body, lempar 400 bila absen. */
export function requirePayload(
	body: WriteBody | null
): Record<string, unknown> | Record<string, unknown>[] {
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');
	return body.payload;
}

/**
 * Kunci immutable yang TIDAK boleh diubah lewat UPDATE: identitas baris (`id`) dan
 * scope tenant (`cabang_id`). Tanpa ini, PATCH yang spread payload mentah ke `.set()`
 * memungkinkan mass-assignment — caller bisa memindah baris ke cabang/tenant lain.
 */
const IMMUTABLE_UPDATE_KEYS = ['cabang_id', 'id'] as const;

/**
 * Buang kunci scoping immutable dari payload UPDATE. WAJIB dipakai di semua PATCH
 * sebelum `.set()` agar `cabang_id`/`id` tidak bisa ditimpa caller (lihat P0-3 audit).
 */
export function sanitizeUpdatePayload<T extends Record<string, unknown>>(payload: T): Partial<T> {
	const clean: Record<string, unknown> = { ...payload };
	for (const key of IMMUTABLE_UPDATE_KEYS) delete clean[key];
	return clean as Partial<T>;
}

type ResourceContext = {
	branch: BranchId;
	platform: App.Platform | undefined;
	db: ReturnType<typeof getDb>;
	rawDb: ReturnType<typeof getRawDb>;
	session: NonNullable<App.Locals['authSession']>;
};

type UpdateAudit = {
	action?: string;
	entityId?: string | number | null;
	publishExtra?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
};

type ResourceRouteConfig = {
	resource: RealtimeTable;
	writeRoles?: string[];
	defaultLimit?: number;
	read: (context: ResourceContext, limit: number) => Promise<unknown[]>;
	insert: (context: ResourceContext, rows: Record<string, unknown>[]) => Promise<void>;
	update: (context: ResourceContext, body: WriteBody) => Promise<UpdateAudit | void>;
	remove: (context: ResourceContext, id: string) => Promise<void>;
};

function buildContext(
	platform: App.Platform | undefined,
	locals: App.Locals,
	requestedBranch?: unknown
): ResourceContext {
	const branch = requireSessionBranch(locals, requestedBranch);
	return {
		branch,
		platform,
		db: getDb(platform, branch),
		rawDb: getRawDb(platform, branch),
		session: locals.authSession!
	};
}

/**
 * Factory CRUD resource standar. Variasi domain tetap masuk lewat callback config,
 * sementara auth, tenant scope, realtime publish, dan audit log hanya punya satu implementasi.
 */
export function makeResourceRoute(config: ResourceRouteConfig): {
	GET: RequestHandler;
	POST: RequestHandler;
	PATCH: RequestHandler;
	DELETE: RequestHandler;
} {
	const writeRoles = config.writeRoles ?? ['pemilik'];

	const GET: RequestHandler = async ({ url, platform, locals }) => {
		const context = buildContext(platform, locals, url.searchParams.get('branch'));
		const limit = parseDataLimit(url.searchParams.get('limit'), config.defaultLimit);
		return json(await config.read(context, limit));
	};

	const POST: RequestHandler = async ({ request, platform, locals }) => {
		const context = buildContext(platform, locals);
		requireAnyRole(context.session.role, writeRoles);
		const body = await parseBody<WriteBody>(request);
		const rows = payloadRows(requirePayload(body), context.branch);
		await config.insert(context, rows);
		await publish(context.platform, context.branch, config.resource, 'insert', { id: rows[0]?.id });
		await auditDataChange(
			context.rawDb,
			context.branch,
			context.session,
			config.resource,
			'insert',
			rows[0]?.id,
			{ count: rows.length }
		);
		return json({ ok: true, data: rows });
	};

	const PATCH: RequestHandler = async ({ request, platform, locals }) => {
		const context = buildContext(platform, locals);
		requireAnyRole(context.session.role, writeRoles);
		const body = await parseBody<WriteBody>(request);
		if (!body?.payload || Array.isArray(body.payload)) throw kitError(400, 'Payload tidak valid');
		body.payload = sanitizeUpdatePayload(body.payload);
		const audit = (await config.update(context, body)) ?? {};
		await publish(context.platform, context.branch, config.resource, 'update', audit.publishExtra);
		await auditDataChange(
			context.rawDb,
			context.branch,
			context.session,
			config.resource,
			audit.action || 'update',
			audit.entityId,
			audit.metadata ?? { fields: Object.keys(body.payload) }
		);
		return json({ ok: true });
	};

	const DELETE: RequestHandler = async ({ url, platform, locals }) => {
		const context = buildContext(platform, locals);
		requireAnyRole(context.session.role, writeRoles);
		const id = url.searchParams.get('id');
		if (!id) throw kitError(400, 'id diperlukan');
		await config.remove(context, id);
		await publish(context.platform, context.branch, config.resource, 'delete', { id });
		await auditDataChange(
			context.rawDb,
			context.branch,
			context.session,
			config.resource,
			'delete',
			id
		);
		return json({ ok: true });
	};

	return { GET, POST, PATCH, DELETE };
}
