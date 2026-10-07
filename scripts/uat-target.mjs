/**
 * Guard URL target UAT bermutasi (AUD-048) — dipakai bersama CLI UAT lokal.
 *
 * Prefix `startsWith('http://localhost')` menerima `localhost.audit.invalid`,
 * `127.0.0.1.evil`, dan userinfo (`http://127.0.0.1@evil/`) sebagai "lokal"
 * lalu mengirim kredensial keluar. Guard ini parse URL dan hanya mengizinkan
 * hostname loopback EXACT, menolak userinfo/skema asing/lookalike SEBELUM
 * password dibaca atau fetch dilakukan. Redirect credential-bearing selalu
 * `error` agar kredensial tak pindah host.
 */

/** Hostname loopback yang diizinkan untuk http (URL menormalisasi case). */
export const UAT_LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1', 'localhost']);

/**
 * Validasi target UAT. Kembalikan { baseUrl, local }.
 * `allowRemote=true` (ALLOW_REMOTE_UAT=1 eksplisit) mengizinkan https non-loopback.
 */
export function resolveUatTarget(raw, { allowRemote = false } = {}) {
	let url;
	try {
		url = new URL(String(raw ?? ''));
	} catch {
		throw new Error(`Target UAT tidak valid: ${String(raw ?? '').slice(0, 80)}`);
	}
	if (url.username || url.password)
		throw new Error('Target UAT mengandung userinfo: ditolak tanpa akses kredensial.');
	// hostname IPv6 datang berkurung ([::1]) — normalisasi dulu.
	const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
	if (url.protocol === 'http:') {
		if (!UAT_LOOPBACK_HOSTS.includes(host))
			throw new Error(
				`Target UAT http harus loopback exact (127.0.0.1/::1/localhost): ${url.hostname}`
			);
		return { baseUrl: url.origin, local: true };
	}
	if (url.protocol === 'https:' && allowRemote) return { baseUrl: url.origin, local: false };
	throw new Error(
		'Target UAT mutasi hanya loopback http, atau https dengan otorisasi remote eksplisit.'
	);
}

/** Fetch credential-bearing tanpa mengikuti redirect (fail-closed). */
export function uatFetch(input, init = {}) {
	return fetch(input, { ...init, redirect: 'error' });
}
