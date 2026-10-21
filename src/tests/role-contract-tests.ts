import assert from 'node:assert/strict';
import { isRedirect, isHttpError } from '@sveltejs/kit';
import { load as loadReport } from '../routes/laporan/+page.server';
import { load as loadArchive } from '../routes/pengaturan/pemilik/arsip/+page.server';
import {
	isKasirRole,
	isOwnerRole,
	isStaffRole,
	normalizeRole,
	VALID_ROLES
} from '../lib/utils/roles';
import { createTestD1 } from './helpers/testD1';
import { createAuthSession, getAuthSession } from '../lib/server/sessionStore';
import { branchContext, normalizeBranch } from '../lib/server/branchResolver';
import { requireAnyRole, requireExactRole, requireSessionBranch } from '../lib/server/apiAuth';

for (const role of ['pemilik', 'kasir', 'admin', 'supervisor']) {
	if (role === 'pemilik') requireExactRole(role, ['pemilik']);
	else
		assert.throws(
			() => requireExactRole(role, ['pemilik']),
			(error) => isHttpError(error, 403)
		);
}
requireExactRole('admin', ['pemilik', 'admin']);
assert.throws(
	() => requireExactRole('pemilik', []),
	(error) => isHttpError(error, 403)
);

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

for (const value of ['__proto__', 'constructor', 'toString']) {
	assert.throws(
		() => normalizeBranch(value),
		(error: unknown) =>
			Boolean(error && typeof error === 'object' && 'status' in error && error.status === 400),
		`Inherited property ${value} is not a branch`
	);
}

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

	type ReadSession = Awaited<ReturnType<typeof getAuthSession>>;
	const reportPage = async (session: ReadSession) =>
		loadReport({ locals: { authSession: session } } as unknown as Parameters<typeof loadReport>[0]);
	const archivePage = async (session: ReadSession) =>
		loadArchive({ locals: { authSession: session } } as unknown as Parameters<
			typeof loadArchive
		>[0]);
	const redirectedTo = (location: string) => (error: unknown) =>
		isRedirect(error) && error.status === 303 && error.location === location;
	await assert.rejects(reportPage(null), redirectedTo('/login?reason=unauthorized'));
	await assert.rejects(archivePage(null), redirectedTo('/login?reason=unauthorized'));

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
		assert.equal(requireSessionBranch({ authSession: reread }), branch);
		assert.equal(requireSessionBranch({ authSession: reread }, 'samarinda'), branch);
		if (role === 'admin') {
			assert.equal(requireSessionBranch({ authSession: reread }, 'berau'), 'berau');
			requireAnyRole(role, []);
		} else {
			assert.throws(
				() => requireSessionBranch({ authSession: reread }, 'berau'),
				(error) => isHttpError(error, 403)
			);
			assert.throws(
				() => requireAnyRole(role, []),
				(error) => isHttpError(error, 403)
			);
		}
		requireAnyRole(role, [role]);
		assert.deepEqual(await reportPage(reread), {});
		if (role === 'pemilik') assert.deepEqual(await archivePage(reread), {});
		else await assert.rejects(archivePage(reread), redirectedTo('/unauthorized'));
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

	await assert.rejects(
		archivePage(await getAuthSession(platform, weird.id)),
		redirectedTo('/login?reason=unauthorized')
	);

	// The actual loader consumes current canonical authority, not the role cached at login.
	await db
		.prepare("UPDATE profil SET role='kasir' WHERE cabang_id='samarinda' AND id='role-pemilik'")
		.run();
	const ownerSession = await db
		.prepare("SELECT id FROM auth_sessions WHERE cabang_id='samarinda' AND user_id='role-pemilik'")
		.first<{ id: string }>();
	assert.ok(ownerSession);
	await assert.rejects(
		archivePage(await getAuthSession(platform, ownerSession.id)),
		redirectedTo('/unauthorized')
	);
	await db
		.prepare("UPDATE auth_sessions SET expires_at=0 WHERE cabang_id='samarinda' AND id=?")
		.bind(ownerSession.id)
		.run();
	await assert.rejects(
		reportPage(await getAuthSession(platform, ownerSession.id)),
		redirectedTo('/login?reason=unauthorized')
	);

	console.log(
		'role-contract-tests: canonical authority + actual page loaders/no-session/owner/kasir/admin/unknown/live-role/expired passed'
	);
} finally {
	await close();
}

// Helper peran UI: admin setara pemilik; nilai tak dikenal ditolak.
for (const [role, owner, kasir, staff] of [
	['pemilik', true, false, true],
	['admin', true, false, true],
	['kasir', false, true, true],
	['supervisor', false, false, false],
	['', false, false, false],
	[null, false, false, false],
	[undefined, false, false, false]
] as const) {
	assert.equal(isOwnerRole(role), owner, `isOwnerRole(${String(role)})`);
	assert.equal(isKasirRole(role), kasir, `isKasirRole(${String(role)})`);
	assert.equal(isStaffRole(role), staff, `isStaffRole(${String(role)})`);
}
