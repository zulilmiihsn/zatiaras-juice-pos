import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { join, resolve } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import {
	canonicalizeExternalPath,
	CONFIG_FILE,
	loadAllowlistedEnv,
	parseAndVerifyInfo,
	REPO_ROOT,
	redactValues,
	validateD1Config,
	WORKSPACE_ROOT
} from './d1-backup.mjs';

const MODULE_FILE = fileURLToPath(import.meta.url);
const UAT_PRODUCT_ID = 'uat-produk-es-teh';
const UAT_ENV_KEYS = Object.freeze([
	'UAT_PASSWORD',
	'UAT_KASIR_PASSWORD',
	'UAT_OWNER_PASSWORD',
	'UAT_KASIR_USERNAME',
	'UAT_OWNER_USERNAME',
	'CLOUDFLARE_API_TOKEN',
	'CLOUDFLARE_ACCOUNT_ID'
]);
const OS_ENV_KEYS = Object.freeze([
	'PATH',
	'PATHEXT',
	'SystemRoot',
	'TEMP',
	'TMP',
	'USERPROFILE',
	'APPDATA',
	'LOCALAPPDATA'
]);
const BRANCH_BINDINGS = Object.freeze({
	samarinda: 'DB_SAMARINDA_GROUP',
	samarinda2: 'DB_SAMARINDA_GROUP',
	balikpapan: 'DB_BALIKPAPAN_GROUP',
	balikpapan2: 'DB_BALIKPAPAN_GROUP',
	berau: 'DB_BERAU_GROUP'
});
const IDEMPOTENCY_PATTERN = /^uat-live-[0-9]{13}-[0-9a-f]{16}$/;
const MAX_CHILD_OUTPUT = 1024 * 1024;

class HumanNeededError extends Error {
	constructor(reason) {
		super(`human_needed: ${reason}`);
		this.name = 'HumanNeededError';
		this.code = 'HUMAN_NEEDED';
	}
}

function normalizeForCompare(value) {
	const normalized = resolve(value).replace(/[\\/]+$/, '');
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function parseCliArgs(argv) {
	const options = {
		live: false,
		baseUrl: null,
		branch: null,
		envFile: null,
		journalDir: null,
		selfTest: false,
		cleanupOnly: false
	};
	const valued = new Set(['--base-url', '--branch', '--env-file', '--journal-dir']);
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--live') options.live = true;
		else if (arg === '--self-test') options.selfTest = true;
		else if (arg === '--cleanup-only') options.cleanupOnly = true;
		else if (valued.has(arg)) {
			const value = argv[index + 1];
			if (!value || value.startsWith('--')) throw new Error(`Nilai ${arg} wajib diisi`);
			index += 1;
			if (arg === '--base-url') options.baseUrl = value;
			if (arg === '--branch') options.branch = value;
			if (arg === '--env-file') options.envFile = value;
			if (arg === '--journal-dir') options.journalDir = value;
		} else throw new Error(`Argumen tidak diizinkan: ${arg}`);
	}
	if (options.selfTest && argv.length !== 1) {
		throw new Error('--self-test harus dijalankan sendiri');
	}
	return options;
}

export function buildMinimalChildEnv(secrets, processEnv = process.env) {
	const childEnv = {};
	for (const key of OS_ENV_KEYS) {
		if (typeof processEnv[key] === 'string' && processEnv[key]) childEnv[key] = processEnv[key];
	}
	for (const key of UAT_ENV_KEYS) {
		if (typeof secrets[key] === 'string' && secrets[key]) childEnv[key] = secrets[key];
	}
	return childEnv;
}

function requireSecrets(secrets) {
	for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
		if (!secrets[key]) throw new Error(`${key} wajib diisi`);
	}
	if (!secrets.UAT_KASIR_PASSWORD && !secrets.UAT_PASSWORD) {
		throw new Error('UAT_KASIR_PASSWORD wajib diisi');
	}
	if (!secrets.UAT_OWNER_PASSWORD && !secrets.UAT_PASSWORD) {
		throw new Error('UAT_OWNER_PASSWORD wajib diisi');
	}
}

function validateOptions(options) {
	if (!options.live) throw new Error('Mutasi production memerlukan --live');
	if (!options.baseUrl) throw new Error('--base-url wajib diisi');
	const url = new URL(options.baseUrl);
	if (url.protocol !== 'https:') throw new Error('--base-url production wajib HTTPS');
	if (!options.branch || !BRANCH_BINDINGS[options.branch]) {
		throw new Error('--branch tidak termasuk allowlist');
	}
	if (!options.journalDir) throw new Error('--journal-dir absolut di luar workspace wajib diisi');
	return { ...options, baseUrl: url.origin };
}

function rows(value) {
	if (Array.isArray(value)) return value;
	if (Array.isArray(value?.data)) return value.data;
	if (Array.isArray(value?.results)) return value.results;
	if (Array.isArray(value?.result)) return value.result;
	if (Array.isArray(value?.result?.[0]?.results)) return value.result[0].results;
	return [];
}

function getSetCookies(headers) {
	if (typeof headers?.getSetCookie === 'function') return headers.getSetCookie();
	const cookie = headers?.get?.('set-cookie');
	return cookie ? [cookie] : [];
}

function cookiePair(cookies, name) {
	const cookie = cookies.find((item) => item.startsWith(`${name}=`));
	return cookie ? cookie.split(';')[0] : '';
}

async function responseJson(response) {
	return response.json().catch(() => null);
}

