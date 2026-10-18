import assert from 'node:assert/strict';
import test from 'node:test';
import {
	extractBranchFromProductImageKey,
	isPublicProductImageKey
} from '../src/lib/server/r2ObjectPolicy.ts';
import {
	buildRollbackSql,
	buildUpdateSql,
	migrate,
	parseArgs,
	planMigration,
	targetKey
} from './migrate-supabase-images.mjs';

const HOST = 'https://qmlzwklzahcfigjpoavz.supabase.co/storage/v1/object/public/gambar-menu';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);

const row = (id, cabang_id, name) => ({ id, cabang_id, gambar: `${HOST}/${name}` });

/** D1 + R2 + Supabase tiruan; execSql menafsirkan UPDATE compare-and-swap yang dihasilkan skrip. */
function harness({ rows, images, corruptReadback = false }) {
	const calls = [];
	const store = new Map();
	const state = structuredClone(rows);
	const UPDATE =
		/^UPDATE produk SET gambar = '((?:[^']|'')*)' WHERE id = '((?:[^']|'')*)' AND cabang_id = '((?:[^']|'')*)' AND gambar = '((?:[^']|'')*)';$/;
	const unquote = (value) => value.replaceAll("''", "'");
	const deps = {
		queryRows(binding) {
			calls.push(['queryRows', binding]);
			return (state[binding] ?? []).filter((r) => String(r.gambar).startsWith('http'));
		},
		async fetchImage(url) {
			calls.push(['fetchImage', url]);
			const bytes = images[url];
			if (!bytes) throw new Error(`Unduh gagal: ${url}`);
			return bytes;
		},
		putObject(key, bytes, mime) {
			calls.push(['putObject', key, mime]);
			store.set(key, bytes);
		},
		getObject(key) {
			calls.push(['getObject', key]);
			return corruptReadback ? new Uint8Array([0]) : store.get(key);
		},
		writeBackup(changes, rollback) {
			calls.push(['writeBackup', changes.length, Object.keys(rollback)]);
			return ['backup.json'];
		},
		execSql(binding, sql) {
			calls.push(['execSql', binding]);
			for (const line of sql.split('\n')) {
				const match = UPDATE.exec(line);
				assert.ok(match, `SQL bukan UPDATE terjaga: ${line}`);
				const [, to, id, branch, from] = match.map((part, i) => (i ? unquote(part) : part));
				const target = state[binding].find(
					(r) => r.id === id && r.cabang_id === branch && r.gambar === from
				);
				if (target) target.gambar = to;
			}
		}
	};
	return { deps, calls, state, store };
}

const names = (calls) => calls.map((call) => call[0]);

test('parseArgs: dry-run lokal secara default, konflik dan argumen asing ditolak', () => {
	assert.deepEqual(parseArgs([]), {
		apply: false,
		live: false,
		config: 'wrangler.pages.jsonc',
		bucket: 'zatiaras-assets'
	});
	assert.equal(parseArgs(['--apply', '--live']).live, true);
	assert.throws(() => parseArgs(['--apply', '--dry-run']), /bertentangan/);
	assert.throws(() => parseArgs(['--live', '--local']), /bertentangan/);
	assert.throws(() => parseArgs(['--apply', '--apply']), /duplikat/);
	assert.throws(() => parseArgs(['--hapus']), /tidak diizinkan/);
	assert.throws(() => parseArgs(['--bucket']), /wajib bernilai/);
});

test('planMigration: hanya host Supabase, id aman, cabang sesuai shard', () => {
	const entries = planMigration({
		DB_SAMARINDA_GROUP: [row('p1', 'samarinda', 'a.jpg'), row('p2', 'samarinda2', 'a.jpg')],
		DB_BALIKPAPAN_GROUP: []
	});
	assert.deepEqual(
		entries.map((e) => [e.binding, e.id, e.branch]),
		[
			['DB_SAMARINDA_GROUP', 'p1', 'samarinda'],
			['DB_SAMARINDA_GROUP', 'p2', 'samarinda2']
		]
	);
	assert.throws(
		() =>
			planMigration({
				DB_SAMARINDA_GROUP: [
					{ id: 'p1', cabang_id: 'samarinda', gambar: 'https://evil.example/x.jpg' }
				]
			}),
		/di luar Supabase/
	);
	assert.throws(
		() => planMigration({ DB_SAMARINDA_GROUP: [row("p'1", 'samarinda', 'a.jpg')] }),
		/tidak valid/
	);
	assert.throws(
		() => planMigration({ DB_BERAU_GROUP: [row('p1', 'samarinda', 'a.jpg')] }),
		/tidak valid/
	);
});

test('targetKey: deterministik, lolos kebijakan kunci, terisolasi per cabang', () => {
	const url = `${HOST}/a.jpg`;
	const key = targetKey('samarinda', url, 'image/jpeg');
	assert.equal(key, targetKey('samarinda', url, 'image/jpeg'));
	assert.ok(isPublicProductImageKey(key));
	assert.equal(extractBranchFromProductImageKey(key), 'samarinda');
	assert.ok(key.endsWith('.jpg'));
	assert.notEqual(key, targetKey('samarinda2', url, 'image/jpeg'));
	assert.ok(isPublicProductImageKey(targetKey('berau', url, 'image/webp')));
});

test('SQL: compare-and-swap pada nilai lama, kutip digandakan, rollback adalah kebalikannya', () => {
	const change = { id: "p'1", branch: 'samarinda', url: "old'url", path: '/api/upload?key=k' };
	assert.equal(
		buildUpdateSql([change]),
		"UPDATE produk SET gambar = '/api/upload?key=k' WHERE id = 'p''1' AND cabang_id = 'samarinda' AND gambar = 'old''url';"
	);
	assert.equal(
		buildRollbackSql([change]),
		"UPDATE produk SET gambar = 'old''url' WHERE id = 'p''1' AND cabang_id = 'samarinda' AND gambar = '/api/upload?key=k';"
	);
});

const fixtureRows = () => ({
	DB_SAMARINDA_GROUP: [
		row('p1', 'samarinda', 'a.png'),
		row('p2', 'samarinda2', 'a.png'),
		row('p3', 'samarinda', 'b.jpg')
	],
	DB_BALIKPAPAN_GROUP: [{ id: 'p9', cabang_id: 'balikpapan', gambar: '/api/upload?key=sudah-r2' }],
	DB_BERAU_GROUP: []
});
const fixtureImages = () => ({ [`${HOST}/a.png`]: PNG, [`${HOST}/b.jpg`]: JPEG });

test('dry-run: mengunduh dan memeriksa, tetapi tidak menulis R2, backup, maupun D1', async () => {
	const { deps, calls, state } = harness({ rows: fixtureRows(), images: fixtureImages() });
	const result = await migrate({ apply: false }, deps);

	assert.equal(result.applied, false);
	assert.equal(result.changes.length, 3);
	for (const forbidden of ['putObject', 'getObject', 'writeBackup', 'execSql'])
		assert.ok(!names(calls).includes(forbidden), `${forbidden} tidak boleh jalan di dry-run`);
	assert.equal(state.DB_SAMARINDA_GROUP[0].gambar, `${HOST}/a.png`);
	// Gambar yang sama dipakai dua cabang: diunduh sekali.
	assert.equal(calls.filter((c) => c[0] === 'fetchImage' && c[1].endsWith('a.png')).length, 1);
});

test('apply: unggah+verifikasi semua objek, backup sebelum D1, lalu baca ulang bersih', async () => {
	const { deps, calls, state, store } = harness({ rows: fixtureRows(), images: fixtureImages() });
	const result = await migrate({ apply: true }, deps);

	assert.equal(result.remaining, 0);
	assert.equal(store.size, 3, 'tiap (cabang, gambar) menjadi satu objek');
	const order = names(calls);
	const lastVerify = order.lastIndexOf('getObject');
	assert.ok(lastVerify < order.indexOf('writeBackup'), 'verifikasi R2 selesai sebelum backup');
	assert.ok(order.indexOf('writeBackup') < order.indexOf('execSql'), 'backup sebelum UPDATE D1');
	assert.deepEqual(
		calls.find((c) => c[0] === 'writeBackup')[2],
		['DB_SAMARINDA_GROUP'],
		'hanya shard yang berubah mendapat SQL rollback'
	);
	for (const r of state.DB_SAMARINDA_GROUP) {
		assert.match(r.gambar, /^\/api\/upload\?key=produk%2F(samarinda2?)%2F[0-9a-f-]+\.(png|jpg)$/);
	}
	assert.equal(state.DB_BALIKPAPAN_GROUP[0].gambar, '/api/upload?key=sudah-r2');
});

test('apply: readback R2 tidak cocok menghentikan semuanya sebelum backup dan D1', async () => {
	const { deps, calls, state } = harness({
		rows: fixtureRows(),
		images: fixtureImages(),
		corruptReadback: true
	});
	await assert.rejects(migrate({ apply: true }, deps), /Verifikasi readback R2 gagal/);
	assert.ok(!names(calls).includes('writeBackup'));
	assert.ok(!names(calls).includes('execSql'));
	assert.equal(state.DB_SAMARINDA_GROUP[0].gambar, `${HOST}/a.png`);
});

test('isi bukan gambar menghentikan migrasi sebelum satu pun objek ditulis', async () => {
	const { deps, calls } = harness({
		rows: fixtureRows(),
		images: { [`${HOST}/a.png`]: PNG, [`${HOST}/b.jpg`]: new TextEncoder().encode('<html>') }
	});
	await assert.rejects(migrate({ apply: true }, deps), /bukan gambar/);
	assert.ok(!names(calls).includes('putObject'));
	assert.ok(!names(calls).includes('execSql'));
});

test('unduhan gagal menghentikan migrasi sebelum menulis apa pun', async () => {
	const { deps, calls } = harness({ rows: fixtureRows(), images: { [`${HOST}/a.png`]: PNG } });
	await assert.rejects(migrate({ apply: true }, deps), /Unduh gagal/);
	assert.ok(!names(calls).includes('putObject'));
});

test('baris yang diedit bersamaan tidak ditimpa dan dilaporkan sebagai sisa', async () => {
	const { deps, state } = harness({ rows: fixtureRows(), images: fixtureImages() });
	const original = deps.execSql;
	deps.execSql = (binding, sql) => {
		state.DB_SAMARINDA_GROUP[2].gambar = `${HOST}/diedit-pengguna.jpg`;
		original(binding, sql);
	};
	const result = await migrate({ apply: true }, deps);
	assert.equal(result.remaining, 1);
	assert.equal(state.DB_SAMARINDA_GROUP[2].gambar, `${HOST}/diedit-pengguna.jpg`);
});

test('tanpa gambar Supabase: tidak ada yang dilakukan', async () => {
	const { deps, calls } = harness({
		rows: { DB_SAMARINDA_GROUP: [], DB_BALIKPAPAN_GROUP: [], DB_BERAU_GROUP: [] },
		images: {}
	});
	const result = await migrate({ apply: true }, deps);
	assert.deepEqual(result.changes, []);
	assert.deepEqual([...new Set(names(calls))], ['queryRows']);
});
