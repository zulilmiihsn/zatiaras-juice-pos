#!/usr/bin/env node
/**
 * Coverage suite unit untuk src/lib (tanpa komponen .svelte dan deklarasi .d.ts).
 * File yang tidak pernah di-load tes ikut dihitung 0% bila runtime mendukung
 * --test-coverage-include-all; tanpa itu angka coverage terlalu optimis.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessCriticalCoverage } from './coverage-policy.mjs';

const INCLUDE_ALL = '--test-coverage-include-all';

// Subprocess CLI native dan SSR memakai transform berbeda; gate domain mengukur satu jalur source.
// Seluruh tes, termasuk CLI dan SSR, tetap wajib pada job unit/operations tersendiri.
export const CRITICAL_COVERAGE_TESTS = [
	'checkout-policy-tests',
	'stock-replay-contract-tests',
	'tax-calculation-tests',
	'tax-cas-tests',
	'ledger-validation-tests',
	'ledger-cas-tests',
	'auth-service-tests',
	'session-renew-tests',
	'role-contract-tests',
	'page-lock-tests',
	'signing-key-tests',
	'hardening-regression-tests',
	'archive-usecase-tests',
	'archive-guard-tests',
	'archive-version-tests',
	'archive-chunk-tests',
	'archive-download-tests',
	'archive-restore-tests',
	'receipt-output-tests',
	'report-tax-tests',
	'ai-report-tests'
].map((name) => `src/tests/${name}.ts`);

/**
 * @param {string[]} argv
 * @param {{outputDirectory?: string, runner?: (command: string, args: string[], options: {stdio: 'inherit', env: NodeJS.ProcessEnv}) => {status: number | null}}} [dependencies]
 */
export function runCoverage(argv, dependencies = {}) {
	const strict = argv.includes('--critical');
	if (argv.some((arg) => arg !== '--critical')) throw new Error('Unknown coverage argument');
	const outputDirectory = dependencies.outputDirectory || resolve('test-results', 'coverage');
	mkdirSync(outputDirectory, { recursive: true });
	const reportFile = join(outputDirectory, 'unit-coverage.json');
	// Laporan lama tidak boleh mengesahkan run yang gagal menghasilkan event coverage.
	rmSync(reportFile, { force: true });
	const supportsIncludeAll = process.allowedNodeEnvironmentFlags.has(INCLUDE_ALL);
	if (!supportsIncludeAll) {
		console.warn(
			`Node ${process.version} tidak mendukung ${INCLUDE_ALL}: file src/lib yang tidak di-load tes tidak terhitung.`
		);
	}
	const result = (dependencies.runner || spawnSync)(
		process.execPath,
		[
			'--import',
			'tsx',
			'--test',
			'--test-concurrency=4',
			'--experimental-test-coverage',
			'--test-reporter=spec',
			'--test-reporter-destination=stdout',
			`--test-reporter=${new URL('./coverage-reporter.mjs', import.meta.url).href}`,
			`--test-reporter-destination=${reportFile}`,
			...(supportsIncludeAll ? [INCLUDE_ALL] : []),
			'--test-coverage-include=src/lib/**',
			'--test-coverage-exclude=**/*.svelte',
			'--test-coverage-exclude=**/*.d.ts',
			...(strict ? CRITICAL_COVERAGE_TESTS : ['src/tests/*-tests.ts'])
		],
		{
			stdio: 'inherit',
			env: {
				...process.env,
				ZATIARAS_COVERAGE_SCOPE: strict ? 'critical-domain' : 'unit-all-mixed-loaders'
			}
		}
	);
	if (result.status !== 0) return result.status ?? 1;
	const report = JSON.parse(readFileSync(reportFile, 'utf8'));
	if (!strict) {
		console.log(
			'[coverage] full-suite diagnostics; critical domain uses a separate consistent source scope'
		);
		return 0;
	}
	if (report.scope !== 'critical-domain') throw new Error('Coverage report scope mismatch');
	const assessed = assessCriticalCoverage(report);
	if (!assessed.ok) {
		console.error(`[critical-coverage] ${assessed.failures.join('\n')}`);
		if (strict) return 1;
	} else {
		console.log('[critical-coverage] all domain floors satisfied');
	}
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exit(runCoverage(process.argv.slice(2)));
}