async function login(fetchImpl, baseUrl, branch, username, password) {
	const csrfResponse = await fetchImpl(`${baseUrl}/api/csrf`);
	if (!csrfResponse.ok) throw new Error(`CSRF ${username} gagal: HTTP ${csrfResponse.status}`);
	const csrfJson = await responseJson(csrfResponse);
	const csrfCookie = cookiePair(getSetCookies(csrfResponse.headers), 'zatiaras_csrf');
	if (!csrfJson?.token || !csrfCookie) throw new Error(`CSRF ${username} tidak lengkap`);
	const loginResponse = await fetchImpl(`${baseUrl}/api/veriflogin`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-csrf-token': csrfJson.token,
			Cookie: csrfCookie
		},
		body: JSON.stringify({ username, password, branch })
	});
	const payload = await responseJson(loginResponse);
	if (!loginResponse.ok || !payload?.success) {
		throw new Error(`Login ${username} gagal: HTTP ${loginResponse.status}`);
	}
	const sidCookie = cookiePair(getSetCookies(loginResponse.headers), 'zatiaras_sid');
	if (!sidCookie) throw new Error(`Session cookie ${username} tidak tersedia`);
	return {
		csrfToken: csrfJson.token,
		cookie: `${csrfCookie}; ${sidCookie}`,
		user: {
			username: String(payload?.user?.username ?? username),
			role: String(payload?.user?.role ?? '')
		}
	};
}

async function logout(fetchImpl, baseUrl, auth) {
	if (!auth?.cookie) return;
	const response = await fetchImpl(`${baseUrl}/api/logout`, {
		method: 'POST',
		headers: {
			Cookie: auth.cookie,
			'X-CSRF-Token': auth.csrfToken
		}
	});
	if (!response.ok) throw new Error(`Logout ${auth.user?.username ?? 'UAT'} gagal`);
}

