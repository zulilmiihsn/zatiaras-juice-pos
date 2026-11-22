// Test-only entry: seed-closed simulates an already reconciled branch, never a public route.
import type {
	D1Database,
	DurableObjectNamespace,
	DurableObjectState,
	Request as WorkerRequest
} from '@cloudflare/workers-types';
import {
	getBranchDbBinding,
	type BranchContext,
	type BranchDbBinding
} from '../../src/lib/server/branchResolver';
import { recordCoordinatedSale } from '../../src/lib/server/checkout/coordinatedSale';
import { CheckoutDomainError } from '../../src/lib/server/checkout/utils';
import { signPosPricingToken } from '../../src/lib/server/posPricingToken';
import {
	acknowledgeKioskProjection,
	peekKioskProjection
} from '../../src/lib/server/kioskProjectionQueue';
import { seedKioskOrderHandoff } from '../../src/lib/server/kioskOrderHandoff';
import { formatDateYmdWita } from '../../src/lib/utils/dateTime';
import { KIOSK_CATALOG_KEY, KIOSK_CATALOG_RETRY_KEY } from '../../src/lib/server/kioskCatalog';
import { hashPin } from '../../src/lib/server/pinHash';
import { openCoordinatedShift } from '../../src/lib/server/coordinatedShift';

import { RealtimeDurableObject } from '../../src/lib/server/cashierRealtimeHub';

