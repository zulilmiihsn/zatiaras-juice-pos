import {
	closeCoordinatedShift,
	openCoordinatedShift,
	readCoordinatedShift
} from './coordinatedShift';
import type { DurableObjectStorage, SqlStorage } from '@cloudflare/workers-types';
import { branchContext, getD1Database, normalizeBranch } from './branchResolver';
import { isPosCatalogSnapshot } from '$lib/types/posCatalog';
import { recordCoordinatedSale } from './checkout/coordinatedSale';
import { CheckoutDomainError, normalizePaymentMethod } from './checkout/utils';
import {
	KIOSK_CATALOG_KEY,
	readKioskCatalog,
	publishKioskCatalog,
	refreshKioskCatalogIfDue
} from './kioskCatalog';
import { authorizeKioskShift, KIOSK_SHIFT_PIN } from './kioskShiftPin';
import { buildKioskCatalog } from './prepareKioskCatalog';
import { initializeKioskPilot } from './activateKioskPilot';
import { kioskPilotEnvironment } from './kioskLoginPolicy';
import { rollbackKioskPilot } from './rollbackKioskPilot';
import { initializeKioskShift } from './initializeKioskShift';
import { readKioskInventorySeed } from './kioskInventory';
import { readKioskOrderHandoff, seedKioskOrderHandoff } from './kioskOrderHandoff';
import { drainKioskProjection } from './kioskD1Projection';
import { armKioskProjection } from './kioskProjectionQueue';
import { CoordinatedCashierAuth } from './coordinatedCashierAuth';
import { RealtimeDurableObject as RealtimeHub } from './realtimeDurableObject.js';

/** The worker's public fetch does not forward these operations; only server bindings have access. */
export class RealtimeDurableObject extends RealtimeHub {
	constructor(
		private state: ConstructorParameters<typeof RealtimeHub>[0] & {
			storage: Pick<DurableObjectStorage, 'get' | 'transaction'> & { sql: SqlStorage };
		},
		env: Record<string, unknown>
	) {
		super(state, env);
	}
	private projectionAlarmAt(now: number) {
		return this.env.BRANCH_ACCOUNT_MODE === 'backend' ? now + 5000 : undefined;
	}

	async alarm() {
		if (this.env.BRANCH_ACCOUNT_MODE !== 'backend') return;
		const branch = branchContext(normalizeBranch(this.env.BRANCH_ACCOUNT_IDENTITY));
		if (!kioskPilotEnvironment(this.env, branch)) return;
		const shouldDrain = await this.state.storage.transaction(async (tx) => {
			if (
				(await tx.get('shift:active')) === undefined ||
				(await tx.get('shift:open-policy')) === 'rolled-back'
			)
				return false;
			// Reserve a durable retry before touching D1; retries must survive restarts and quota outages.
			await armKioskProjection(tx, Date.now() + 60000);
			return true;
		});
		if (!shouldDrain) return;
		try {
			await this.drainProjection(branch);
		} catch {
			console.warn('[kiosk-projection] Sinkronisasi tertunda', branch);
			return;
		}
		await this.state.storage.transaction(async (tx) => {
			const tail = (await tx.get<number>('projection:tail')) ?? 0;
			const ack = (await tx.get<number>('projection:ack')) ?? 0;
			// Keep refreshing prices off-shift, but avoid one alarm per minute when the outbox is empty.
			if (tail === ack) await tx.setAlarm(Date.now() + 60 * 60000);
		});
	}

	private async drainProjection(branch: ReturnType<typeof branchContext>) {
		if (kioskPilotEnvironment(this.env, branch)) {
			try {
				await refreshKioskCatalogIfDue(this.state.storage, branch, Date.now(), () =>
					buildKioskCatalog({ env: this.env }, branch)
				);
			} catch {
				// Keep the last valid snapshot and continue draining independently.
				console.warn('[kiosk-catalog] Penyegaran tertunda', branch);
			}
		}
		await drainKioskProjection(this.state.storage, { env: this.env }, branch);
	}