async function requestJson(fetchImpl, baseUrl, path, { auth, method = 'GET', body } = {}) {
	const headers = {};
	if (auth?.cookie) headers.Cookie = auth.cookie;
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	if (method !== 'GET' && auth?.csrfToken) headers['X-CSRF-Token'] = auth.csrfToken;
	const response = await fetchImpl(`${baseUrl}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return { ok: response.ok, status: response.status, body: await responseJson(response) };
}

class RawWebSocket {
	constructor(socket) {
		this.socket = socket;
		this.listeners = new Map();
		this.buffer = Buffer.alloc(0);
		socket.on('data', (chunk) => this.onData(chunk));
		socket.on('close', () => this.emit('close', { code: 1006 }));
		socket.on('error', (error) => this.emit('error', error));
	}

	addEventListener(type, callback) {
		const callbacks = this.listeners.get(type) ?? new Set();
		callbacks.add(callback);
		this.listeners.set(type, callbacks);
	}

	removeEventListener(type, callback) {
		this.listeners.get(type)?.delete(callback);
	}

	emit(type, event) {
		for (const callback of this.listeners.get(type) ?? []) callback(event);
	}

	onData(chunk) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (this.buffer.length >= 2) {
			const first = this.buffer[0];
			const second = this.buffer[1];
			const opcode = first & 0x0f;
			let length = second & 0x7f;
			let offset = 2;
			if (length === 126) {
				if (this.buffer.length < 4) return;
				length = this.buffer.readUInt16BE(2);
				offset = 4;
			} else if (length === 127) {
				if (this.buffer.length < 10) return;
				const largeLength = this.buffer.readBigUInt64BE(2);
				if (largeLength > BigInt(Number.MAX_SAFE_INTEGER))
					throw new Error('Frame realtime terlalu besar');
				length = Number(largeLength);
				offset = 10;
			}
			if (this.buffer.length < offset + length) return;
			const payload = this.buffer.subarray(offset, offset + length);
			this.buffer = this.buffer.subarray(offset + length);
			if (opcode === 1) this.emit('message', { data: payload.toString('utf8') });
			if (opcode === 8) {
				this.close();
				return;
			}
		}
	}

	close() {
		this.socket.end();
	}
}

export function openRawSocket({ baseUrl, branch, cookie, label }) {
	const wsUrl = new URL(
		`${baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')}/api/realtime?branch=${encodeURIComponent(branch)}`
	);
	return new Promise((resolveSocket, reject) => {
		const port = Number(wsUrl.port || (wsUrl.protocol === 'wss:' ? 443 : 80));
		const socket =
			wsUrl.protocol === 'wss:'
				? tls.connect({ host: wsUrl.hostname, port, servername: wsUrl.hostname })
				: net.connect({ host: wsUrl.hostname, port });
		const timer = setTimeout(() => reject(new Error(`${label} realtime open timeout`)), 10000);
		const chunks = [];
		socket.once('connect', () => {
			const key = randomBytes(16).toString('base64');
			socket.write(
				[
					`GET ${wsUrl.pathname}${wsUrl.search} HTTP/1.1`,
					`Host: ${wsUrl.host}`,
					'Upgrade: websocket',
					'Connection: Upgrade',
					`Sec-WebSocket-Key: ${key}`,
					'Sec-WebSocket-Version: 13',
					`Cookie: ${cookie}`,
					'\r\n'
				].join('\r\n')
			);
		});
		function onHandshakeData(chunk) {
			chunks.push(chunk);
			const buffer = Buffer.concat(chunks);
			const marker = buffer.indexOf('\r\n\r\n');
			if (marker === -1) return;
			socket.off('data', onHandshakeData);
			const header = buffer.subarray(0, marker).toString('utf8');
			const rest = buffer.subarray(marker + 4);
			if (!header.startsWith('HTTP/1.1 101')) {
				clearTimeout(timer);
				socket.end();
				reject(new Error(`${label} realtime ditolak`));
				return;
			}
			clearTimeout(timer);
			const raw = new RawWebSocket(socket);
			if (rest.length) raw.onData(rest);
			resolveSocket(raw);
		}
		socket.on('data', onHandshakeData);
		socket.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

class RealtimeCollector {
	constructor(socket, label) {
		this.socket = socket;
		this.label = label;
		this.messages = [];
		this.waiters = new Set();
		this.onMessage = (event) => {
			if (event.data === 'pong') return;
			let message;
			try {
				message = JSON.parse(String(event.data));
			} catch {
				return;
			}
			this.messages.push(message);
			for (const wake of this.waiters) wake();
		};
		socket.addEventListener('message', this.onMessage);
	}

	async waitFor(predicate, timeoutMs = 10000) {
		const existing = this.messages.find(predicate);
		if (existing) return existing;
		return new Promise((resolveWait, reject) => {
			const timer = setTimeout(() => {
				this.waiters.delete(check);
				reject(new Error(`${this.label} realtime exact-event timeout`));
			}, timeoutMs);
			const check = () => {
				const match = this.messages.find(predicate);
				if (!match) return;
				clearTimeout(timer);
				this.waiters.delete(check);
				resolveWait(match);
			};
			this.waiters.add(check);
		});
	}

	close() {
		this.socket.removeEventListener('message', this.onMessage);
		this.socket.close();
	}
}

async function fsyncPath(path) {
	const handle = await open(path, 'r+');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function atomicWriteJournal(path, value) {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
		flag: 'wx'
	});
	await fsyncPath(temporary);
	await rename(temporary, path);
	await fsyncPath(path);
	const readback = JSON.parse(await readFile(path, 'utf8'));
	if (JSON.stringify(readback) !== JSON.stringify(value)) {
		throw new Error('Journal readback tidak cocok');
	}
	return readback;
}

async function readJournal(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

export function createUatRtkRunner({ spawn = spawnSync } = {}) {
	return async (args, { cwd = REPO_ROOT, env = {}, secrets = {} } = {}) => {
		if (args[0] !== 'pnpm' || args[1] !== 'exec' || args[2] !== 'wrangler' || args[3] !== 'd1') {
			throw new Error('Child UAT ditolak: wajib RTK/Wrangler D1');
		}
		const operation = args[4];
		if (!['info', 'execute'].includes(operation)) {
			throw new Error('Child UAT ditolak oleh allowlist');
		}
		if (operation === 'execute') {
			const commandIndex = args.indexOf('--command');
			const sql = commandIndex >= 0 ? String(args[commandIndex + 1] ?? '') : '';
			if (
				!args.includes('--remote') ||
				!args.includes('--json') ||
				!/^SELECT\s+transaction_id,\s*id\s+FROM\s+buku_kas\s+WHERE\s+cabang_id\s*=\s*'[^']+'\s+AND\s+idempotency_key\s*=\s*'[^']+'\s+LIMIT\s+2;$/i.test(
					sql
				) ||
				/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA|ATTACH|REPLACE)\b/i.test(sql)
			) {
				throw new Error('SQL UAT ditolak: hanya SELECT fixed yang diizinkan');
			}
		}
		const result = spawn('rtk', args, {
			cwd,
			env,
			shell: false,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: MAX_CHILD_OUTPUT,
			windowsHide: true
		});
		const stdout = redactValues(result.stdout, secrets);
		const stderr = redactValues(result.stderr, secrets);
		if (result.error) throw new Error(redactValues(result.error.message, secrets));
		if (result.status !== 0) {
			throw new Error(`RTK/Wrangler UAT gagal (${result.status}): ${stderr.slice(0, 500)}`);
		}
		return { status: result.status, stdout, stderr };
	};
}

function fixedLookupSql(branch, idempotencyKey) {
	if (!BRANCH_BINDINGS[branch]) throw new Error('Branch lookup tidak diizinkan');
	if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
		throw new Error('Idempotency key lookup tidak valid');
	}
	return `SELECT transaction_id, id FROM buku_kas WHERE cabang_id = '${branch}' AND idempotency_key = '${idempotencyKey}' LIMIT 2;`;
}

export async function lookupByIdempotency({
	journal,
	config,
	runner,
	childEnv,
	secrets,
	repoRoot = REPO_ROOT
}) {
	const binding = BRANCH_BINDINGS[journal.branch];
	const database = config.find((entry) => entry.binding === binding);
	if (
		!database ||
		journal.configured_database_name !== database.name ||
		journal.configured_database_id !== database.id
	) {
		throw new Error('Identitas shard journal tidak cocok');
	}
	const info = await runner(
		['pnpm', 'exec', 'wrangler', 'd1', 'info', database.name, '--config', CONFIG_FILE, '--json'],
		{ cwd: repoRoot, env: childEnv, secrets }
	);
	parseAndVerifyInfo(info.stdout, database);
	const query = fixedLookupSql(journal.branch, journal.idempotency_key);
	const result = await runner(
		[
			'pnpm',
			'exec',
			'wrangler',
			'd1',
			'execute',
			database.name,
			'--config',
			CONFIG_FILE,
			'--remote',
			'--json',
			'--command',
			query
		],
		{ cwd: repoRoot, env: childEnv, secrets }
	);
	let parsed;
	try {
		parsed = JSON.parse(String(result.stdout).trim());
	} catch {
		throw new Error('Output lookup D1 bukan JSON valid');
	}
	const lookupRows =
		Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0]?.results)
			? parsed[0].results
			: rows(parsed);
	const found = lookupRows.map((entry) => ({
		transaction_id: String(entry.transaction_id ?? ''),
		id: String(entry.id ?? '')
	}));
	if (found.length > 1) throw new Error('Lookup D1 ambigu: lebih dari satu row');
	if (found.length === 1 && (!found[0].transaction_id || !found[0].id)) {
		throw new Error('Lookup D1 mengembalikan identity tidak lengkap');
	}
	return found[0] ?? null;
}

