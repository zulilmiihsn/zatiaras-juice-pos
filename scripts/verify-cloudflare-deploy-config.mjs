import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REQUIRED_ENV = ['CLOUDFLARE_API_TOKEN', 'POS_PRICE_SIGNING_KEY'];
const PUSH_ENV = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
const PLACEHOLDER_PATTERN = /REPLACE_WITH_|your_/i;
const CONFIG_FILES = ['wrangler.jsonc', 'wrangler.pages.jsonc', 'wrangler.realtime.jsonc'];

async function loadDotEnv(path = '.env') {
	let content = '';
	try {
		content = await readFile(resolve(path), 'utf8');
	} catch {
		return;
	}

	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

		const separatorIndex = trimmed.indexOf('=');
		const key = trimmed.slice(0, separatorIndex).trim();
		let value = trimmed.slice(separatorIndex + 1).trim();

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		process.env[key] ||= value;
	}
}

function fail(message) {
	console.error(`[cloudflare-config] ${message}`);
	process.exitCode = 1;
}

/**
 * Strip komentar (// dan / * * /) serta trailing comma dari teks JSONC,
 * dengan menghormati isi string (jangan ganggu "https://..."). File wrangler
 * berekstensi .jsonc dan legal mengandung komentar; JSON.parse polos akan gagal.
 */
function stripJsonc(text) {
	let out = '';
	let inString = false;
	let stringChar = '';
	let inLine = false;
	let inBlock = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (inLine) {
			if (ch === '\n') {
				inLine = false;
				out += ch;
			}
			continue;
		}
		if (inBlock) {
			if (ch === '*' && next === '/') {
				inBlock = false;
				i++;
			}
			continue;
		}
		if (inString) {
			out += ch;
			if (ch === '\\') {
				out += next;
				i++;
			} else if (ch === stringChar) {
				inString = false;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = true;
			stringChar = ch;
			out += ch;
			continue;
		}
		if (ch === '/' && next === '/') {
			inLine = true;
			i++;
			continue;
		}
		if (ch === '/' && next === '*') {
			inBlock = true;
			i++;
			continue;
		}
		out += ch;
	}
	return out.replace(/,(\s*[}\]])/g, '$1');
}

async function readJson(path) {
	const content = await readFile(resolve(path), 'utf8');
	return JSON.parse(stripJsonc(content));
}

await loadDotEnv();

for (const name of REQUIRED_ENV) {
	if (!process.env[name] || PLACEHOLDER_PATTERN.test(process.env[name])) {
		fail(`Missing required environment variable: ${name}`);
	}
}

// Config presence is a release prerequisite, not proof of browser/provider delivery.
if (process.argv.includes('--require-antrean-push') || PUSH_ENV.some((name) => process.env[name])) {
	for (const name of PUSH_ENV) {
		if (!process.env[name] || PLACEHOLDER_PATTERN.test(process.env[name])) {
			fail(`Missing required Antrean push variable: ${name}`);
		}
	}
} else {
	console.log(
		'[cloudflare-config] Web Push belum dikonfigurasi; aktivasi perangkat belum tersedia.'
	);
}

for (const file of CONFIG_FILES) {
	const text = await readFile(resolve(file), 'utf8');
	if (PLACEHOLDER_PATTERN.test(text)) {
		fail(`${file} still contains placeholder values`);
	}
}

const appConfig = await readJson('wrangler.jsonc');
const pageConfig = await readJson('wrangler.pages.jsonc');
const realtimeConfig = await readJson('wrangler.realtime.jsonc');

for (const [file, config] of [
	['wrangler.jsonc', appConfig],
	['wrangler.pages.jsonc', pageConfig]
]) {
	for (const database of config.d1_databases || []) {
		if (!database.database_id || PLACEHOLDER_PATTERN.test(database.database_id)) {
			fail(`${file}: D1 database ${database.database_name} has no real database_id`);
		}
	}

	for (const bucket of config.r2_buckets || []) {
		if (!bucket.bucket_name || PLACEHOLDER_PATTERN.test(bucket.bucket_name)) {
			fail(`${file}: R2 bucket binding ${bucket.binding} has no real bucket_name`);
		}
	}
}

const realtimeBinding = appConfig.durable_objects?.bindings?.find(
	(binding) => binding.name === 'REALTIME_HUB'
);

if (!realtimeBinding?.script_name) {
	fail('wrangler.jsonc REALTIME_HUB must bind to the external realtime Worker via script_name');
}

if (realtimeBinding?.script_name !== realtimeConfig.name) {
	fail(
		`REALTIME_HUB script_name (${realtimeBinding.script_name}) does not match ${realtimeConfig.name}`
	);
}

// Paritas shard D1 lintas config (AUD-050): Pages, app intent, dan Worker
// realtime WAJIB menunjuk database_id yang sama — drift diam-diam berarti
// cabang baca shard berbeda antara runtime.
const realtimeIds = new Map(
	(realtimeConfig.d1_databases || []).map((d) => [d.binding, d.database_id])
);
for (const database of pageConfig.d1_databases || []) {
	if (realtimeIds.get(database.binding) !== database.database_id) {
		fail(
			`D1 ${database.binding}: pages ${database.database_id} != realtime ${realtimeIds.get(database.binding)}`
		);
	}
}

// Cron relay + cleanup harian wajib ada (runbook §10a.1).
for (const cron of ['* * * * *', '0 3 * * *']) {
	if (!(realtimeConfig.triggers?.crons || []).includes(cron)) {
		fail(`wrangler.realtime.jsonc kehilangan cron ${cron}`);
	}
}

if (!process.exitCode) {
	console.log('[cloudflare-config] deploy config looks ready');
}