	override async fetch(request: Request) {
		const url = new URL(request.url);
		if (url.origin !== 'https://cashier.internal') return super.fetch(request);
		if (request.method !== 'POST') return new Response(null, { status: 405 });
		const body = await request.json().catch(() => null);
		if (!body || typeof body !== 'object') return new Response(null, { status: 400 });
		const switchPath = /^\/projection\/(activate|rollback)-(staging|production)$/.exec(
			url.pathname
		);
		if (switchPath) {
			const branch = branchContext(normalizeBranch(body.branch));
			const target = switchPath[2] === 'staging' ? 'staging' : 'production';
			if (kioskPilotEnvironment(this.env, branch) !== target)
				return Response.json({ ok: false }, { status: 404 });
			const result =
				switchPath[1] === 'rollback'
					? await rollbackKioskPilot(this.env, this.state.storage, branch)
					: await initializeKioskPilot(this.env, this.state.storage, branch, Date.now(), target);
			if (switchPath[1] === 'activate' && this.env.BRANCH_ACCOUNT_MODE === 'backend')
				await this.state.storage.transaction((tx) =>
					armKioskProjection(tx, Date.now() + 60 * 60000)
				);
			return Response.json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } });
		}
		if (url.pathname === '/projection/prepare-numbering') {
			const branch = branchContext(normalizeBranch(body.branch));
			const seed = await readKioskOrderHandoff(getD1Database(this.env, branch), branch, Date.now());
			const inventory = await readKioskInventorySeed(getD1Database(this.env, branch), branch);
			const handoff = await seedKioskOrderHandoff(this.state.storage, seed, inventory);
			return Response.json({ ok: true, handoff }, { headers: { 'cache-control': 'no-store' } });
		}
		if (url.pathname === '/projection/initialize') {
			const branch = branchContext(normalizeBranch(body.branch));
			const configured = this.env.KIOSK_PROJECTION_BRANCHES;
			if (
				typeof configured !== 'string' ||
				!configured
					.split(',')
					.map((value) => value.trim())
					.includes(branch)
			)
				return Response.json({ ok: false }, { status: 403 });
			const result = await initializeKioskShift(
				getD1Database(this.env, branch),
				this.state.storage,
				branch,
				Date.now()
			);
			return Response.json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } });
		}
		if (url.pathname === '/projection/drain') {
			const branch = branchContext(normalizeBranch(body.branch));
			await this.drainProjection(branch);
			return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
		}
		if (url.pathname === '/device/refresh-pilot-catalog') {
			const branch = branchContext(normalizeBranch(body.branch));
			if (!kioskPilotEnvironment(this.env, branch))
				return Response.json({ ok: false }, { status: 404 });
			const catalog = await buildKioskCatalog({ env: this.env }, branch);
			const result = await publishKioskCatalog(this.state.storage, branch, catalog, Date.now());
			return Response.json(result, {
				status: result.ok ? 200 : 409,
				headers: { 'cache-control': 'no-store' }
			});
		}
		if (url.pathname === '/device/catalog') {
			const branch = normalizeBranch(body.branch);
			if (kioskPilotEnvironment(this.env, branch))
				return Response.json({ ok: false }, { status: 409 });
			const outcome = await publishKioskCatalog(
				this.state.storage,
				branch,
				body.catalog,
				Date.now()
			);
			return Response.json(outcome, {
				status: outcome.ok ? 200 : 401,
				headers: { 'cache-control': 'no-store' }
			});
		}
		const auth = new CoordinatedCashierAuth(this.state.storage.sql);
		let result;
		switch (url.pathname) {
			case '/device/sale': {
				const identity = await auth.session(body.token, body.sid);
				if (!identity.ok || !('userId' in identity)) {
					result = { ok: false };
					break;
				}
				const branch = branchContext(normalizeBranch(body.branch));
				const now = Date.now();
				try {
					const snapshot = await this.state.storage.get(KIOSK_CATALOG_KEY);
					const products = readKioskCatalog(snapshot, branch, now);
					const selection: unknown[] = Array.isArray(body.lines) ? body.lines : [body];
					if (!selection.length || selection.length > 20)
						throw new CheckoutDomainError(400, 'Jumlah baris pesanan tidak valid');
					let total = 0;
					const items = selection.map((raw) => {
						const line = raw as {
							productId?: unknown;
							qty?: unknown;
							unitPrice?: unknown;
							portion?: unknown;
							addOnIds?: unknown;
						} | null;
						const product = products?.find((p) => p.id === line?.productId);
						if (
							!product ||
							typeof line?.qty !== 'number' ||
							!Number.isInteger(line.qty) ||
							line.qty < 1 ||
							line.qty > 99
						)
							throw new CheckoutDomainError(409, 'Produk atau harga kios belum tersedia.');
						const portion = line.portion ?? 'reguler';
						const ids = line.addOnIds ?? [];
						if (
							(portion !== 'reguler' && portion !== 'jumbo') ||
							!Array.isArray(ids) ||
							ids.length > 10 ||
							new Set(ids).size !== ids.length
						)
							throw new CheckoutDomainError(400, 'Pilihan produk tidak valid');
						const base = portion === 'jumbo' ? product.hargaJumbo : product.harga;
						const extras = ids.map((id) => product.addOns.find((addOn) => addOn.id === id));
						if (base === null || extras.some((extra) => !extra))
							throw new CheckoutDomainError(
								409,
								'Porsi atau tambahan tidak tersedia untuk produk ini'
							);
						const selected = extras.filter((extra) => extra !== undefined);
						const price = base + selected.reduce((sum, extra) => sum + extra.harga, 0);
						if (line.unitPrice !== price)
							throw new CheckoutDomainError(
								409,
								'Harga berubah. Periksa menu dan nominal sebelum menerima pembayaran.'
							);
						total += price * line.qty;
						return {
							product_id: product.id,
							porsi: portion,
							add_on_ids: selected.map((extra) => extra.id),
							add_on_price_tokens: selected.map((extra) => extra.price_token),
							jumlah: line.qty,
							product_price_token: product.price_token
						};
					});
					const payment = normalizePaymentMethod(body.payment);
					const cash = payment === 'non-tunai' ? total : body.cash;
					result = {
						ok: true,
						...(await recordCoordinatedSale(
							this.state.storage,
							{ env: this.env },
							branch,
							identity.userId,
							{
								id: body.id,
								shiftId: body.shiftId,
								payment,
								cash,
								items
							},
							now,
							isPosCatalogSnapshot(snapshot) ? snapshot.stock_policy?.epoch_token : undefined,
							this.projectionAlarmAt(now)
						))
					};
				} catch (error) {
					if (!(error instanceof CheckoutDomainError)) throw error;
					result = { ok: true, status: 'rejected', message: error.message };
				}
				break;
			}
			case '/device/shift-close':
			case '/device/shift-open': {
				const identity = await auth.session(body.token, body.sid);
				if (!identity.ok || !('userId' in identity)) {
					result = { ok: false };
					break;
				}
				const grant = await authorizeKioskShift(this.state.storage, body.pin, Date.now());
				if (!grant) {
					result = {
						ok: true,
						status:
							(await this.state.storage.get('shift:active')) === undefined
								? 'uninitialized'
								: 'policy-blocked'
					};
					break;
				}
				if (url.pathname === '/device/shift-close') {
					const id: unknown = body.id;
					if (typeof id !== 'string' || !/^[-\w]{1,128}$/.test(id))
						return Response.json({ ok: false }, { status: 400 });
					const now = Date.now();
					result = {
						ok: true,
						...(await this.state.storage.transaction(async (tx) => {
							if (
								grant !==
								((await tx.get('shift:open-policy')) === 'unlocked'
									? 'unlocked'
									: await tx.get(KIOSK_SHIFT_PIN))
							)
								return { status: 'policy-blocked' };
							return closeCoordinatedShift(
								tx,
								id,
								identity.userId,
								now,
								this.projectionAlarmAt(now)
							);
						}))
					};
					break;
				}
				if (
					typeof body.id !== 'string' ||
					!/^[\w-]{1,128}$/.test(body.id) ||
					!Number.isSafeInteger(body.openingCash) ||
					body.openingCash < 0
				)
					return Response.json({ ok: false }, { status: 400 });
				const openedAt = Date.now();
				result = {
					ok: true,
					...(await this.state.storage.transaction(async (tx) => {
						if ((await tx.get('shift:active')) === undefined) return { status: 'uninitialized' };
						// No PIN policy proof is not permission to open a drawer.
						if (
							grant !==
							((await tx.get('shift:open-policy')) === 'unlocked'
								? 'unlocked'
								: await tx.get(KIOSK_SHIFT_PIN))
						)
							return { status: 'policy-blocked' };
						return openCoordinatedShift(
							tx,
							{
								id: body.id,
								openingCash: body.openingCash,
								userId: identity.userId,
								openedAt
							},
							this.projectionAlarmAt(openedAt)
						);
					}))
				};
				break;
			}
			case '/device/enroll':
				result = await auth.enroll(body);
				break;
			case '/device/login':
				result = await auth.login(body.token, body.username, body.password);
				break;
			case '/device/session': {
				const identity = await auth.session(body.token, body.sid);
				result = identity;
				if (identity.ok) {
					const shiftStatus = await this.state.storage.transaction(readCoordinatedShift);
					const products =
						body.branch && shiftStatus.state === 'open'
							? readKioskCatalog(
									await this.state.storage.get(KIOSK_CATALOG_KEY),
									normalizeBranch(body.branch),
									Date.now()
								)
							: null;
					result = {
						...identity,
						shiftStatus,
						pinRequired: Boolean(await this.state.storage.get(KIOSK_SHIFT_PIN)),
						products:
							products?.map(({ id, nama, harga, hargaJumbo, addOns }) => ({
								id,
								nama,
								harga,
								hargaJumbo,
								addOns: addOns.map(({ id, nama, harga }) => ({ id, nama, harga }))
							})) ?? []
					};
				}
				break;
			}
			case '/device/logout':
				result = await auth.logout(body.token, body.sid);
				break;
			case '/device/revoke-credential':
				result = auth.revokeCredential(body.userId, body.credentialVersion);
				break;
			case '/device/revoke':
				result = await auth.revoke(body.token);
				break;
			default:
				return new Response(null, { status: 404 });
		}
		return Response.json(result, {
			status: result.ok ? (url.pathname === '/device/enroll' ? 201 : 200) : 401,
			headers: { 'cache-control': 'no-store' }
		});
	}
}
