#!/usr/bin/env node
/**
 * Lingkungan staging terpisah dari produksi.
 *
 *   node --env-file=.env scripts/staging.mjs setup   buat D1 x3, R2, proyek Pages (idempoten)
 *                                                    lalu isi ID D1 ke staging/*.jsonc
 *   node scripts/staging.mjs check                   gagal bila ID staging belum diisi
 *
 * Tidak pernah menyentuh resource atau config produksi: semua nama berakhiran -staging.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wranglerInvocation } from './wrangler-cli.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STAGING_CONFIGS = ['staging/wrangler.jsonc', 'staging/wrangler.realtime.jsonc'];
export const STAGING_DATABASES = {
	DB_SAMARINDA_GROUP: 'zatiaras-samarinda-group-staging',
	DB_BALIKPAPAN_GROUP: 'zatiaras-balikpapan-group-staging',
	DB_BERAU_GROUP: 'zatiaras-berau-group-staging'
};
const STAGING_BUCKET = 'zatiaras-assets-staging';
const STAGING_PAGES_PROJECT = 'zatiaraspos-staging';
const PLACEHOLDER = /STAGING_ID_[A-Z_]+/;

export function missingStagingIds(read = (file) => readFileSync(resolve(ROOT, file), 'utf8')) {
	return STAGING_CONFIGS.filter((file) => PLACEHOLDER.test(read(file)));
}

/** Ganti ID database per binding di config staging (placeholder atau ID lama). */
export function applyDatabaseIds(text, ids) {
	let next = text;
	for (const [binding, id] of Object.entries(ids)) {
		const pattern = new RegExp(
			`("binding": "${binding}",\\s*"database_name": "[^"]+",\\s*"database_id": ")[^"]+(")`
		);
		if (!pattern.test(next))
			throw new Error(`Binding ${binding} tidak ditemukan di config staging`);
		next = next.replace(pattern, `$1${id}$2`);
	}
	return next;
}

function wrangler(args, { allowFailure = false } = {}) {
	const { command, args: argv, options } = wranglerInvocation(args);
	const result = spawnSync(command, argv, { ...options, cwd: ROOT });
	if (result.status !== 0 && !allowFailure) {
		throw new Error(
			`wrangler ${args.slice(0, 3).join(' ')} gagal:\n${result.stderr || result.stdout}`
		);
	}
	return result;
}

function listDatabases() {
	const result = wrangler(['d1', 'list', '--json']);
	const parsed = JSON.parse(result.stdout);
	if (!Array.isArray(parsed)) throw new Error('Output d1 list tidak dikenali');
	return new Map(parsed.map((db) => [db.name, db.uuid]));
}

function setup() {
	let databases = listDatabases();
	for (const name of Object.values(STAGING_DATABASES)) {
		if (databases.has(name)) continue;
		console.log(`Membuat D1 ${name}...`);
		wrangler(['d1', 'create', name]);
	}
	databases = listDatabases();
	const ids = {};
	for (const [binding, name] of Object.entries(STAGING_DATABASES)) {
		const id = databases.get(name);
		if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error(`ID D1 ${name} tidak ditemukan`);
		ids[binding] = id;
	}

	const bucket = wrangler(['r2', 'bucket', 'create', STAGING_BUCKET], { allowFailure: true });
	if (bucket.status !== 0 && !/already exists/i.test(`${bucket.stderr}${bucket.stdout}`))
		throw new Error(`Gagal membuat bucket ${STAGING_BUCKET}:\n${bucket.stderr || bucket.stdout}`);

	const pages = wrangler(
		['pages', 'project', 'create', STAGING_PAGES_PROJECT, '--production-branch', 'main'],
		{ allowFailure: true }
	);
	if (pages.status !== 0 && !/already exists|already taken/i.test(`${pages.stderr}${pages.stdout}`))
		throw new Error(`Gagal membuat proyek Pages:\n${pages.stderr || pages.stdout}`);

	for (const file of STAGING_CONFIGS) {
		const path = resolve(ROOT, file);
		writeFileSync(path, applyDatabaseIds(readFileSync(path, 'utf8'), ids));
	}
	console.log('Staging siap. ID D1 tercatat di staging/*.jsonc; commit perubahan itu.');
	console.log('Langkah berikutnya ada di docs/OPERATOR-RUNBOOK.md bagian Staging.');
}

function check() {
	const missing = missingStagingIds();
	if (missing.length) {
		console.error(
			`ID staging belum diisi di: ${missing.join(', ')}. Jalankan: node --env-file=.env scripts/staging.mjs setup`
		);
		process.exit(1);
	}
	console.log('Config staging lengkap.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const command = process.argv[2];
	if (command === 'setup') setup();
	else if (command === 'check') check();
	else {
		console.error('Pakai: node scripts/staging.mjs <setup|check>');
		process.exit(2);
	}
}
