import assert from 'node:assert/strict';
import { GET } from '../routes/api/archive/download/+server';
import { createTestD1 } from './helpers/testD1';

// AUD-040: unduhan dari identitas job terverifikasi, bukan key arbitrer.
const { db, close } = await createTestD1();
try {
	const objects = new Map<string, string>([['arsip/samarinda/2025/f.json', '{"arsip":1}']]);
	const platform = (branchDb: unknown) => ({
		env: {
			DB_SAMARINDA_GROUP: branchDb,
			DB_BALIKPAPAN_GROUP: branchDb,
			DB_BERAU_GROUP: branchDb,
			STORAGE: {
				async get(key: string) {
					if (!objects.has(key)) return null;
					const text = objects.get(key)!;
					return {
						text: async () => text,
						arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer
					};
				}
			}
		}
	});
	const owner = (branch = 'samarinda', role = 'pemilik') => ({
		locals: {
			authSession: {
				id: 's',
				userId: 'u',
				username: 'owner',
				role,
				branch,
				createdAt: 0,
				expiresAt: 9999999999,
				unlockedPages: [],
				unlockExpiresAt: 0
			}
		},
		platform: platform(db)
	});
	const get = (jobId: string, event: Record<string, unknown>) =>
		GET({
			url: new URL(`https://test.invalid/api/archive/download?job_id=${encodeURIComponent(jobId)}`),
			...event
		} as unknown as Parameters<typeof GET>[0]);

	await db.batch(
		[
			`INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,object_key,checksum,counts,created_at,updated_at)
			 VALUES('job-ok','samarinda',2025,'2025-01-01','completed','t',0,'arsip/samarinda/2025/f.json','abc',NULL,'2026-01-01','2026-01-01')`,
			`INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,object_key,checksum,counts,created_at,updated_at)
			 VALUES('job-hilang','samarinda',2025,'2025-01-01','completed','t',0,'arsip/samarinda/2025/gone.json','def',NULL,'2026-01-01','2026-01-01')`,
			`INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,object_key,checksum,counts,created_at,updated_at)
			 VALUES('job-jalan','samarinda',2025,'2025-01-01','uploading','t',9999999999999,'arsip/samarinda/2025/f.json','abc',NULL,'2026-01-01','2026-01-01')`,
			`INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,object_key,checksum,counts,created_at,updated_at)
			 VALUES('job-berau','berau',2025,'2025-01-01','completed','t',0,'arsip/berau/2025/f.json','ghi',NULL,'2026-01-01','2026-01-01')`
		].map((q) => db.prepare(q))
	);

	// Sukses: byte + header tepat.
	const ok = (await get('job-ok', owner())) as Response;
	assert.equal(ok.status, 200);
	assert.equal(await ok.text(), '{"arsip":1}');
	assert.equal(ok.headers.get('Content-Type'), 'application/json');
	assert.ok(String(ok.headers.get('Content-Disposition')).includes('f.json'));
	assert.equal(ok.headers.get('X-Archive-Sha256'), 'abc');
	assert.equal(ok.headers.get('X-Archive-Id'), 'job-ok');

	// Cabang salah, peran salah, job jalan, traversal, kosong.
	const rejectCases: Array<[string, Record<string, unknown>, number]> = [
		['job-berau', owner(), 404],
		['job-ok', owner('samarinda', 'kasir'), 403],
		['job-jalan', owner(), 404],
		['../../etc/passwd', owner(), 404],
		['tidak-ada', owner(), 404],
		['', owner(), 400]
	];
	for (const [jobId, event, status] of rejectCases) {
		const res = (await Promise.resolve(get(jobId, event)).catch((e: { status?: number }) => e)) as
			Response | { status?: number };
		const code = res instanceof Response ? res.status : res.status;
		assert.equal(code, status, jobId);
	}

	// Objek hilang sesudah finalize: 502, bukan label sukses.
	const gone = await Promise.resolve(get('job-hilang', owner())).catch(
		(e: { status?: number }) => e
	);
	assert.equal(gone instanceof Response ? gone.status : gone.status, 502);

	console.log('archive-download-tests: bytes, auth, traversal, hilang passed');
} finally {
	await close();
}
