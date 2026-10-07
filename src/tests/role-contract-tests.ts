import assert from 'node:assert/strict';
import { normalizeRole, VALID_ROLES } from '../lib/utils/roles';
import { createTestD1 } from './helpers/testD1';
import { createAuthSession, getAuthSession } from '../lib/server/sessionStore';
import { branchContext } from '../lib/server/branchResolver';

// Kebijakan kanonik tunggal: tiga role valid, sisanya null.
assert.deepEqual([...VALID_ROLES], ['pemilik', 'kasir', 'admin']);
assert.equal(normalizeRole('pemilik'), 'pemilik');
assert.equal(normalizeRole('kasir'), 'kasir');
assert.equal(normalizeRole('admin'), 'admin');
assert.equal(normalizeRole(' Pemilik '), 'pemilik');
assert.equal(normalizeRole('KASIR'), 'kasir');
assert.equal(normalizeRole('supervisor'), null);
assert.equal(normalizeRole(''), null);
assert.equal(normalizeRole(null), null);
assert.equal(normalizeRole(undefined), null);

const { db, close } = await createTestD1();
try {
	const platform = {
		env: { DB_SAMARINDA_GROUP: db, DB_BALIKPAPAN_GROUP: db, DB_BERAU_GROUP: db }
	} as unknown as App.Platform;
	const branch = branchContext('samarinda');
	async function seedProfil(id: string, role: string) {
		await db
			.prepare(
				`INSERT INTO profil (id, cabang_id, role, username, password) VALUES (?, 'samarinda', ?, ?, 'x')`
			)
			.bind(id, role, id)
			.run();
	}

	// Tiga role valid konsisten: sesi dibuat dan dibaca kembali sama.
	for (const role of ['pemilik', 'kasir', 'admin'] as const) {
		await seedProfil(`role-${role}`, role);
		const created = await createAuthSession(platform, {
			branch,
			userId: `role-${role}`,
			username: `role-${role}`,
			role
		});
		assert.equal(created.role, role);
		const reread = await getAuthSession(platform, created.id);
		assert.equal(reread?.role, role);
	}

	// Unknown fail-closed: sesi tak valid walau baris sesi ada.
	await seedProfil('role-weird', 'supervisor');
	const weird = await createAuthSession(platform, {
		branch,
		userId: 'role-weird',
		username: 'role-weird',
		role: 'supervisor'
	});
	assert.equal(await getAuthSession(platform, weird.id), null);

	console.log('role-contract-tests: kanonik tunggal, unknown fail-closed passed');
} finally {
	await close();
}
