import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
	checkDrillDatabase as checkDatabase,
	POS_REQUIRED_COLUMNS,
	captureDrillParity,
	assertDrillParity,
	assertSafeDrillSql,
	main
} from './restore-drill-local.mjs';
import { drillFixtureSql, drillFixtureBaselineOptions } from './test-fixtures/drill-dump.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Reference stays captured before mutations; never derive expectations from a corrupt adapter.
function checkDrillDatabase(adapter, scope = 'full', options = {}) {
	return checkDatabase(adapter, scope, { ...adapter.baselineOptions, ...options });
}

function memAdapter() {
	const db = new DatabaseSync(':memory:');
	return {
		db,
		all: (sql) => db.prepare(sql).all(),
		get: (sql) => db.prepare(sql).get(),
		close: () => db.close()
	};
}
async function withFixture(action, migration) {
	const a = memAdapter();
	try {
		const sql = drillFixtureSql(migration);
		a.db.exec(sql);
		a.baselineOptions = await drillFixtureBaselineOptions(sql, migration, 'DB_SAMARINDA_GROUP', a);
		return await action(a);
	} finally {
		a.close();
	}
}
function injectLegacyCorruption(a, sql) {
	// Historical corrupt rows can predate guards. Restore every trigger before invoking the checker.
	const triggers = a.all(`SELECT name,sql FROM sqlite_master WHERE type='trigger'`);
	try {
		for (const trigger of triggers)
			a.db.exec(`DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`);
		a.db.exec(sql);
	} finally {
		for (const trigger of triggers) a.db.exec(trigger.sql);
	}
}

async function temporaryDump(sql = drillFixtureSql(), referenceOptions) {
	const dir = mkdtempSync(join(tmpdir(), 'zatiaras-drill-cli-test-'));
	const file = join(dir, 'fixture.sql');
	try {
		const options = referenceOptions ?? (await drillFixtureBaselineOptions(sql));
		const baselineFile = join(dir, 'approved-baseline.json');
		writeFileSync(file, sql);
		writeFileSync(baselineFile, options.baseline.text);
		return {
			file,
			baselineFile,
			options,
			args: [
				'--shard',
				options.databaseIdentity.binding,
				'--expect-baseline',
				baselineFile,
				'--expect-baseline-sha256',
				options.baseline.approvedSha256
			],
			close: () => rmSync(dir, { recursive: true, force: true })
		};
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}

await test('backup lengkap PASS dengan seluruh cek', async () =>
	withFixture(async (a) => {
		const report = await checkDrillDatabase(a);
		assert.ok(report.tables.includes('buku_kas'));
		for (const name of [
			'schema',
			'migrasi',
			'integrity_check',
			'quick_check',
			'counter',
			'receipt'
		])
			assert.ok(report.checks.some((c) => c.name === name));
		assert.ok(report.tables.length > 20);
	}));
await test('baseline required: healthy full schema alone cannot certify completeness', async () =>
	withFixture(async (a) => {
		await assert.rejects(checkDatabase(a), /baseline.*wajib/);
	}));
await test('expected baseline catches missing legacy detail even when domain checks stay valid', async () =>
	withFixture(async (a) => {
		a.db.exec("DELETE FROM transaksi_kasir WHERE id='tk1'");
		await assert.rejects(checkDrillDatabase(a), /baseline.*counts\/field hashes/);
	}));
await test('actual SQLite CLI rejects absent approved baseline, not PASS a schema-only certification', async () => {
	const fixture = await temporaryDump();
	try {
		const result = spawnSync(
			process.execPath,
			['scripts/restore-drill-local.mjs', '--file', fixture.file],
			{ encoding: 'utf8', timeout: 30000 }
		);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /baseline.*wajib/);
		assert.doesNotMatch(result.stdout, /PASS restore/);
	} finally {
		fixture.close();
	}
});

function changedBaseline(options, mutate) {
	const baseline = JSON.parse(options.baseline.text);
	mutate(baseline);
	const text = JSON.stringify(baseline);
	return {
		...options,
		baseline: { text, approvedSha256: createHash('sha256').update(text).digest('hex') }
	};
}
await test('API cannot self-certify a fabricated database ID by copying it into expected identity', async () =>
	withFixture(async (a) => {
		const options = changedBaseline(a.baselineOptions, (baseline) => {
			baseline.database.id = '00000000-0000-4000-8000-000000000000';
		});
		options.databaseIdentity = {
			...options.databaseIdentity,
			id: '00000000-0000-4000-8000-000000000000'
		};
		await assert.rejects(checkDatabase(a, 'full', options), /baseline.*identity/);
	}));
