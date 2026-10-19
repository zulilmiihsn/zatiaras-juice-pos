import { relative, isAbsolute } from 'node:path';

/** @typedef {{covered: number, total: number}} Counter */
/** @typedef {{file: string, lines: Counter, branches: Counter, functions: Counter}} CoverageFile */
/** @typedef {{version: 1, runtime: string, files: CoverageFile[]}} CoverageReport */
/** @typedef {{file: string, lines: number, branches: number, functions: number}} CoverageFloor */

/** @type {ReadonlyArray<CoverageFloor>} */
export const CRITICAL_COVERAGE = Object.freeze([
	{ file: 'src/lib/utils/money.ts', lines: 90, branches: 80, functions: 80 },
	{ file: 'src/lib/server/checkout/fingerprint.ts', lines: 95, branches: 90, functions: 95 },
	{ file: 'src/lib/server/checkout/stockReplayPolicy.ts', lines: 90, branches: 80, functions: 90 },
	{ file: 'src/lib/tax/engine.ts', lines: 90, branches: 85, functions: 85 },
	{ file: 'src/lib/server/apiAuth.ts', lines: 95, branches: 95, functions: 95 },
	{ file: 'src/lib/server/ledgerValidation.ts', lines: 95, branches: 90, functions: 90 },
	{ file: 'src/lib/server/sessionStore.ts', lines: 90, branches: 90, functions: 80 },
	{ file: 'src/lib/server/archiveSnapshot.ts', lines: 98, branches: 80, functions: 90 },
	{ file: 'src/lib/server/archiveUseCase.ts', lines: 90, branches: 75, functions: 70 }
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {number} */
function count(value) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new Error('Coverage count must be a nonnegative safe integer');
	return value;
}

/** @param {unknown} total @param {unknown} covered @returns {Counter} */
function counter(total, covered) {
	const result = { total: count(total), covered: count(covered) };
	if (result.covered > result.total) throw new Error('Covered count exceeds total');
	return result;
}

/** @param {unknown} summary @param {string} runtime @returns {CoverageReport} */
export function normalizeCoverageSummary(summary, runtime) {
	if (
		!record(summary) ||
		typeof summary.workingDirectory !== 'string' ||
		!Array.isArray(summary.files)
	)
		throw new Error('Missing native coverage summary');
	/** @type {CoverageFile[]} */
	const files = [];
	for (const row of summary.files) {
		if (!record(row) || typeof row.path !== 'string') throw new Error('Malformed coverage file');
		const file = relative(summary.workingDirectory, row.path).replaceAll('\\', '/');
		if (isAbsolute(file) || !file.startsWith('src/lib/')) continue;
		files.push({
			file,
			lines: counter(row.totalLineCount, row.coveredLineCount),
			branches: counter(row.totalBranchCount, row.coveredBranchCount),
			functions: counter(row.totalFunctionCount, row.coveredFunctionCount)
		});
	}
	return { version: 1, runtime, files };
}

/** @param {unknown} input @param {ReadonlyArray<CoverageFloor>} [floors] */
export function assessCriticalCoverage(input, floors = CRITICAL_COVERAGE) {
	if (
		!record(input) ||
		input.version !== 1 ||
		typeof input.runtime !== 'string' ||
		!Array.isArray(input.files)
	)
		throw new Error('Malformed coverage report');
	/** @type {Map<string, CoverageFile>} */
	const files = new Map();
	for (const row of input.files) {
		if (!record(row) || typeof row.file !== 'string' || files.has(row.file))
			throw new Error('Malformed or duplicate coverage file');
		if (!record(row.lines) || !record(row.branches) || !record(row.functions))
			throw new Error('Missing coverage counters');
		files.set(row.file, {
			file: row.file,
			lines: counter(row.lines.total, row.lines.covered),
			branches: counter(row.branches.total, row.branches.covered),
			functions: counter(row.functions.total, row.functions.covered)
		});
	}
	/** @type {string[]} */
	const failures = [];
	const seen = new Set();
	for (const floor of floors) {
		if (seen.has(floor.file)) throw new Error('Duplicate coverage floor');
		seen.add(floor.file);
		const actual = files.get(floor.file);
		if (!actual) {
			failures.push(`${floor.file}: not measured`);
			continue;
		}
		for (const kind of /** @type {const} */ (['lines', 'branches', 'functions'])) {
			const minimum = floor[kind];
			if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100)
				throw new Error('Invalid coverage floor');
			const measured = actual[kind];
			if (measured.total === 0 || measured.covered * 100 < measured.total * minimum) {
				const percent = measured.total
					? ((measured.covered * 100) / measured.total).toFixed(2)
					: 'unmeasured';
				failures.push(`${floor.file}: ${kind}=${percent}, minimum=${minimum}`);
			}
		}
	}
	return { ok: failures.length === 0, failures };
}
