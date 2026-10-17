#!/usr/bin/env node
/**
 * Coverage suite unit untuk src/lib (tanpa komponen .svelte dan deklarasi .d.ts).
 * File yang tidak pernah di-load tes ikut dihitung 0% bila runtime mendukung
 * --test-coverage-include-all; tanpa itu angka coverage terlalu optimis.
 */
import { spawnSync } from 'node:child_process';

const INCLUDE_ALL = '--test-coverage-include-all';
const supportsIncludeAll = process.allowedNodeEnvironmentFlags.has(INCLUDE_ALL);
if (!supportsIncludeAll) {
	console.warn(
		`Node ${process.version} tidak mendukung ${INCLUDE_ALL}: file src/lib yang tidak di-load tes tidak terhitung.`
	);
}

const result = spawnSync(
	process.execPath,
	[
		'--import',
		'tsx',
		'--test',
		'--test-concurrency=4',
		'--experimental-test-coverage',
		...(supportsIncludeAll ? [INCLUDE_ALL] : []),
		'--test-coverage-include=src/lib/**',
		'--test-coverage-exclude=**/*.svelte',
		'--test-coverage-exclude=**/*.d.ts',
		'src/tests/*-tests.ts'
	],
	{ stdio: 'inherit' }
);
process.exit(result.status ?? 1);
