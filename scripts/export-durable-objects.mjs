import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = resolve(root, '.svelte-kit/cloudflare/_worker.js');
const interceptMarker = '// ZATIARAS_REALTIME_WORKER_INTERCEPT';
const interceptCode = `${interceptMarker}
const ZATIARAS_REALTIME_BRANCHES = new Set([
  'samarinda',
  'samarinda2',
  'balikpapan',
  'balikpapan2',
  'berau'
]);

function zatiarasRealtimeJson(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function zatiarasRealtimeBranch(req) {
  const url = new URL(req.url);
  const branch = (url.searchParams.get('branch') || '').trim().toLowerCase();
  return ZATIARAS_REALTIME_BRANCHES.has(branch) ? branch : null;
}

function zatiarasCookie(req, name) {
  const cookie = req.headers.get('cookie') || '';
  const target = name + '=';
  for (const part of cookie.split(';')) {
    const value = part.trim();
    if (value.startsWith(target)) return decodeURIComponent(value.slice(target.length));
  }
  return '';
}

function zatiarasSessionBranch(sessionId) {
  const separator = sessionId.indexOf('.');
  if (separator <= 0) return null;
  const branch = sessionId.slice(0, separator);
  return ZATIARAS_REALTIME_BRANCHES.has(branch) ? branch : null;
}

function zatiarasDbForBranch(env, branch) {
  if (branch === 'samarinda' || branch === 'samarinda2') return env.DB_SAMARINDA_GROUP || env.DB;
  if (branch === 'balikpapan' || branch === 'balikpapan2') return env.DB_BALIKPAPAN_GROUP || env.DB;
  if (branch === 'berau') return env.DB_BERAU_GROUP || env.DB;
  return null;
}

async function zatiarasHasRealtimeSession(req, env, branch) {
  const sessionId = zatiarasCookie(req, 'zatiaras_sid');
  if (!sessionId || zatiarasSessionBranch(sessionId) !== branch) return false;

  const db = zatiarasDbForBranch(env, branch);
  if (!db) throw new Error('Database binding tidak tersedia');

  const row = await db
    .prepare(
      'SELECT id FROM auth_sessions WHERE id = ? AND cabang_id = ? AND expires_at > ? LIMIT 1'
    )
    .bind(sessionId, branch, Date.now())
    .first();
  return Boolean(row);
}

async function zatiarasHandleRealtime(req, env) {
  const url = new URL(req.url);
  if (url.pathname !== '/api/realtime') return null;
  if (req.method !== 'GET') {
    return zatiarasRealtimeJson({ error: 'Method not allowed' }, 405);
  }

  const branch = zatiarasRealtimeBranch(req);
  if (!branch) {
    return zatiarasRealtimeJson({ error: 'Branch tidak valid' }, 400);
  }

  try {
    const hasSession = await zatiarasHasRealtimeSession(req, env, branch);
    if (!hasSession) return zatiarasRealtimeJson({ error: 'Login diperlukan' }, 401);
  } catch (error) {
    return zatiarasRealtimeJson({ error: error.message || 'Session realtime gagal' }, 503);
  }

  const hub = env.REALTIME_HUB;
  if (!hub) {
    return zatiarasRealtimeJson({ error: 'Realtime Durable Object binding tidak tersedia' }, 503);
  }

  const targetUrl = new URL(req.url);
  targetUrl.pathname = '/connect';
  targetUrl.search = '';
  const id = hub.idFromName(branch);
  return hub.get(id).fetch(new Request(targetUrl, req));
}
`;

async function main() {
	let worker = await readFile(workerPath, 'utf8');
	if (!worker.includes(interceptMarker)) {
		const insertionPoint = 'var worker_default = {';
		if (!worker.includes(insertionPoint)) {
			throw new Error(`Could not find worker insertion point: ${insertionPoint}`);
		}
		worker = worker.replace(insertionPoint, `${interceptCode}\n${insertionPoint}`);
	}

	if (!worker.includes('const realtimeResponse = await zatiarasHandleRealtime(req, env2);')) {
		const fetchInsertionPoint =
			'await initialized;\n    let pragma = req.headers.get("cache-control") || "";';
		if (!worker.includes(fetchInsertionPoint)) {
			throw new Error(`Could not find realtime fetch insertion point`);
		}
		worker = worker.replace(
			fetchInsertionPoint,
			`await initialized;
    const realtimeResponse = await zatiarasHandleRealtime(req, env2);
    if (realtimeResponse) return realtimeResponse;
    let pragma = req.headers.get("cache-control") || "";`
		);
	}

	await writeFile(workerPath, worker);
}

main().catch((error) => {
	console.error('[durable-object-export] failed:', error);
	process.exit(1);
});