export function exactRealtimePredicate({ branch, transactionId, bukuKasId }) {
	return (message) =>
		message?.branch_id === branch &&
		message?.action === 'insert' &&
		((message?.table === 'transaksi_kasir' && message?.transaction_id === transactionId) ||
			(message?.table === 'buku_kas' &&
				(message?.transaction_id === transactionId || String(message?.id) === String(bukuKasId))));
}

async function cleanupJournal({
	journalPath,
	journal,
	owner,
	fetchImpl,
	baseUrl,
	config,
	runner,
	childEnv,
	secrets,
	repoRoot
}) {
	let current = journal;
	let lookup = null;
	if (!current.transaction_id) {
		lookup = await lookupByIdempotency({
			journal: current,
			config,
			runner,
			childEnv,
			secrets,
			repoRoot
		});
		if (lookup) {
			current = {
				...current,
				transaction_id: lookup.transaction_id,
				buku_kas_id: lookup.id,
				status: 'recovered'
			};
			await atomicWriteJournal(journalPath, current);
		}
	}
	let deleteStatus = null;
	if (current.transaction_id) {
		const deletion = await requestJson(
			fetchImpl,
			baseUrl,
			`/api/transaksi-kasir?transaction_id=${encodeURIComponent(current.transaction_id)}`,
			{ method: 'DELETE', auth: owner }
		);
		deleteStatus = deletion.status;
		if (!deletion.ok && deletion.status !== 404) {
			throw new Error(`Cleanup DELETE gagal: HTTP ${deletion.status}`);
		}
	}
	let transactionRows = [];
	let ledgerRows = [];
	if (current.transaction_id) {
		const [transactionCheck, ledgerCheck] = await Promise.all([
			requestJson(
				fetchImpl,
				baseUrl,
				`/api/transaksi-kasir?branch=${encodeURIComponent(current.branch)}&transaction_id=${encodeURIComponent(current.transaction_id)}&limit=2`,
				{ auth: owner }
			),
			requestJson(
				fetchImpl,
				baseUrl,
				`/api/buku-kas?branch=${encodeURIComponent(current.branch)}&transaction_id=${encodeURIComponent(current.transaction_id)}&limit=2`,
				{ auth: owner }
			)
		]);
		if (!transactionCheck.ok || !ledgerCheck.ok) {
			throw new Error('Cleanup verification API tidak definitif');
		}
		transactionRows = rows(transactionCheck.body);
		ledgerRows = rows(ledgerCheck.body);
	}
	const idempotencyResidue = await lookupByIdempotency({
		journal: current,
		config,
		runner,
		childEnv,
		secrets,
		repoRoot
	});
	if (transactionRows.length !== 0 || ledgerRows.length !== 0 || idempotencyResidue) {
		throw new Error('Cleanup gagal: residue production masih ada');
	}
	if (deleteStatus === 404 && (transactionRows.length || ledgerRows.length || idempotencyResidue)) {
		throw new Error('DELETE 404 tidak dapat diterima karena residue belum nol');
	}
	const cleaned = {
		...current,
		status: 'cleaned',
		cleaned_at: new Date().toISOString(),
		cleanup: {
			delete_status: deleteStatus,
			transaction_rows: 0,
			ledger_rows: 0,
			idempotency_rows: 0
		}
	};
	await atomicWriteJournal(journalPath, cleaned);
	return cleaned;
}

async function checkoutWithRecovery({
	fetchImpl,
	baseUrl,
	cashier,
	body,
	journal,
	journalPath,
	config,
	runner,
	childEnv,
	secrets,
	repoRoot
}) {
	let definitive = null;
	let ambiguous = false;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const result = await requestJson(fetchImpl, baseUrl, '/api/pos/transaction', {
				method: 'POST',
				auth: cashier,
				body
			});
			if (result.ok && result.body?.data?.transaction_id && result.body?.data?.buku_kas_id) {
				definitive = result.body.data;
				break;
			}
			if (result.status >= 500 || result.body === null) {
				ambiguous = true;
				continue;
			}
			throw new Error(`Checkout ditolak: HTTP ${result.status}`);
		} catch (error) {
			if (/Checkout ditolak/.test(String(error?.message))) throw error;
			ambiguous = true;
		}
	}
	if (!definitive && ambiguous) {
		const recovered = await lookupByIdempotency({
			journal,
			config,
			runner,
			childEnv,
			secrets,
			repoRoot
		});
		if (!recovered) throw new Error('Checkout ambigu dan lookup D1 tidak menemukan transaksi');
		definitive = { transaction_id: recovered.transaction_id, buku_kas_id: recovered.id };
	}
	if (!definitive) throw new Error('Checkout tidak menghasilkan identity definitif');
	const updated = {
		...journal,
		transaction_id: String(definitive.transaction_id),
		buku_kas_id: String(definitive.buku_kas_id),
		status: 'committed'
	};
	await atomicWriteJournal(journalPath, updated);
	return updated;
}

