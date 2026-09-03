import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CONFIG_FILE = 'wrangler.pages.jsonc';

function argValue(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

function run(command, args) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32'
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed`);
	}
}

const databaseName = argValue('--database');
const backupFile = argValue('--file');
const confirmedDatabase = process.env.CONFIRM_D1_RESTORE;

if (!databaseName || !backupFile) {
	console.error(
		'Usage: CONFIRM_D1_RESTORE=<database> pnpm d1:restore -- --database <database> --file <backup.sql>'
	);
	process.exit(1);
}

if (confirmedDatabase !== databaseName) {
	console.error(`Refusing restore. Set CONFIRM_D1_RESTORE=${databaseName} to confirm target.`);
	process.exit(1);
}

if (!existsSync(backupFile)) {
	console.error(`Backup file not found: ${backupFile}`);
	process.exit(1);
}

run('npx', [
	'wrangler',
	'd1',
	'execute',
	databaseName,
	'--config',
	CONFIG_FILE,
	'--remote',
	'--yes',
	'--file',
	backupFile
]);

console.log(`D1 restore complete: ${databaseName} <= ${backupFile}`);
