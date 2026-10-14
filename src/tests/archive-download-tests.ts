import assert from 'node:assert/strict';
import { GET } from '../routes/api/archive/download/+server';
import { POST } from '../routes/api/archive/+server';
import { createTestD1 } from './helpers/testD1';

// Unduhan dari identitas job terverifikasi, bukan key arbitrer.
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
						text: async () => {
							throw new Error('Whole-object text buffering is forbidden');
						},
						body: new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(new TextEncoder().encode(text));
								controller.close();
							}
						}),
						arrayBuffer: async () => {
							throw new Error('Whole-object buffering is forbidden');
						}
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

	for (const getObject of [
		async () => ({ text: async () => '' }),
		async () => {
			throw new Error('R2_GET_INJECTED');
		}
	]) {
		const unreadable = await Promise.resolve(
			get('job-ok', {
				...owner(),
				platform: { env: { ...platform(db).env, STORAGE: { get: getObject } } }
			})
		).catch((error: { status?: number }) => error);
		assert.equal(
			unreadable.status,
			502,
			'Missing stream or failed R2 get is never a successful download'
		);
	}

	// Objek hilang sesudah finalize: 502, bukan label sukses.
	const gone = await Promise.resolve(get('job-hilang', owner())).catch(
		(e: { status?: number }) => e
	);
	assert.equal(gone instanceof Response ? gone.status : gone.status, 502);

	const beforeReads = (
		await db.prepare('SELECT * FROM archive_jobs ORDER BY id').all()
	).results.map((row) => ({ ...row }));
	const streamEvent = (body: ReadableStream<Uint8Array>) => ({
		...owner(),
		platform: {
			env: {
				...platform(db).env,
				STORAGE: {
					get: async () => ({
						body,
						text: async () => {
							throw new Error('No materialization');
						}
					})
				}
			}
		}
	});
	let held: ReadableStreamDefaultController<Uint8Array> | undefined;
	const source = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				held = controller;
				controller.enqueue(new TextEncoder().encode('first'));
			}
		},
		{ highWaterMark: 0 }
	);
	const delayed = (await get('job-ok', streamEvent(source))) as Response;
	assert.equal(delayed.status, 200, 'Headers return before the producer releases its tail');
	assert.equal(delayed.body, source, 'R2 stream passes through without materialization');
	const reader = delayed.body!.getReader();
	assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
	held!.enqueue(new TextEncoder().encode('tail'));
	held!.close();
	assert.equal(new TextDecoder().decode((await reader.read()).value), 'tail');
	assert.equal((await reader.read()).done, true);
	let cancelled = false;
	const cancelSource = new ReadableStream<Uint8Array>(
		{
			cancel() {
				cancelled = true;
			}
		},
		{ highWaterMark: 0 }
	);
	const cancelResponse = (await get('job-ok', streamEvent(cancelSource))) as Response;
	await cancelResponse.body!.cancel('client disconnected');
	assert.equal(cancelled, true, 'Client cancellation reaches the R2 body');
	let failureController: ReadableStreamDefaultController<Uint8Array> | undefined;
	const failureSource = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				failureController = controller;
			}
		},
		{ highWaterMark: 0 }
	);
	const failing = (await get('job-ok', streamEvent(failureSource))) as Response;
	failureController!.error(new Error('R2_READ_INJECTED'));
	await assert.rejects(failing.text(), /R2_READ_INJECTED/);
	assert.equal(
		await ((await get('job-ok', owner())) as Response).text(),
		'{"arsip":1}',
		'A later download retry succeeds'
	);
	assert.deepEqual(
		(await db.prepare('SELECT * FROM archive_jobs ORDER BY id').all()).results.map((row) => ({
			...row
		})),
		beforeReads,
		'Read/error/cancel/retry never rewrites archive jobs'
	);

	// The unfinished-job negative fixture must not own the new writer's branch lease.
	await db.prepare("DELETE FROM archive_jobs WHERE id='job-jalan'").run();
	await db
		.prepare(
			`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar)
		VALUES('fresh-meta','samarinda','2024-06-01T02:00:00.000Z','catat','in','pendapatan_usaha',1234,'tunai')`
		)
		.run();
	const stored = new Map<string, string>();
	const archiveEvent = {
		...owner(),
		request: new Request('https://test.invalid/api/archive', {
			method: 'POST',
			body: JSON.stringify({ before_year: 2025 })
		}),
		platform: {
			env: {
				...platform(db).env,
				STORAGE: {
					async put(key: string, value: string) {
						stored.set(key, value);
					},
					async get(key: string) {
						const text = stored.get(key);
						return text === undefined
							? null
							: {
									text: async () => text,
									body: new ReadableStream<Uint8Array>({
										start(c) {
											c.enqueue(new TextEncoder().encode(text));
											c.close();
										}
									})
								};
					}
				}
			}
		}
	};
	const fresh = await POST(archiveEvent as unknown as Parameters<typeof POST>[0]);
	assert.equal(fresh.status, 200);
	const metadata = (await fresh.json()) as { job_id: string; parts: Array<{ jobId: string }> };
	assert.equal(
		Object.hasOwn(metadata, 'content'),
		false,
		'Fresh single-part POST is metadata-only'
	);
	assert.equal(metadata.parts.length, 1);
	const downloaded = (await get(metadata.job_id, archiveEvent)) as Response;
	assert.equal(downloaded.status, 200);
	assert.equal(
		await downloaded.text(),
		[...stored.values()][0],
		'Canonical download preserves committed bytes'
	);

	console.log(
		'archive-download-tests: fresh metadata-only/canonical download + streamed bytes/backpressure/cancel/read-error/retry/auth/branch/traversal/missing passed'
	);
} finally {
	await close();
}
