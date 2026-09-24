import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import { GET as CATALOG_GET } from '../routes/api/pos/catalog/+server';
import { createTestD1 } from './helpers/testD1';

const { db, close } = await createTestD1();
const branch = branchContext('samarinda');

function session() {
	return {
		id: 'session-kasir',
		userId: 'kasir-1',
		username: 'kasir',
		role: 'kasir',
		branch: 'samarinda',
		createdAt: 0,
		expiresAt: Date.now() + 60_000,
		unlockedPages: [],
		unlockExpiresAt: 0
	};
}

try {
	// Tanpa signing key: katalog menolak 503 dengan pesan Indonesia.
	await assert.rejects(
		(async () =>
			CATALOG_GET({
				platform: { env: { DB_SAMARINDA_GROUP: db } },
				locals: { authSession: session() }
			} as unknown as Parameters<typeof CATALOG_GET>[0]))(),
		(error: { status?: number }) => error.status === 503
	);

	// Dengan signing key: katalog 200 walau database kosong.
	const ok = (await CATALOG_GET({
		platform: {
			env: {
				DB_SAMARINDA_GROUP: db,
				POS_PRICE_SIGNING_KEY: '0123456789abcdef0123456789abcdef'
			}
		},
		locals: { authSession: session() }
	} as unknown as Parameters<typeof CATALOG_GET>[0])) as Response;
	assert.equal(ok.status, 200);
	const payload = (await ok.json()) as { branch?: string };
	assert.equal(payload.branch, branch);

	console.log('signing-key-tests: missing key 503, present key 200 passed');
} finally {
	await close();
}