await test('approved inventory validates every count/hash and binds schema/source/identity', async () =>
	withFixture(async (a) => {
		for (const [mutate, message] of [
			[
				(b) => {
					b.tables.transaksi_kasir.count--;
				},
				/counts\/field hashes/
			],
			[
				(b) => {
					b.tables.buku_kas.sha256 = '0'.repeat(64);
				},
				/counts\/field hashes/
			],
			[
				(b) => {
					b.tables.buku_kas.count = true;
				},
				/count\/hash inventory/
			],
			[
				(b) => {
					delete b.tables.buku_kas;
				},
				/inventory tabel wajib/
			],
			[
				(b) => {
					b.tables.ghost = { count: 0, sha256: '0'.repeat(64) };
				},
				/counts\/field hashes/
			],
			[
				(b) => {
					b.database.name = 'wrong-name';
				},
				/identity/
			],
			[
				(b) => {
					b.database.binding = 'DB_BERAU_GROUP';
				},
				/identity/
			],
			[
				(b) => {
					b.migration = '0040_profil_unique_username.sql';
				},
				/migration/
			],
			[
				(b) => {
					b.source.bytes++;
				},
				/bytes\/SHA/
			],
			[
				(b) => {
					b.source.sha256 = '0'.repeat(64);
				},
				/bytes\/SHA/
			]
		])
			await assert.rejects(
				checkDatabase(a, 'full', changedBaseline(a.baselineOptions, mutate)),
				message
			);
		await assert.rejects(
			checkDatabase(a, 'full', {
				...a.baselineOptions,
				baseline: { ...a.baselineOptions.baseline, text: a.baselineOptions.baseline.text + ' ' }
			}),
			/SHA-256 baseline/
		);
		assert.equal((await checkDrillDatabase(a)).baselineVerified, true);
	}));

await test('dump mainan satu tabel GAGAL', async () => {
	const a = memAdapter();
	try {
		a.db.exec(`CREATE TABLE buku_kas(id TEXT);`);
		await assert.rejects(checkDrillDatabase(a), /tabel aplikasi hilang/);
	} finally {
		a.close();
	}
});
await test('dua tabel POS lengkap tetap dump parsial dan harus ditolak', async () => {
	const a = memAdapter();
	try {
		a.db.exec(
			`CREATE TABLE buku_kas(id TEXT PRIMARY KEY, cabang_id TEXT, waktu TEXT, sumber TEXT, tipe TEXT, jenis TEXT, nominal REAL, metode_bayar TEXT, receipt_snapshot TEXT, nomor_harian INTEGER, tanggal_nomor TEXT); CREATE TABLE transaksi_kasir(id TEXT PRIMARY KEY, cabang_id TEXT, buku_kas_id TEXT, jumlah INTEGER, nominal REAL);`
		);
		await assert.rejects(checkDrillDatabase(a), /schema/);
	} finally {
		a.close();
	}
});
await test('kolom POS hilang GAGAL', async () =>
	withFixture(async (a) => {
		a.db.exec(
			`CREATE TABLE bk_new AS SELECT id,cabang_id FROM buku_kas; DROP TABLE buku_kas; ALTER TABLE bk_new RENAME TO buku_kas;`
		);
		await assert.rejects(checkDrillDatabase(a), /kolom hilang/);
	}));
await test('detail yatim GAGAL', async () =>
	withFixture(async (a) => {
		a.db.exec(
			`INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,jumlah,nominal) VALUES('tk-yatim','samarinda','tidak-ada',1,5000);`
		);
		await assert.rejects(checkDrillDatabase(a), /yatim/);
	}));
await test('parent cabang lain tidak menyembunyikan detail yatim', async () =>
	withFixture(async (a) => {
		a.db.exec(
			`INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,jumlah,nominal) VALUES('tk-cross','berau','bk1',1,5000);`
		);
		await assert.rejects(checkDrillDatabase(a), /yatim/);
	}));
await test('stok negatif GAGAL', async () =>
	withFixture(async (a) => {
		assert.throws(
			() => a.db.exec(`UPDATE bahan SET stok_saat_ini=-1 WHERE id='b1';`),
			/INSUFFICIENT_INGREDIENT/
		);
		injectLegacyCorruption(a, `UPDATE bahan SET stok_saat_ini=-1 WHERE id='b1';`);
		await assert.rejects(checkDrillDatabase(a), /negatif/);
	}));
