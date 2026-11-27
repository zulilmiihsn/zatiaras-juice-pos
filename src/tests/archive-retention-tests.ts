import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	previewArchiveRetention,
	verifyArchiveCopy
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
				sha256: createHash('sha256').update(body).digest('hex')
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
