import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { validateTaxSettings } from '../lib/tax/engine.js';

// R04: dua penulis expected revision sama -> satu menang, satu 409 (changes 0).
const db = new DatabaseSync(':memory:');
db.exec(
	'CREATE TABLE pengaturan (id TEXT PRIMARY KEY, cabang_id TEXT, kunci TEXT, nilai TEXT, updated_at TEXT)'
);
db.exec('CREATE UNIQUE INDEX idx_pengaturan_branch_kunci ON pengaturan (cabang_id, kunci)');
const v0 = JSON.stringify({
	schema_version: 2,
	revision: 3,
	settings: { isTaxEnabled: true, taxes: [] }
});
db.prepare('INSERT INTO pengaturan VALUES (?,?,?,?,?)').run(
	'r1',
	'samarinda',
	'pajak_config',
	v0,
	't0'
);

function cas(oldNilai: string | null, envelope: string): number {
	if (oldNilai === null) {
		return Number(
			db
				.prepare(
					'INSERT INTO pengaturan (id,cabang_id,kunci,nilai,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(cabang_id,kunci) DO UPDATE SET nilai=excluded.nilai, updated_at=excluded.updated_at WHERE pengaturan.nilai IS NULL'
				)
				.run('rx', 'samarinda', 'pajak_config', envelope, 't').changes ?? 0
		);
	}
	return Number(
		db
			.prepare(
				'INSERT INTO pengaturan (id,cabang_id,kunci,nilai,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(cabang_id,kunci) DO UPDATE SET nilai=excluded.nilai, updated_at=excluded.updated_at WHERE pengaturan.nilai = ?'
			)
			.run('rx', 'samarinda', 'pajak_config', envelope, 't', oldNilai).changes ?? 0
	);
}

const bothRead = v0;
const win = cas(
	bothRead,
	JSON.stringify({ schema_version: 2, revision: 4, settings: { isTaxEnabled: true, taxes: [] } })
);
assert.equal(win, 1);
const lose = cas(
	bothRead,
	JSON.stringify({ schema_version: 2, revision: 4, settings: { isTaxEnabled: false, taxes: [] } })
);
assert.equal(lose, 0, 'penulis kedua dengan expected basi harus kalah (409)');

// Validator: boolean/threshold/id ketat.
assert.equal(
	validateTaxSettings({
		isTaxEnabled: true,
		taxes: [{ id: 'a', nama: 'A', tipe: 'ppn', persentase: 11, isEnabled: 'false' }]
	}).ok,
	false
);
assert.equal(
	validateTaxSettings({
		isTaxEnabled: true,
		taxes: [
			{ id: 'a', nama: 'A', tipe: 'ppn', persentase: 11, isEnabled: true, thresholdAmount: -1 }
		]
	}).ok,
	false
);
assert.equal(
	validateTaxSettings({
		isTaxEnabled: true,
		taxes: [{ id: 'a', nama: 'A', tipe: 'ppn', persentase: 11, isEnabled: true }]
	}).ok,
	true
);

console.log('tax-cas-tests: all assertions passed');
