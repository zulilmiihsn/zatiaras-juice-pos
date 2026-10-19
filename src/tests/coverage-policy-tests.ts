import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { dirname, basename, join } from 'node:path';
import { mkdtempSync, realpathSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runCoverage } from '../../scripts/test-coverage.mjs';
import coverageReporter from '../../scripts/coverage-reporter.mjs';
import {
	assessCriticalCoverage,
	normalizeCoverageSummary
} from '../../scripts/coverage-policy.mjs';

const floor = [{ file: 'src/lib/domain/policy.ts', lines: 90, branches: 80, functions: 90 }];
function report(covered = 9, total = 10) {
	return {
		version: 1,
		runtime: 'fixture',
		files: [
			{
				file: floor[0].file,
				lines: { covered, total },
				branches: { covered, total },
				functions: { covered, total }
			}
		]
	};
}

await test('critical coverage enforces each counter and does not fabricate missing or unloaded modules', () => {
	assert.equal(assessCriticalCoverage(report(), floor).ok, true);
	assert.equal(assessCriticalCoverage(report(8), floor).ok, false);
	assert.equal(assessCriticalCoverage(report(0, 0), floor).ok, false);
	assert.equal(
		assessCriticalCoverage({ version: 1, runtime: 'fixture', files: [] }, floor).ok,
		false
	);
	for (const metric of ['lines', 'branches', 'functions'] as const) {
		const changed = report();
		changed.files[0][metric] = { covered: 0, total: 10 };
		assert.equal(assessCriticalCoverage(changed, floor).ok, false);
	}
});

await test('coverage reporter requires a real native summary event', async () => {
	async function* empty() {
		yield { type: 'test:diagnostic', data: {} };
	}
	await assert.rejects(async () => {
		for await (const item of coverageReporter(empty())) assert.fail(String(item));
	}, /no coverage event/);
});

await test('coverage CLI rejects stale reports, child failure, missing evidence, and malformed evidence', () => {
	const parent = realpathSync.native(tmpdir());
	const directory = mkdtempSync(join(parent, 'zatiaras-coverage-test-'));
	const file = join(directory, 'unit-coverage.json');
	try {
		writeFileSync(file, JSON.stringify(report()));
		assert.equal(
			runCoverage(['--critical'], {
				outputDirectory: directory,
				runner: (_command, args) => {
					assert.ok(args.some((arg) => arg.startsWith('--test-reporter=file:')));
					return { status: 7 };
				}
			}),
			7
		);
		assert.equal(existsSync(file), false);
		assert.throws(
			() =>
				runCoverage(['--critical'], { outputDirectory: directory, runner: () => ({ status: 0 }) }),
			/ENOENT/
		);
		assert.throws(() =>
			runCoverage(['--critical'], {
				outputDirectory: directory,
				runner: () => {
					writeFileSync(file, 'bad-json');
					return { status: 0 };
				}
			})
		);
		assert.equal(
			runCoverage(['--critical'], {
				outputDirectory: directory,
				runner: () => {
					writeFileSync(
						file,
						JSON.stringify({ version: 1, runtime: 'fixture', scope: 'critical-domain', files: [] })
					);
					return { status: 0 };
				}
			}),
			1
		);
		assert.throws(() => runCoverage(['--unknown'], { outputDirectory: directory }), /Unknown/);
	} finally {
		const target = realpathSync.native(directory);
		assert.equal(dirname(target), parent);
		assert.match(basename(target), /^zatiaras-coverage-test-/);
		rmSync(target, { recursive: true, force: true });
		assert.equal(existsSync(target), false);
	}
});

await test('critical coverage rejects malformed, duplicate, nonfinite, and inconsistent evidence', () => {
	for (const value of [null, {}, { version: 2, runtime: 'fixture', files: [] }])
		assert.throws(() => assessCriticalCoverage(value, floor));
	assert.throws(
		() =>
			assessCriticalCoverage({ ...report(), files: [...report().files, ...report().files] }, floor),
		/duplicate/
	);
	for (const [covered, total] of [
		[11, 10],
		[-1, 10],
		[Number.NaN, 10],
		[1, Number.POSITIVE_INFINITY],
		[1.5, 10]
	])
		assert.throws(() => assessCriticalCoverage(report(covered, total), floor));
	assert.throws(() => assessCriticalCoverage(report(), [{ ...floor[0], lines: 101 }]), /floor/);
});

await test('native report paths are portable and counters are validated before producing evidence', () => {
	const root = resolve('coverage-fixture');
	const summary = {
		workingDirectory: root,
		files: [
			{
				path: resolve(root, 'src/lib/domain/policy.ts'),
				totalLineCount: 10,
				coveredLineCount: 9,
				totalBranchCount: 10,
				coveredBranchCount: 9,
				totalFunctionCount: 10,
				coveredFunctionCount: 9
			},
			{ path: resolve(root, '../outside.ts') }
		]
	};
	assert.deepEqual(normalizeCoverageSummary(summary, 'fixture'), report());
	assert.throws(() => normalizeCoverageSummary(null, 'fixture'));
	assert.throws(() => normalizeCoverageSummary({ ...summary, files: [{}] }, 'fixture'));
});
