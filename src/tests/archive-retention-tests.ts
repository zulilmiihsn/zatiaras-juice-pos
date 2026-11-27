import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { compareArchiveVersion } from '../../scripts/archive-object-version.mjs';
import { createBranchStorageGateway } from '../lib/server/branchStorageGateway';
import type { BranchId } from '../lib/server/branchResolver';
import {
	previewArchiveRetention,
	verifyArchiveCopy,
	verifyCurrentArchiveCopies
} from '../../scripts/plan-r2-archive-retention';

const verifiedAt = Date.parse('2026-11-27T02:00:00.000Z');
const oneDay = 86400_000;
const archiveId = 'a1b2c3d4-1234-4000-8000-123456789abc';
const archive = {
	meta: {
		schema_version: 4,
		archive_id: archiveId,
		job_id: archiveId,
		branch: 'samarinda',
		before_year: 2026,
		cutoff_wita: '2025-12-31T16:00:00.000Z',
		exported_at: '2026-11-26T01:00:00.000Z',
		counts: { buku_kas: 1, transaksi_kasir: 0 }
	},
	items: [{ id: 'bk-1', transaction_id: null, revision: 0 }],
	buku_kas: [
		{
			id: 'bk-1',
			cabang_id: 'samarinda',
			waktu: '2025-11-01T01:00:00.000Z',
			sumber: 'catat',
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			nominal: 1000,
			metode_bayar: 'tunai'
		}
	],
	transaksi_kasir: []
};

async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), 'zpos-archive-retention-'));
	const body = JSON.stringify(archive);
	const file = join(dir, '000001.bin');
	const path = join(dir, 'manifest.r2.json');
	const data = {
		schema: 'zatiaraspos-r2-backup-v1',
		bucket: 'zatiaras-assets',
		captured_at: '2026-11-27T01:45:00.000Z',
		objects: [
			{
				key: 'arsip/samarinda/2026/arsip-samarinda-sebelum-2026-a1b2c3d4.json',
				file: '000001.bin',
				size: Buffer.byteLength(body),
				sha256: createHash('sha256').update(body).digest('hex'),
				etag: 'synthetic-etag',
				last_modified: '2026-11-26T03:00:00.000Z'
			}
		]
	};
	const save = () => writeFile(path, JSON.stringify(data));
	await save();
	await writeFile(file, body);
	await writeFile(join(dir, 'COMPLETE'), 'verified\n');
	return { dir, path, file, data, save, cleanup: () => rm(dir, { force: true, recursive: true }) };
}

test('24 hours starts at verified copy, and preview never changes or deletes the copy', async () => {
	const f = await fixture();
	try {
		await assert.rejects(previewArchiveRetention(f.path, verifiedAt), /ENOENT/);
		const proof = await verifyArchiveCopy(f.path, verifiedAt);
		assert.equal(proof.verified, 1);
		assert.equal(proof.reviewedAfter, '2026-11-28T02:00:00.000Z');
		assert.equal(
			(await previewArchiveRetention(f.path, verifiedAt + oneDay - 1)).readyForReview,
			false
		);
		const review = await previewArchiveRetention(f.path, verifiedAt + oneDay);
		assert.equal(review.readyForReview, true);
		assert.deepEqual(review.branches, [
			{ branch: 'samarinda', archives: 1 },
			{ branch: 'balikpapan', archives: 0 },
			{ branch: 'berau', archives: 0 }
		]);
		await assert.rejects(verifyArchiveCopy(f.path, verifiedAt + oneDay), { code: 'EEXIST' });
		assert.equal(await readFile(f.file, 'utf8'), JSON.stringify(archive));
	} finally {
		await f.cleanup();
	}
});

test('remote read requires a mature proof and refuses changed versions or bytes', async () => {
	const f = await fixture();
	try {
		await verifyArchiveCopy(f.path, verifiedAt);
		const object = f.data.objects[0];
		const original = {
			key: object.key,
			size: object.size,
			etag: object.etag,
			lastModified: object.last_modified
		};
		const due = verifiedAt + oneDay;
		let metadataCalls = 0;
		const matches = {
			async metadata(key: string) {
				assert.equal(key, object.key);
				metadataCalls++;
				return original;
			},
			async read(key: string, size: number) {
				assert.equal(key, object.key);
				assert.equal(size, object.size);
				return readFile(f.file);
			}
		};
		assert.deepEqual((await verifyCurrentArchiveCopies(f.path, matches, due - 1)).checks, []);
		assert.equal(metadataCalls, 0);
		assert.deepEqual((await verifyCurrentArchiveCopies(f.path, matches, due)).checks, [
			{ branch: 'samarinda', match: 'matched' }
		]);
		assert.equal(metadataCalls, 2);
		let reads = 0;
		const race = {
			...matches,
			async metadata() {
				return ++reads === 1 ? original : { ...original, lastModified: '2026-11-26T03:00:00.001Z' };
			}
		};
		assert.equal((await verifyCurrentArchiveCopies(f.path, race, due)).checks[0].match, 'changed');
		const changed = { ...matches, read: async () => new Uint8Array(object.size) };
		assert.equal(
			(await verifyCurrentArchiveCopies(f.path, changed, due)).checks[0].match,
			'changed'
		);
		assert.equal(
			(await verifyCurrentArchiveCopies(f.path, { ...matches, metadata: async () => null }, due))
				.checks[0].match,
			'missing'
		);
		assert.equal(
			(
				await verifyCurrentArchiveCopies(
					f.path,
					{
						...matches,
						metadata: async () => {
							throw new Error('offline');
						}
					},
					due
				)
			).checks[0].match,
			'unverified'
		);
	} finally {
		await f.cleanup();
	}
});