await test('pasangan nomor tak lengkap GAGAL', async () =>
	withFixture(async (a) => {
		const sql = `INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar,nomor_harian,stock_policy_mode,stock_policy_revision) VALUES('bk3','samarinda','2025-01-03T00:00:00Z','pos','in','pendapatan_usaha',5000,'tunai',9,'tracked',0);`;
		assert.throws(() => a.db.exec(sql), /INVALID_NOMOR_HARIAN/);
		injectLegacyCorruption(a, sql);
		await assert.rejects(checkDrillDatabase(a), /pasangan nomor|nomor-pair/);
	}));
await test('counter tertinggal GAGAL', async () =>
	withFixture(async (a) => {
		a.db.exec('UPDATE pos_nomor_harian SET terakhir=1;');
		await assert.rejects(checkDrillDatabase(a), /counter hilang\/tertinggal/);
	}));
await test('counter hilang GAGAL', async () =>
	withFixture(async (a) => {
		a.db.exec('DELETE FROM pos_nomor_harian;');
		await assert.rejects(checkDrillDatabase(a), /counter hilang\/tertinggal/);
	}));
await test('schema tanpa index unik dan ledger migrasi tidak dapat PASS', async () => {
	await withFixture(async (a) => {
		const { name } = a.get(
			`SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL LIMIT 1`
		);
		a.db.exec(`DROP INDEX "${name}";`);
		await assert.rejects(checkDrillDatabase(a), /definisi\/constraint/);
	});
	await withFixture(async (a) => {
		a.db.exec('DELETE FROM d1_migrations WHERE id=(SELECT MAX(id) FROM d1_migrations);');
		await assert.rejects(checkDrillDatabase(a), /ledger tidak cocok/);
	});
});
await test('receipt JSON null atau total berbeda GAGAL, NULL SQL legacy tetap sah', async () => {
	for (const value of ['null', '{}'])
		await withFixture(async (a) => {
			a.db.prepare(`UPDATE buku_kas SET receipt_snapshot=? WHERE id='bk2'`).run(value);
			await assert.rejects(checkDrillDatabase(a), /Snapshot struk/);
		});
	await withFixture(async (a) => {
		a.db.exec(`UPDATE buku_kas SET nominal=21000 WHERE id='bk2';`);
		await assert.rejects(checkDrillDatabase(a), /Snapshot struk.*totals/);
	});
});
await test('SQL dump juga tunduk preflight bisnis canonical, bukan hanya schema/parity', async () => {
	for (const [field, value] of [
		['created_at', 'not-a-date'],
		['jumlah', 'not-a-quantity']
	])
		await withFixture(async (a) => {
			a.db.prepare(`UPDATE buku_kas SET ${field}=? WHERE id='bk2'`).run(value);
			await assert.rejects(checkDrillDatabase(a), /business.*tidak valid/);
		});
});

await test('SQL financial relationships menolak baris valid sendiri tetapi set POS tidak konsisten', async () => {
	for (const sql of [
		`DELETE FROM transaksi_kasir WHERE id='tk2';`,
		`UPDATE transaksi_kasir SET jumlah=3,nominal=30000 WHERE id='tk2';`,
		`UPDATE transaksi_kasir SET jumlah=1,harga=20000,harga_dasar=20000 WHERE id='tk2';`,
		`UPDATE transaksi_kasir SET nama_produk='Bukan fixture' WHERE id='tk2';`
	])
		await withFixture(async (a) => {
			a.db.exec(sql);
			await assert.rejects(checkDrillDatabase(a), /relationships.*tidak cocok/);
		});
});
await test('CLI rejects corrupt financial source before starting even disposable D1', async () => {
	const fixture = await temporaryDump(
		drillFixtureSql() + `\nUPDATE transaksi_kasir SET jumlah=3,nominal=30000 WHERE id='tk2';`
	);
	let started = false;
	try {
		await assert.rejects(
			main(['--file', fixture.file, ...fixture.args, '--d1'], {
				getPlatformProxy: async () => {
					started = true;
					throw new Error('must-not-start');
				}
			}),
			/relationships/
		);
		assert.equal(started, false);
	} finally {
		fixture.close();
	}
});