export async function runUat(
	inputOptions,
	{
		fetchImpl = fetch,
		socketFactory = openRawSocket,
		runner = createUatRtkRunner(),
		processEnv = process.env,
		configText,
		repoRoot = REPO_ROOT,
		workspaceRoot = WORKSPACE_ROOT,
		idempotencyFactory = () => `uat-live-${Date.now()}-${randomBytes(8).toString('hex')}`
	} = {}
) {
	const options = validateOptions(inputOptions);
	const secrets = await loadAllowlistedEnv(options.envFile, UAT_ENV_KEYS, { processEnv });
	requireSecrets(secrets);
	const childEnv = buildMinimalChildEnv(secrets, processEnv);
	const canonicalJournalDir = await canonicalizeExternalPath(options.journalDir, {
		repoRoot,
		workspaceRoot
	});
	await mkdir(canonicalJournalDir, { recursive: true, mode: 0o700 });
	await chmod(canonicalJournalDir, 0o700).catch(() => undefined);
	await canonicalizeExternalPath(canonicalJournalDir, {
		repoRoot,
		workspaceRoot,
		mustExist: true
	});
	const dirInfo = await stat(canonicalJournalDir);
	if (!dirInfo.isDirectory()) throw new Error('Journal path bukan directory');
	const journalPath = join(canonicalJournalDir, `uat-${options.branch}.json`);
	const config = validateD1Config(
		configText ?? (await readFile(resolve(repoRoot, CONFIG_FILE), 'utf8'))
	);
	const binding = BRANCH_BINDINGS[options.branch];
	const database = config.find((entry) => entry.binding === binding);
	if (!database) throw new Error('Shard branch tidak ditemukan');
	const existing = await readJournal(journalPath);
	if (existing && existing.status !== 'cleaned' && !options.cleanupOnly) {
		throw new Error(`Journal belum selesai; jalankan --cleanup-only untuk ${options.branch}`);
	}
	const cashierPassword = secrets.UAT_KASIR_PASSWORD || secrets.UAT_PASSWORD;
	const ownerPassword = secrets.UAT_OWNER_PASSWORD || secrets.UAT_PASSWORD;
	const cashierUsername = secrets.UAT_KASIR_USERNAME || 'kasir';
	const ownerUsername = secrets.UAT_OWNER_USERNAME || 'pemilik';
	let cashier;
	let owner;
	try {
		cashier = await login(
			fetchImpl,
			options.baseUrl,
			options.branch,
			cashierUsername,
			cashierPassword
		);
		owner = await login(fetchImpl, options.baseUrl, options.branch, ownerUsername, ownerPassword);
		if (cashier.user.role && cashier.user.role !== 'kasir')
			throw new Error('Role akun kasir tidak cocok');
		if (owner.user.role && owner.user.role !== 'pemilik')
			throw new Error('Role akun pemilik tidak cocok');
		if (options.cleanupOnly) {
			if (!existing || existing.status === 'cleaned')
				throw new Error('Tidak ada journal unresolved');
			const cleaned = await cleanupJournal({
				journalPath,
				journal: existing,
				owner,
				fetchImpl,
				baseUrl: options.baseUrl,
				config,
				runner,
				childEnv,
				secrets,
				repoRoot
			});
			return { ok: true, cleanupOnly: true, status: cleaned.status, journalPath };
		}
		const activeResult = await requestJson(
			fetchImpl,
			options.baseUrl,
			`/api/sesi-toko?branch=${encodeURIComponent(options.branch)}&is_active=true&limit=2`,
			{ auth: cashier }
		);
		if (!activeResult.ok) throw new Error(`Preflight sesi toko gagal: HTTP ${activeResult.status}`);
		const activeSessions = rows(activeResult.body);
		if (activeSessions.length !== 1) throw new HumanNeededError('active_store_session');
		const activeSessionId = String(activeSessions[0]?.id ?? '');
		if (!activeSessionId) throw new Error('Sesi toko aktif tidak memiliki ID');
		const productResult = await requestJson(
			fetchImpl,
			options.baseUrl,
			`/api/produk?branch=${encodeURIComponent(options.branch)}`,
			{ auth: cashier }
		);
		if (
			!productResult.ok ||
			!rows(productResult.body).some((product) => String(product?.id) === UAT_PRODUCT_ID)
		) {
			throw new Error('Produk UAT yang diizinkan tidak tersedia');
		}
		const rawSockets = await Promise.all([
			socketFactory({
				baseUrl: options.baseUrl,
				branch: options.branch,
				cookie: cashier.cookie,
				label: 'client-a'
			}),
			socketFactory({
				baseUrl: options.baseUrl,
				branch: options.branch,
				cookie: cashier.cookie,
				label: 'client-b'
			})
		]);
		const collectors = rawSockets.map(
			(socket, index) => new RealtimeCollector(socket, `client-${index + 1}`)
		);
		const idempotencyKey = idempotencyFactory();
		if (!IDEMPOTENCY_PATTERN.test(idempotencyKey))
			throw new Error('Generated idempotency key tidak valid');
		let journal = {
			base_url: options.baseUrl,
			branch: options.branch,
			configured_database_name: database.name,
			configured_database_id: database.id,
			idempotency_key: idempotencyKey,
			store_session_id: activeSessionId,
			status: 'pending',
			created_at: new Date().toISOString()
		};
		let journalCreated = false;
		try {
			journal = await atomicWriteJournal(journalPath, journal);
			journalCreated = true;
			const items = [{ product_id: UAT_PRODUCT_ID, jumlah: 1, add_on_ids: [] }];
			const quote = await requestJson(fetchImpl, options.baseUrl, '/api/pos/quote', {
				method: 'POST',
				auth: cashier,
				body: { items }
			});
			if (!quote.ok || !quote.body?.quote_token) {
				throw new Error(`Quote UAT gagal: HTTP ${quote.status}`);
			}
			const checkoutBody = {
				idempotency_key: idempotencyKey,
				nama_pelanggan: 'UAT Operasional',
				metode_bayar: 'tunai',
				cash_received: 10000,
				items,
				mode: 'online',
				quote_token: quote.body.quote_token
			};
			journal = await checkoutWithRecovery({
				fetchImpl,
				baseUrl: options.baseUrl,
				cashier,
				body: checkoutBody,
				journal,
				journalPath,
				config,
				runner,
				childEnv,
				secrets,
				repoRoot
			});
			const predicate = exactRealtimePredicate({
				branch: options.branch,
				transactionId: journal.transaction_id,
				bukuKasId: journal.buku_kas_id
			});
			await Promise.all(collectors.map((collector) => collector.waitFor(predicate)));
			journal = {
				...journal,
				status: 'realtime_verified',
				realtime_clients: 2,
				realtime_verified_at: new Date().toISOString()
			};
			await atomicWriteJournal(journalPath, journal);
			return {
				ok: true,
				status: 'passed',
				branch: options.branch,
				activeSessionId,
				realtimeClientsVerified: 2,
				journalPath
			};
		} finally {
			for (const collector of collectors) collector.close();
			if (journalCreated) {
				await cleanupJournal({
					journalPath,
					journal: (await readJournal(journalPath)) ?? journal,
					owner,
					fetchImpl,
					baseUrl: options.baseUrl,
					config,
					runner,
					childEnv,
					secrets,
					repoRoot
				});
			}
		}
	} finally {
		await Promise.allSettled([
			logout(fetchImpl, options.baseUrl, cashier),
			logout(fetchImpl, options.baseUrl, owner)
		]);
	}
}