export class ShiftFixture {
	constructor(
		private ctx: DurableObjectState,
		private env: Partial<Record<BranchDbBinding, D1Database>>
	) {}
	async fetch(req: Request) {
		if (new URL(req.url).pathname.endsWith('/seed-closed')) {
			await this.ctx.storage.put('shift:active', null);
			return Response.json(true);
		}
		if (new URL(req.url).pathname.endsWith('/seed-unlocked')) {
			await this.ctx.storage.put('shift:open-policy', 'unlocked');
			return Response.json(true);
		}
		const [, branchName, actionName] = new URL(req.url).pathname.split('/');
		const branch = branchName as BranchContext;
		if (actionName === 'seed-numbering')
			return Response.json(
				await seedKioskOrderHandoff(
					this.ctx.storage,
					{
						date: formatDateYmdWita(new Date()),
						lastNumber: await req.json()
					},
					{
						mode: 'tracked',
						products: [
							{
								id: 'juice',
								remaining: 7,
								recipe: [
									{ ingredientId: 'fruit', amount: 1, porsi: 'reguler' },
									{ ingredientId: 'fruit', amount: 2, porsi: 'jumbo' }
								]
							}
						],
						ingredients: [
							{ id: 'fruit', remaining: 8 },
							{ id: 'gel', remaining: 1 }
						],
						addOns: [{ id: 'jelly', usage: { ingredientId: 'gel', amount: 1 } }]
					}
				)
			);
		if (actionName === 'fixture-catalog') {
			const snapshot = await this.ctx.storage.get<{ expires_at: string }>(KIOSK_CATALOG_KEY);
			const expiresAt = await req.json<string | null>();
			if (snapshot && expiresAt) {
				snapshot.expires_at = expiresAt;
				await this.ctx.storage.put(KIOSK_CATALOG_KEY, snapshot);
			}
			return Response.json(snapshot?.expires_at ?? null);
		}
		if (actionName === 'fixture-catalog-retry-now') {
			await this.ctx.storage.delete(KIOSK_CATALOG_RETRY_KEY);
			return Response.json(true);
		}
		if (actionName === 'fixture-pin-hash') return Response.json(await hashPin(await req.json()));
		if (actionName === 'quota') {
			await this.ctx.storage.put('fixture:quota', await req.json());
			return Response.json(true);
		}
		if (
			actionName === 'project' ||
			actionName === 'project-aged' ||
			actionName === 'handoff' ||
			actionName === 'initialize' ||
			actionName === 'activate' ||
			actionName === 'rollback'
		) {
			const quota = await this.ctx.storage.get<string>('fixture:quota');
			const binding = getBranchDbBinding(branch);
			const d1 = this.env[binding];
			const db =
				quota && d1
					? {
							prepare(sql: string) {
								if (quota === 'read' || !/^\s*SELECT\b/i.test(sql))
									throw new Error(`D1_ERROR: daily ${quota} limit exceeded`);
								return d1.prepare(sql);
							}
						}
					: d1;
			const hub = new RealtimeDurableObject(
				this.ctx as unknown as ConstructorParameters<typeof RealtimeDurableObject>[0],
				{
					[binding]: db,
					KIOSK_PROJECTION_BRANCHES: 'samarinda,balikpapan,berau',
					KIOSK_PRODUCTION_PILOT: actionName === 'project-aged' ? '' : 'samarinda,balikpapan,berau',
					POS_PRICE_SIGNING_KEY: await this.ctx.storage.get('fixture:price-key')
				}
			);
			const clock = Date.now;
			if (actionName === 'project-aged') Date.now = () => clock() + 4 * 24 * 60 * 60 * 1000;
			try {
				return await hub.fetch(
					new Request(
						'https://cashier.internal/projection/' +
							(actionName === 'project' || actionName === 'project-aged'
								? 'drain'
								: actionName === 'initialize'
									? 'initialize'
									: actionName === 'activate'
										? 'activate-production'
										: actionName === 'rollback'
											? 'rollback-production'
											: 'prepare-numbering'),
						{
							method: 'POST',
							body: JSON.stringify({ branch })
						}
					)
				);
			} catch (error) {
				return Response.json({
					failed: true,
					error: error instanceof Error ? error.message : 'Unknown'
				});
			} finally {
				Date.now = clock;
			}
		}
		if (actionName === 'projection-peek')
			return Response.json(await peekKioskProjection(this.ctx.storage));
		if (actionName === 'projection-ack')
			return Response.json(await acknowledgeKioskProjection(this.ctx.storage, await req.json()));
		if (actionName === 'sale' || actionName === 'sale-token') {
			const env = { POS_PRICE_SIGNING_KEY: crypto.randomUUID() };
			env.POS_PRICE_SIGNING_KEY = await this.ctx.storage.transaction(async (tx) => {
				const key = await tx.get<string>('fixture:price-key');
				if (key) return key;
				await tx.put('fixture:price-key', env.POS_PRICE_SIGNING_KEY);
				return env.POS_PRICE_SIGNING_KEY;
			});
			const now = Date.now();
			if (actionName === 'sale-token') {
				const product = { id: 'juice', nama: 'Jus', harga: 10000, harga_jumbo: 15000 };
				const extra = { id: 'jelly', nama: 'Jeli', harga: 2000 };
				const extraToken = await signPosPricingToken(env, {
					branch,
					kind: 'catalog_add_on',
					data: extra,
					ttlMs: 60000,
					now
				});
				const token = await signPosPricingToken(env, {
					branch,
					kind: 'catalog_product',
					data: product,
					ttlMs: 60000,
					now
				});
				const catalog = {
					version: 2,
					branch,
					products: [{ ...product, is_active: true, price_token: token, ekstra_ids: ['jelly'] }],
					categories: [],
					addOns: [{ ...extra, is_active: true, price_token: extraToken }],
					fetched_at: new Date(now).toISOString(),
					expires_at: new Date(now + 60000).toISOString(),
					signing_key_id: 'current'
				};
				return Response.json({ token, catalog });
			}
			try {
				return Response.json(
					await recordCoordinatedSale(
						this.ctx.storage,
						{ env },
						branch,
						'fixture-user',
						await req.json(),
						now
					)
				);
			} catch (error) {
				if (!(error instanceof CheckoutDomainError)) throw error;
				return Response.json({ saleError: error.status });
			}
		}
		const action = new URL(req.url).pathname.split('/device/')[1];
		if (action) {
			const hub = new RealtimeDurableObject(
				this.ctx as unknown as ConstructorParameters<typeof RealtimeDurableObject>[0],
				{ POS_PRICE_SIGNING_KEY: await this.ctx.storage.get('fixture:price-key') }
			);
			return hub.fetch(new Request('https://cashier.internal/device/' + action, req));
		}
		const input = await req.json();
		return Response.json(
			await this.ctx.storage.transaction((tx) => openCoordinatedShift(tx, input))
		);
	}
}
export default {
	fetch(req: WorkerRequest, env: { SHIFT: DurableObjectNamespace }) {
		const url = new URL(req.url);
		const branch = url.pathname.split('/')[1];
		const name = url.searchParams.has('recovery') ? `recovery:${branch}` : branch;
		return env.SHIFT.get(env.SHIFT.idFromName(name)).fetch(req);
	}
};
