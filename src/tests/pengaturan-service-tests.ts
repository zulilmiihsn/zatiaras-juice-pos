import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import {
	getPengaturanForBranch,
	insertPengaturanRowsForBranch,
	updatePengaturanRowForBranch
} from '../lib/server/services/pengaturanService';
import { createTestD1 } from './helpers/testD1';

// Cabang tanpa baris pengaturan utama (mis. cabang baru): halaman Pengaturan Printer
// mengirim insert tanpa id. Server wajib membuat id agar detail struk tersimpan.
const branch = branchContext('samarinda');
const session = {
	id: 's-owner',
	userId: 'user-owner',
	username: 'pemilik',
	role: 'pemilik' as const,
	branch: 'samarinda' as const,
	createdAt: 0,
	expiresAt: Date.now() + 60_000,
	unlockedPages: [] as string[],
	unlockExpiresAt: 0
};

{
	const { db, close } = await createTestD1();
	try {
		const platform = { env: { DB_SAMARINDA_GROUP: db } } as never;
		const result = await insertPengaturanRowsForBranch(platform, branch, session as never, [
			{ nama_toko: 'Zatiaras Berau', alamat: 'Jl. Pemuda', telepon: '', instagram: '', ucapan: '' }
		]);
		const newId = (result.data[0] as { id?: string }).id;
		assert.ok(newId, 'insert harus mengembalikan id yang dibuat server');

		const [row] = await getPengaturanForBranch(platform, branch);
		assert.equal(row?.id, newId);
		assert.equal(row?.nama_toko, 'Zatiaras Berau');
		assert.equal(row?.kunci, null);

		// Simpan berikutnya memakai id itu lewat PATCH.
		await updatePengaturanRowForBranch(platform, branch, session as never, newId!, {
			alamat: 'Jl. Ahmad Yani'
		});
		const [updated] = await getPengaturanForBranch(platform, branch);
		assert.equal(updated?.alamat, 'Jl. Ahmad Yani');

		// id dari klien tidak dipakai; satu baris utama per cabang tetap dijaga index unik.
		await assert.rejects(
			insertPengaturanRowsForBranch(platform, branch, session as never, [
				{ id: 'dari-klien', nama_toko: 'Duplikat' }
			]),
			(err: unknown) => (err as { status?: number }).status === 409
		);
	} finally {
		await close();
	}
}

console.log('pengaturan-service-tests: ok');