function fakeHeaders(cookies = []) {
	return {
		getSetCookie: () => cookies,
		get: () => (cookies.length ? cookies.join(', ') : null)
	};
}

function fakeResponse(status, body, cookies = []) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: fakeHeaders(cookies),
		async json() {
			return body;
		}
	};
}

function createFakeSocket() {
	const listeners = new Map();
	return {
		addEventListener(type, callback) {
			const set = listeners.get(type) ?? new Set();
			set.add(callback);
			listeners.set(type, set);
		},
		removeEventListener(type, callback) {
			listeners.get(type)?.delete(callback);
		},
		emit(message) {
			for (const callback of listeners.get('message') ?? []) {
				callback({ data: JSON.stringify(message) });
			}
		},
		close() {}
	};
}

async function selfTestTemp() {
	const { mkdtemp, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const root = await mkdtemp(join(tmpdir(), 'zatiaras-uat-safety-'));
	const repo = join(root, 'workspace', 'repo');
	const external = join(root, 'external');
	await mkdir(repo, { recursive: true });
	await mkdir(external, { recursive: true });
	return {
		root,
		repo,
		workspace: join(root, 'workspace'),
		external,
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		}
	};
}

function selfTestConfig() {
	return JSON.stringify({
		d1_databases: [
			{
				binding: 'DB_SAMARINDA_GROUP',
				database_name: 'db-samarinda',
				database_id: '10000000-0000-4000-8000-000000000001'
			},
			{
				binding: 'DB_BALIKPAPAN_GROUP',
				database_name: 'db-balikpapan',
				database_id: '20000000-0000-4000-8000-000000000002'
			},
			{
				binding: 'DB_BERAU_GROUP',
				database_name: 'db-berau',
				database_id: '30000000-0000-4000-8000-000000000003'
			}
		]
	});
}

function fakeD1Runner({ rowsSequence = [], mismatch = false, capture = [] } = {}) {
	let lookupIndex = 0;
	return async (args, options) => {
		capture.push({ args, options });
		const operation = args[4];
		if (operation === 'info') {
			return {
				status: 0,
				stderr: '',
				stdout: JSON.stringify({
					name: mismatch ? 'wrong' : 'db-samarinda',
					uuid: '10000000-0000-4000-8000-000000000001',
					version: 'production'
				})
			};
		}
		const result = rowsSequence[Math.min(lookupIndex, rowsSequence.length - 1)] ?? [];
		lookupIndex += 1;
		return { status: 0, stderr: '', stdout: JSON.stringify([{ results: result }]) };
	};
}

function makeFakeFetch({
	activeSessions = [{ id: 'session-1' }],
	checkoutMode = 'success',
	deleteStatus = 200,
	transactionResidue = [],
	ledgerResidue = [],
	onCheckout,
	onRequest
} = {}) {
	return async (url, init = {}) => {
		const parsed = new URL(url);
		const method = String(init.method ?? 'GET').toUpperCase();
		onRequest?.({ url: parsed, method, init });
		if (parsed.pathname === '/api/csrf') {
			return fakeResponse(200, { token: 'csrf-safe-test' }, ['zatiaras_csrf=c']);
		}
		if (parsed.pathname === '/api/veriflogin') {
			const username = JSON.parse(init.body).username;
			return fakeResponse(
				200,
				{ success: true, user: { username, role: username === 'kasir' ? 'kasir' : 'pemilik' } },
				[`zatiaras_sid=${username}`]
			);
		}
		if (parsed.pathname === '/api/logout') return fakeResponse(200, { success: true });
		if (parsed.pathname === '/api/sesi-toko') return fakeResponse(200, activeSessions);
		if (parsed.pathname === '/api/produk') return fakeResponse(200, [{ id: UAT_PRODUCT_ID }]);
		if (parsed.pathname === '/api/pos/quote')
			return fakeResponse(200, { quote_token: 'quote-safe' });
		if (parsed.pathname === '/api/pos/transaction') {
			onCheckout?.();
			if (checkoutMode === 'network') throw new Error('network ambiguous');
			if (checkoutMode === 'server') return fakeResponse(503, null);
			return fakeResponse(200, {
				ok: true,
				data: { transaction_id: 'tx-1', buku_kas_id: 'ledger-1' }
			});
		}
		if (parsed.pathname === '/api/transaksi-kasir' && method === 'DELETE') {
			return fakeResponse(
				deleteStatus,
				deleteStatus === 404 ? { error: 'not found' } : { ok: true }
			);
		}
		if (parsed.pathname === '/api/transaksi-kasir') return fakeResponse(200, transactionResidue);
		if (parsed.pathname === '/api/buku-kas') return fakeResponse(200, ledgerResidue);
		throw new Error(`Unexpected fake request: ${method} ${parsed.pathname}`);
	};
}

