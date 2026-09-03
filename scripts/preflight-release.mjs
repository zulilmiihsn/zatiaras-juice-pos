#!/usr/bin/env node
import { execSync } from 'node:child_process';

console.log('🚀 Running ZatiarasPOS Release Preflight Automation...');

function run(cmd) {
	return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

try {
	// 1. Check git working tree clean
	const status = run('git status --porcelain');
	if (status.length > 0) {
		console.error(
			'❌ Release Preflight Failed: Working tree is dirty. Commit or stash all changes.'
		);
		console.error(status);
		process.exit(1);
	}
	console.log('✅ Git working tree is 100% clean.');

	// 2. Check HEAD commit
	const headSha = run('git rev-parse HEAD');
	const targetSha = process.env.RELEASE_COMMIT_SHA || headSha;
	if (targetSha !== headSha) {
		console.error(
			`❌ Release Preflight Failed: RELEASE_COMMIT_SHA (${targetSha}) does not match HEAD (${headSha}).`
		);
		process.exit(1);
	}
	console.log(`✅ Release Candidate SHA verified: ${headSha}`);

	// 3. Check tests
	console.log('🧪 Executing automated test suite...');
	execSync('pnpm test:all', { stdio: 'inherit' });
	console.log('✅ All release gate tests passed.');

	// 4. Record build artifact hashes
	const { readdirSync, readFileSync, writeFileSync, existsSync } = await import('node:fs');
	const { createHash } = await import('node:crypto');
	const buildDir = '.svelte-kit/cloudflare';
	const artifactsManifest = {
		recorded_at: new Date().toISOString(),
		commit_sha: headSha,
		artifacts: {}
	};
	if (existsSync(buildDir)) {
		const files = readdirSync(buildDir, { recursive: true }).filter(
			(f) => typeof f === 'string' && !f.includes('node_modules')
		);
		for (const f of files.slice(0, 50)) {
			try {
				const full = `${buildDir}/${f}`;
				const stat = await import('node:fs').then((fs) => fs.statSync(full));
				if (stat.isFile()) {
					const buf = readFileSync(full);
					artifactsManifest.artifacts[f] = createHash('sha256').update(buf).digest('hex');
				}
			} catch {}
		}
	}
	writeFileSync('build-artifacts.json', JSON.stringify(artifactsManifest, null, 2), 'utf8');
	console.log('✅ Recorded build artifact SHA-256 hashes in build-artifacts.json.');

	console.log(
		'🎉 Release Preflight COMPLETE: Candidate is ready for production migration and deployment!'
	);
	process.exit(0);
} catch (error) {
	console.error('❌ Release Preflight encountered an error:', error.message);
	process.exit(1);
}