await test('CLI baseline/source trust anchors reject before creating any database or proxy', async () => {
	const fixture = await temporaryDump();
	try {
		writeFileSync(fixture.file, drillFixtureSql() + '\n-- changed source bytes');
		let created = false;
		await assert.rejects(
			main(['--file', fixture.file, ...fixture.args, '--d1'], {
				createDatabase: () => {
					created = true;
					throw new Error('must-not-create');
				}
			}),
			/baseline.*bytes\/SHA/
		);
		assert.equal(created, false);
		writeFileSync(fixture.file, drillFixtureSql());
		writeFileSync(fixture.baselineFile, fixture.options.baseline.text + ' ');
		await assert.rejects(
			main(['--file', fixture.file, ...fixture.args], {
				createDatabase: () => {
					created = true;
					throw new Error('must-not-create');
				}
			}),
			/SHA-256 baseline/
		);
		assert.equal(created, false);
	} finally {
		fixture.close();
	}
});
await test('actual CLI rejects missing legacy row even with newly approved source byte digest', async () => {
	const sql = drillFixtureSql() + "\nDELETE FROM transaksi_kasir WHERE id='tk1';";
	const fixture = await temporaryDump(sql); // inventory remains from the independent complete fixture
	try {
		const result = spawnSync(
			process.execPath,
			['scripts/restore-drill-local.mjs', '--file', fixture.file, ...fixture.args],
			{ encoding: 'utf8', timeout: 30000 }
		);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /baseline.*counts\/field hashes/);
		assert.doesNotMatch(result.stdout, /PASS restore/);
	} finally {
		fixture.close();
	}
});

await test('checker menerima adapter async yang dipakai CLI D1', async () =>
	withFixture(async (a) => {
		const report = await checkDrillDatabase(
			{
				all: async (sql) => a.all(sql),
				get: async (sql) => a.get(sql)
			},
			'full',
			a.baselineOptions
		);
		assert.ok(report.checks.some((c) => c.name === 'counter'));
	}));
await test('parity seluruh field mendeteksi perubahan nominal meskipun count sama', async () =>
	withFixture(async (a) => {
		const before = await captureDrillParity(a);
		assertDrillParity(before, await captureDrillParity(a));
		a.db.exec(
			`UPDATE buku_kas SET nominal=50000 WHERE id='bk1'; UPDATE transaksi_kasir SET nominal=50000,harga=25000,harga_dasar=25000 WHERE id='tk1';`
		);
		await assert.rejects(checkDrillDatabase(a), /baseline.*counts\/field hashes/);
		assert.throws(() => assertDrillParity(before, {}), /parity/);
		const after = await captureDrillParity(a);
		assert.equal(after.buku_kas.count, before.buku_kas.count);
		assert.notEqual(after.buku_kas.sha256, before.buku_kas.sha256);
		assert.throws(() => assertDrillParity(before, after), /parity/);
	}));
await test('target historis harus eksplisit dan ledger tepat, bukan upgrade diam-diam', async () =>
	withFixture(async (a) => {
		await assert.rejects(
			checkDrillDatabase(a),
			/DRILL FAIL schema: tabel aplikasi hilang: archive_restore_jobs/
		);
		const report = await checkDrillDatabase(a, 'full', {
			expectedMigration: '0040_profil_unique_username.sql'
		});
		assert.equal(report.target, '0040_profil_unique_username.sql');
	}, '0040_profil_unique_username.sql'));
await test('dump tidak boleh ATTACH/VACUUM file; kata dalam catatan tetap sah', () => {
	assert.throws(() => assertSafeDrillSql(`ATTACH DATABASE 'external.db' AS external;`), /safety/);
	assert.throws(() => assertSafeDrillSql(`VACUUM INTO 'external.db';`), /safety/);
	assert.doesNotThrow(() =>
		assertSafeDrillSql(`INSERT INTO note VALUES('Please ATTACH an invoice'); -- VACUUM`)
	);
});
await test('kontrak kolom POS diturunkan dari migrasi aktual', () => {
	assert.ok(POS_REQUIRED_COLUMNS.buku_kas.includes('receipt_snapshot'));
	assert.ok(POS_REQUIRED_COLUMNS.transaksi_kasir.includes('buku_kas_id'));
});
await test('CLI --d1 asli memuat dump lengkap lalu menjalankan checker dan parity', async () => {
	const fixture = await temporaryDump();
	try {
		const result = spawnSync(
			process.execPath,
			['scripts/restore-drill-local.mjs', '--file', fixture.file, ...fixture.args, '--d1'],
			{ encoding: 'utf8', timeout: 120000 }
		);
		assert.equal(result.status, 0, result.stderr + result.stdout);
		assert.match(result.stdout, /PASS.*workerd D1/);
		assert.match(result.stdout, /parity/);
	} finally {
		fixture.close();
	}
});
await test('actual D1 baseline parity covers blob bytes and deterministic inventory key order', async () =>
	withFixture(async (a) => {
		const extra =
			"CREATE TABLE baseline_blob(id INTEGER PRIMARY KEY,payload BLOB); INSERT INTO baseline_blob VALUES(1,X'00FF7A');";
		a.db.exec(extra);
		const sql = drillFixtureSql() + '\n' + extra;
		const reference = await drillFixtureBaselineOptions(sql, undefined, 'DB_SAMARINDA_GROUP', a);
		const reordered = changedBaseline(reference, (baseline) => {
			baseline.tables = Object.fromEntries(Object.entries(baseline.tables).reverse());
		});
		const fixture = await temporaryDump(sql, reordered);
		try {
			const report = await main(['--file', fixture.file, ...fixture.args, '--d1']);
			assert.equal(report.baselineVerified, true);
			assert.ok(report.tables.includes('baseline_blob'));
			assert.ok(report.checks.some((check) => check.name === 'baseline'));
		} finally {
			fixture.close();
		}
	}));