async function assertMissingCredentialFailsBeforePreflight() {
	const box = await selfTestTemp();
	let requests = 0;
	try {
		await assert.rejects(
			() =>
				runUat(
					{
						live: true,
						baseUrl: 'https://example.test',
						branch: 'samarinda',
						journalDir: box.external
					},
					{
						fetchImpl: async () => {
							requests += 1;
							throw new Error('network must not run');
						},
						processEnv: { UAT_PASSWORD: 'p' },
						configText: selfTestConfig(),
						repoRoot: box.repo,
						workspaceRoot: box.workspace
					}
				),
			/CLOUDFLARE_API_TOKEN/
		);
		assert.equal(requests, 0);
	} finally {
		await box.cleanup();
	}
}

async function assertActiveSessionFailClosed(activeSessions) {
	const box = await selfTestTemp();
	let checkoutCalls = 0;
	try {
		await assert.rejects(
			() =>
				runUat(
					{
						live: true,
						baseUrl: 'https://example.test',
						branch: 'samarinda',
						journalDir: box.external
					},
					{
						fetchImpl: makeFakeFetch({
							activeSessions,
							onCheckout: () => {
								checkoutCalls += 1;
							}
						}),
						processEnv: {
							UAT_PASSWORD: 'p',
							CLOUDFLARE_API_TOKEN: 't',
							CLOUDFLARE_ACCOUNT_ID: 'a'
						},
						configText: selfTestConfig(),
						repoRoot: box.repo,
						workspaceRoot: box.workspace
					}
				),
			/human_needed: active_store_session/
		);
		assert.equal(checkoutCalls, 0);
		assert.equal(await readJournal(join(box.external, 'uat-samarinda.json')), null);
	} finally {
		await box.cleanup();
	}
}

