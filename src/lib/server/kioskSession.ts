import { normalizeBranch, type BranchId } from './branchResolver';
import type { Cookies } from '@sveltejs/kit';

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/;
export function parseKioskSession(id: string | undefined) {
	const parts = id?.split(':');
	if (parts?.length !== 3 || parts[0] !== 'operasional' || !uuid.test(parts[2])) return null;
	try {
		return { branch: normalizeBranch(parts[1]), sid: parts[2] };
	} catch {
		return null;
	}
}

async function requestDevice(
	platform: App.Platform | undefined,
	branch: BranchId,
	cookies: Pick<Cookies, 'get'>,
	action: 'login' | 'session' | 'logout' | 'shift-open' | 'shift-close' | 'sale',
	fields: Record<string, unknown>
) {
	const token = cookies.get('zatiaras_kiosk_' + branch);
	if (!token || !uuid.test(token)) return null;
	const hub = platform?.env.REALTIME_HUB;
	if (!hub) throw new Error('Layanan kios tidak tersedia');
	const res = await hub.get(hub.idFromName('cashier:' + branch)).fetch(
		new Request('https://cashier.internal/device/' + action, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...fields, token, branch })
		})
	);
	if (res.status === 401) return null;
	if (!res.ok) throw new Error('Layanan kios tidak tersedia');
	return (await res.json()) as Record<string, unknown>;
}

export async function openKioskSession(
	platform: App.Platform | undefined,
	cookies: Pick<Cookies, 'get'>,
	body: unknown
) {
	if (
		!body ||
		typeof body !== 'object' ||
		!('branch' in body) ||
		!('username' in body) ||
		typeof body.username !== 'string' ||
		!('password' in body) ||
		typeof body.password !== 'string'
	)
		return null;
	const branch = normalizeBranch(body.branch);
	const result = await requestDevice(platform, branch, cookies, 'login', {
		username: body.username,
		password: body.password
	});
	if (
		result?.ok !== true ||
		typeof result.sid !== 'string' ||
		!uuid.test(result.sid) ||
		typeof result.expiresAt !== 'number' ||
		result.expiresAt <= Date.now()
	)
		return null;
	return { id: `operasional:${branch}:${result.sid}`, expiresAt: result.expiresAt };
}

function decodeShiftStatus(value: unknown) {
	if (typeof value === 'object' && value !== null && 'state' in value) {
		if (
			value.state === 'open' &&
			'id' in value &&
			typeof value.id === 'string' &&
			'openingCash' in value &&
			typeof value.openingCash === 'number' &&
			Number.isSafeInteger(value.openingCash) &&
			value.openingCash >= 0
		)
			return { state: 'open', id: value.id, openingCash: value.openingCash } as const;
		if (
			value.state === 'closed' ||
			value.state === 'policy-blocked' ||
			value.state === 'uninitialized'
		)
			return { state: value.state } as const;
	}
	return { state: 'unknown' } as const;
}

export async function readKioskSession(
	platform: App.Platform | undefined,
	cookies: Pick<Cookies, 'get'>,
	session: NonNullable<ReturnType<typeof parseKioskSession>>
) {
	const data = await requestDevice(platform, session.branch, cookies, 'session', {
		sid: session.sid
	});
	if (
		data?.ok !== true ||
		data.scope !== 'operasional' ||
		typeof data.username !== 'string' ||
		typeof data.userId !== 'string' ||
		typeof data.expiresAt !== 'number' ||
		data.expiresAt <= Date.now()
	)
		return null;
	return {
		username: data.username,
		branch: session.branch,
		expiresAt: data.expiresAt,
		scope: 'operasional' as const,
		shiftStatus: decodeShiftStatus(data.shiftStatus),
		products: decodeKioskProducts(data.products),
		pinRequired: data.pinRequired === true
	};
}
function decodeKioskProducts(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item: unknown) => {
		if (
			!item ||
			typeof item !== 'object' ||
			!('id' in item) ||
			typeof item.id !== 'string' ||
			!('nama' in item) ||
			typeof item.nama !== 'string' ||
			!('harga' in item) ||
			typeof item.harga !== 'number' ||
			!Number.isSafeInteger(item.harga) ||
			item.harga <= 0
		)
			return [];
		const jumbo =
			'hargaJumbo' in item &&
			typeof item.hargaJumbo === 'number' &&
			Number.isSafeInteger(item.hargaJumbo) &&
			item.hargaJumbo > 0
				? item.hargaJumbo
				: null;
		const addOns =
			'addOns' in item && Array.isArray(item.addOns)
				? item.addOns.flatMap((extra: unknown) => {
						if (
							!extra ||
							typeof extra !== 'object' ||
							!('id' in extra) ||
							typeof extra.id !== 'string' ||
							!('nama' in extra) ||
							typeof extra.nama !== 'string' ||
							!('harga' in extra) ||
							typeof extra.harga !== 'number' ||
							!Number.isSafeInteger(extra.harga) ||
							extra.harga < 0
						)
							return [];
						return [{ id: extra.id, nama: extra.nama, harga: extra.harga }];
					})
				: [];
		return [{ id: item.id, nama: item.nama, harga: item.harga, hargaJumbo: jumbo, addOns }];
	});
}

export async function submitKioskSale(
	platform: App.Platform | undefined,
	cookies: Pick<Cookies, 'get'>,
	session: NonNullable<ReturnType<typeof parseKioskSession>>,
	fields: {
		id: string;
		shiftId: string;
		lines: Array<{
			productId: string;
			qty: number;
			unitPrice: number;
			portion: string;
			addOnIds: string[];
		}>;
		cash: number;
		payment: string;
	}
) {
	return requestDevice(platform, session.branch, cookies, 'sale', { ...fields, sid: session.sid });
}

export async function openKioskShift(
	platform: App.Platform | undefined,
	cookies: Pick<Cookies, 'get'>,
	session: NonNullable<ReturnType<typeof parseKioskSession>>,
	id: string,
	openingCash: number,
	pin: unknown
) {
	return requestDevice(platform, session.branch, cookies, 'shift-open', {
		sid: session.sid,
		id,
		openingCash,
		pin
	});
}
export async function closeKioskShift(
	platform: App.Platform | undefined,
	cookies: Pick<Cookies, 'get'>,
	session: NonNullable<ReturnType<typeof parseKioskSession>>,
	id: string,
	pin: unknown
) {
	return requestDevice(platform, session.branch, cookies, 'shift-close', {
		sid: session.sid,
		id,
		pin
	});
}

export async function closeKioskSession(
	platform: App.Platform | undefined,
	cookies: Pick<Cookies, 'get'>,
	session: NonNullable<ReturnType<typeof parseKioskSession>>
) {
	await requestDevice(platform, session.branch, cookies, 'logout', { sid: session.sid });
}