await test('actual workerd checker rejects post-copy financial/completeness/hash corruption and disposes owned proxy', async () => {
	for (const [corruption, message] of [
		[
			"UPDATE transaksi_kasir SET jumlah=3,nominal=30000 WHERE id='tk2'",
			/relationships.*tidak cocok/
		],
		["DELETE FROM transaksi_kasir WHERE id='tk1'", /baseline.*counts\/field hashes/],
		[
			"UPDATE buku_kas SET deskripsi='changed field, unchanged counts' WHERE id='bk1'",
			/baseline.*counts\/field hashes/
		]
	]) {
		const fixture = await temporaryDump();
		let disposed = false,
			corrupted = false;
		try {
			await assert.rejects(
				main(['--file', fixture.file, ...fixture.args, '--d1'], {
					getPlatformProxy: async (options) => {
						const { getPlatformProxy } = await import('wrangler');
						const proxy = await getPlatformProxy(options);
						const db = proxy.env.DB_SAMARINDA_GROUP;
						return {
							env: {
								DB_SAMARINDA_GROUP: {
									batch: (statements) => db.batch(statements),
									prepare: (sql) => {
										const statement = db.prepare(sql);
										if (
											sql.startsWith("SELECT name FROM sqlite_master WHERE type='table'") &&
											!corrupted
										) {
											return {
												all: async () => {
													await db.prepare(corruption).run();
													corrupted = true;
													return statement.all();
												}
											};
										}
										return statement;
									}
								}
							},
							dispose: async () => {
								disposed = true;
								await proxy.dispose();
							}
						};
					}
				}),
				message
			);
			assert.equal(
				corrupted,
				true,
				'Must commit the corrupt row in actual disposable workerd, not mock a response'
			);
			assert.equal(disposed, true);
		} finally {
			fixture.close();
		}
	}
});

await test('failure saat copy maupun startup tetap menutup resources milik run', async () => {
	for (const stage of ['startup', 'copy']) {
		const fixture = await temporaryDump();
		const database = new DatabaseSync(':memory:');
		let disposed = false;
		try {
			await assert.rejects(
				main(['--file', fixture.file, ...fixture.args, '--d1'], {
					createDatabase: () => database,
					getPlatformProxy: async () => {
						if (stage === 'startup') throw new Error('fixture-startup-failure');
						return {
							env: {
								DB_SAMARINDA_GROUP: {
									prepare: () => {
										throw new Error('fixture-copy-failure');
									}
								}
							},
							dispose: async () => {
								disposed = true;
							}
						};
					}
				}),
				/fixture-(startup|copy)-failure/
			);
			assert.equal(disposed, stage === 'copy');
			assert.throws(() => database.prepare('SELECT 1'), /not open|closed/i);
		} finally {
			fixture.close();
		}
	}
});

await test('CLI flag remote ditolak sebelum membuat adapter', async () => {
	await assert.rejects(main(['--remote']), /Argumen tidak diizinkan/);
});
await test('workerd D1 menegakkan FK yang dideklarasikan', async () => {
	const { getPlatformProxy } = await import('wrangler');
	const proxy = await getPlatformProxy({ configPath: 'wrangler.pages.jsonc', persist: false });
	try {
		const db = proxy.env.DB_SAMARINDA_GROUP;
		assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1);
		await db.batch([
			db.prepare('CREATE TABLE drill_parent(id TEXT PRIMARY KEY)'),
			db.prepare(
				'CREATE TABLE drill_child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES drill_parent(id))'
			)
		]);
		await assert.rejects(
			db.prepare("INSERT INTO drill_child VALUES('child','missing')").run(),
			/FOREIGN KEY constraint failed/i
		);
	} finally {
		await proxy.dispose();
	}
});