async function assertFullFakeRunAndExactRealtime() {
	const box = await selfTestTemp();
	const sockets = [createFakeSocket(), createFakeSocket()];
	const socketQueue = [...sockets];
	let emitted = false;
	const calls = [];
	try {
		const resultPromise = runUat(
			{
				live: true,
				baseUrl: 'https://example.test',
				branch: 'samarinda',
				journalDir: box.external
			},
			{
				fetchImpl: makeFakeFetch({
					onCheckout() {
						const journalPath = join(box.external, 'uat-samarinda.json');
						readJournal(journalPath).then((journal) => {
							assert.equal(journal.status, 'pending');
							for (const socket of sockets) {
								socket.emit({
									branch_id: 'samarinda',
									table: 'buku_kas',
									action: 'insert',
									transaction_id: 'unrelated'
								});
								socket.emit({
									branch_id: 'samarinda',
									table: 'buku_kas',
									action: 'insert',
									id: 'ledger-1',
									transaction_id: 'tx-1'
								});
							}
							emitted = true;
						});
					}
				}),
				socketFactory: async () => socketQueue.shift(),
				runner: fakeD1Runner({ rowsSequence: [[], []], capture: calls }),
				processEnv: {
					PATH: 'safe-path',
					UNRELATED_SECRET: 'must-not-inherit',
					UAT_PASSWORD: 'p',
					CLOUDFLARE_API_TOKEN: 't',
					CLOUDFLARE_ACCOUNT_ID: 'a'
				},
				configText: selfTestConfig(),
				repoRoot: box.repo,
				workspaceRoot: box.workspace,
				idempotencyFactory: () => 'uat-live-1700000000000-0123456789abcdef'
			}
		);
		const result = await resultPromise;
		assert.equal(result.ok, true);
		assert.equal(emitted, true);
		const journal = await readJournal(join(box.external, 'uat-samarinda.json'));
		assert.equal(journal.status, 'cleaned');
		for (const call of calls) {
			assert.equal(Object.hasOwn(call.options.env, 'UNRELATED_SECRET'), false);
			assert.deepEqual(
				Object.keys(call.options.env)
					.filter((key) => UAT_ENV_KEYS.includes(key))
					.sort(),
				['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'UAT_PASSWORD']
			);
		}
	} finally {
		await box.cleanup();
	}
}

async function assertAmbiguousRecoveryAndIdentityMismatch() {
	const box = await selfTestTemp();
	try {
		const journal = {
			branch: 'samarinda',
			configured_database_name: 'db-samarinda',
			configured_database_id: '10000000-0000-4000-8000-000000000001',
			idempotency_key: 'uat-live-1700000000000-0123456789abcdef'
		};
		const config = validateD1Config(selfTestConfig());
		const recovered = await lookupByIdempotency({
			journal,
			config,
			runner: fakeD1Runner({
				rowsSequence: [[{ transaction_id: 'tx-1', id: 'ledger-1' }]]
			}),
			childEnv: {},
			secrets: {},
			repoRoot: box.repo
		});
		assert.deepEqual(recovered, { transaction_id: 'tx-1', id: 'ledger-1' });
		await assert.rejects(
			() =>
				lookupByIdempotency({
					journal,
					config,
					runner: fakeD1Runner({ mismatch: true }),
					childEnv: {},
					secrets: {},
					repoRoot: box.repo
				}),
			/identitas|Identitas/i
		);
	} finally {
		await box.cleanup();
	}
}

async function assertCleanupOnlyWithoutTransactionAnd404ResidueRules() {
	const box = await selfTestTemp();
	const options = {
		live: true,
		cleanupOnly: true,
		baseUrl: 'https://example.test',
		branch: 'samarinda',
		journalDir: box.external
	};
	const processEnv = {
		UAT_PASSWORD: 'p',
		CLOUDFLARE_API_TOKEN: 't',
		CLOUDFLARE_ACCOUNT_ID: 'a'
	};
	const journalPath = join(box.external, 'uat-samarinda.json');
	const baseJournal = {
		base_url: options.baseUrl,
		branch: options.branch,
		configured_database_name: 'db-samarinda',
		configured_database_id: '10000000-0000-4000-8000-000000000001',
		idempotency_key: 'uat-live-1700000000000-0123456789abcdef',
		status: 'pending'
	};
	try {
		await atomicWriteJournal(journalPath, baseJournal);
		const clean = await runUat(options, {
			fetchImpl: makeFakeFetch(),
			runner: fakeD1Runner({ rowsSequence: [[], []] }),
			processEnv,
			configText: selfTestConfig(),
			repoRoot: box.repo,
			workspaceRoot: box.workspace
		});
		assert.equal(clean.status, 'cleaned');
		await atomicWriteJournal(journalPath, { ...baseJournal, transaction_id: 'tx-1' });
		const accepted404 = await runUat(options, {
			fetchImpl: makeFakeFetch({ deleteStatus: 404 }),
			runner: fakeD1Runner({ rowsSequence: [[]] }),
			processEnv,
			configText: selfTestConfig(),
			repoRoot: box.repo,
			workspaceRoot: box.workspace
		});
		assert.equal(accepted404.status, 'cleaned');
		await atomicWriteJournal(journalPath, { ...baseJournal, transaction_id: 'tx-1' });
		await assert.rejects(
			() =>
				runUat(options, {
					fetchImpl: makeFakeFetch({ deleteStatus: 404, ledgerResidue: [{ id: 'ledger-1' }] }),
					runner: fakeD1Runner({ rowsSequence: [[]] }),
					processEnv,
					configText: selfTestConfig(),
					repoRoot: box.repo,
					workspaceRoot: box.workspace
				}),
			/residue/
		);
		const retained = await readJournal(journalPath);
		assert.notEqual(retained.status, 'cleaned');
	} finally {
		await box.cleanup();
	}
}

export async function runSelfTest() {
	const safePredicate = exactRealtimePredicate({
		branch: 'samarinda',
		transactionId: 'tx-1',
		bukuKasId: 'ledger-1'
	});
	assert.equal(
		safePredicate({
			branch_id: 'samarinda',
			table: 'buku_kas',
			action: 'insert',
			transaction_id: 'other'
		}),
		false
	);
	assert.equal(
		safePredicate({
			branch_id: 'samarinda',
			table: 'buku_kas',
			action: 'insert',
			id: 'ledger-1'
		}),
		true
	);
	const spawnCapture = [];
	const uatRunner = createUatRtkRunner({
		spawn(command, args, options) {
			spawnCapture.push({ command, args, options });
			return { status: 0, stdout: '{}', stderr: '' };
		}
	});
	await uatRunner(
		['pnpm', 'exec', 'wrangler', 'd1', 'info', 'db', '--config', CONFIG_FILE, '--json'],
		{}
	);
	assert.equal(spawnCapture[0].command, 'rtk');
	assert.equal(spawnCapture[0].options.shell, false);
	await assert.rejects(
		() =>
			uatRunner([
				'pnpm',
				'exec',
				'wrangler',
				'd1',
				'execute',
				'db',
				'--remote',
				'--json',
				'--command',
				'DELETE FROM buku_kas'
			]),
		/hanya SELECT/
	);
	await assertMissingCredentialFailsBeforePreflight();
	await assertActiveSessionFailClosed([]);
	await assertActiveSessionFailClosed([{ id: 'a' }, { id: 'b' }]);
	await assertFullFakeRunAndExactRealtime();
	await assertAmbiguousRecoveryAndIdentityMismatch();
	await assertCleanupOnlyWithoutTransactionAnd404ResidueRules();
	console.log('PASS UAT live safety self-test');
}

export async function main(argv = process.argv.slice(2)) {
	const options = parseCliArgs(argv);
	if (options.selfTest) {
		await runSelfTest();
		return;
	}
	const secrets = await loadAllowlistedEnv(options.envFile, UAT_ENV_KEYS);
	const safeSecrets = secrets;
	try {
		const result = await runUat(options);
		console.log(
			`PASS live UAT: branch=${result.branch ?? options.branch} realtime=2 cleanup=verified`
		);
	} catch (error) {
		const message = redactValues(
			error instanceof Error ? error.message : String(error),
			safeSecrets
		);
		if (error?.code === 'HUMAN_NEEDED') {
			console.error(message);
			console.error(
				`Resume setelah tepat satu sesi toko aktif: rtk node scripts/uat-live-realtime.mjs --live --base-url ${options.baseUrl} --branch ${options.branch} --env-file ${options.envFile} --journal-dir ${options.journalDir}`
			);
			process.exitCode = 2;
			return;
		}
		console.error(`FAILED: ${message}`);
		if (options.journalDir && options.branch) {
			console.error(
				`Cleanup aman: rtk node scripts/uat-live-realtime.mjs --live --cleanup-only --base-url ${options.baseUrl} --branch ${options.branch} --env-file ${options.envFile} --journal-dir ${options.journalDir}`
			);
		}
		process.exitCode = 1;
	}
}

const isCli =
	process.argv[1] &&
	normalizeForCompare(MODULE_FILE) === normalizeForCompare(resolve(process.argv[1]));
if (isCli) {
	main().catch((error) => {
		console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