test('local Workerd R2 rejects an older copy after a synthetic object is overwritten', async () => {
	const fixture = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: '',
			r2Buckets: { ARCHIVE_FIXTURE: 'local-archive-proof' }
		})
	);
	try {
		const bucket = await fixture.getR2Bucket('ARCHIVE_FIXTURE');
		const key = 'arsip/samarinda/2026/arsip-samarinda-sebelum-2026-a1b2c3d4.json';
		const original = JSON.stringify(archive);
		const secrets = new Map<BranchId, string>([
			['samarinda', 's'.repeat(32)],
			['balikpapan', 'b'.repeat(32)],
			['berau', 'r'.repeat(32)]
		]);
		const gateway = createBranchStorageGateway(
			{
				get: async () => {
					throw new Error('Test reads through the bucket fixture directly');
				},
				put: (key, value, options) => bucket.put(key, new Uint8Array(value).buffer, options),
				delete: (key) => bucket.delete(key)
			},
			secrets
		);
		const request = (method: string, body?: string) =>
			gateway(
				new Request(`https://storage.test/object?${new URLSearchParams({ key })}`, {
					method,
					body,
					headers: {
						'content-type': 'application/json',
						'x-storage-secret': secrets.get('samarinda')!
					}
				})
			);
		const writes = await Promise.all([request('PUT', original), request('PUT', original)]);
		assert.deepEqual(writes.map((response) => response.status).sort(), [204, 412]);
		const metadata = async (selected: string) => {
			const o = await bucket.head(selected);
			return o
				? { key: o.key, etag: o.etag, lastModified: o.uploaded.toISOString(), size: o.size }
				: null;
		};
		const captured = await metadata(key);
		assert.ok(captured);
		const reader = {
			metadata,
			async read(selected: string) {
				const o = await bucket.get(selected);
				return o ? new Uint8Array(await o.arrayBuffer()) : null;
			}
		};
		const proof = { ...captured, sha256: createHash('sha256').update(original).digest('hex') };
		assert.equal(await compareArchiveVersion(proof, reader), 'matched');
		const updated = original.replace('1000', '9000');
		const [overwrite, deletion] = await Promise.all([request('PUT', updated), request('DELETE')]);
		assert.equal(overwrite.status, 412);
		assert.equal(deletion.status, 403);
		assert.equal(await compareArchiveVersion(proof, reader), 'matched');
		// Simulate a privileged write outside the relay, which the preview must still reject.
		await bucket.put(key, updated);
		assert.equal(await compareArchiveVersion(proof, reader), 'changed');
	} finally {
		await fixture.dispose();
	}
});

test('removed or corrupted copies invalidate previously verified evidence', async () => {
	const f = await fixture();
	try {
		await verifyArchiveCopy(f.path, verifiedAt);
		await writeFile(f.file, JSON.stringify(archive).replace('1000', '9000'));
		await assert.rejects(previewArchiveRetention(f.path, verifiedAt + oneDay), /Checksum/);
		await rm(f.file);
		await assert.rejects(previewArchiveRetention(f.path, verifiedAt + oneDay), { code: 'ENOENT' });
	} finally {
		await f.cleanup();
	}
});

test('foreign archives, untrusted paths, future proof, and incomplete backups do not qualify', async () => {
	const f = await fixture();
	try {
		const original = f.data.objects[0].key;
		f.data.objects[0].key = 'arsip/berau/2026/arsip-berau-sebelum-2026-a1b2c3d4.json';
		await f.save();
		await assert.rejects(verifyArchiveCopy(f.path, verifiedAt), /identitas arsip/);
		f.data.objects[0].key = original;
		f.data.objects[0].file = '../private.json';
		await f.save();
		await assert.rejects(verifyArchiveCopy(f.path, verifiedAt), /Metadata/);
		f.data.objects[0].file = '000001.bin';
		await f.save();
		await verifyArchiveCopy(f.path, verifiedAt);
		await assert.rejects(previewArchiveRetention(f.path, verifiedAt - 1), /Bukti verifikasi/);
		await writeFile(join(f.dir, 'FAILED.json'), 'failed');
		await assert.rejects(previewArchiveRetention(f.path, verifiedAt + oneDay), /FAILED/);
	} finally {
		await f.cleanup();
	}
});
