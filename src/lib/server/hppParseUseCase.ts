import { callAiChat, OPENROUTER_API_URL, type AiChatMessage } from '$lib/server/aiGateway';
import { consumeRateLimit } from '$lib/server/rateLimit';
import { parseHppModelResponse, type HppParsedPurchase } from '$lib/utils/hppParse';
import { normalizeBranch, getD1Database, type BranchId } from '$lib/server/branchResolver';
import type { D1Database } from '@cloudflare/workers-types';

const HPP_MODEL = 'deepseek/deepseek-chat';
const HPP_MAX_TEXT = 2000;
const HPP_RATE_LIMIT = 20;
const HPP_RATE_WINDOW_MS = 10 * 60 * 1000;

export type HppParseErrorCode =
	'EMPTY_TEXT' | 'RATE_LIMITED' | 'RATE_LIMITER_UNAVAILABLE' | 'UPSTREAM_ERROR' | 'EMPTY_RESULT';

export class HppParseError extends Error {
	readonly code: HppParseErrorCode;
	readonly retryAfterSeconds?: number;

	constructor(code: HppParseErrorCode, message: string, retryAfterSeconds?: number) {
		super(message);
		this.name = 'HppParseError';
		this.code = code;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

export interface HppParseSession {
	userId: string;
	role: string;
	branch: string;
}

export interface HppParseDeps {
	rawDb: D1Database;
	session: HppParseSession;
	text: string;
	apiKey: string;
	platform?: App.Platform;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

/**
 * Parse cerita belanja via gateway AI kanonik (AUD-035).
 * Batas laju per-user menolak SEBELUM upstream; timeout/malformed
 * ikut kontrak gateway; hasil malformed = EMPTY_RESULT (422 di route).
 */
export async function parseHppText(deps: HppParseDeps): Promise<HppParsedPurchase[]> {
	const text = String(deps.text || '')
		.trim()
		.slice(0, HPP_MAX_TEXT);
	if (!text) {
		throw new HppParseError('EMPTY_TEXT', 'Teks belanja kosong.');
	}

	const branch = normalizeBranch(deps.session.branch);
	const userKey = `hpp:parse:user:${
		String(deps.session.userId || '')
			.trim()
			.toLowerCase() || 'unknown'
	}`;
	const limit = await consumeRateLimit(
		deps.rawDb,
		branch,
		userKey,
		HPP_RATE_LIMIT,
		HPP_RATE_WINDOW_MS,
		deps.platform
	);
	if (!limit.available) {
		throw new HppParseError(
			'RATE_LIMITER_UNAVAILABLE',
			'Perubahan keamanan sementara tidak tersedia. Coba lagi beberapa saat.'
		);
	}
	if (!limit.allowed) {
		throw new HppParseError(
			'RATE_LIMITED',
			'Terlalu banyak percobaan. Coba lagi nanti.',
			limit.retryAfterSeconds
		);
	}

	const messages: AiChatMessage[] = [
		{
			role: 'system',
			content:
				'Anda membantu owner Zatiaras Juice menghitung HPP dari cerita belanja mingguan. Parse cerita natural menjadi JSON array bahan. Unit output hanya gram, ml, pcs, buah. Konversi kg ke gram dan liter ke ml. purchase_qty adalah kuantitas jumlah dasar setelah konversi. purchase_cost adalah total harga beli bahan itu. biaya_per_satuan = purchase_cost / purchase_qty. Field wajib: nama, satuan, purchase_qty, purchase_cost, biaya_per_satuan. Contoh: [{"nama":"Gula Pasir","satuan":"gram","purchase_qty":1000,"purchase_cost":20000,"biaya_per_satuan":20}]. Jika ada item ambigu, tetap ambil yang jelas saja. Return JSON array saja tanpa markdown.'
		},
		{ role: 'user', content: text }
	];

	let content: string;
	try {
		content = await callAiChat(
			deps.apiKey,
			OPENROUTER_API_URL,
			messages,
			{
				title: 'Zatiaras POS - HPP Parse',
				maxTokens: 800,
				temperature: 0.1,
				model: HPP_MODEL,
				fallbacks: [],
				errorLabel: 'HPP Parse Error',
				timeoutMs: deps.timeoutMs,
				clientSignal: null
			},
			deps.fetchImpl ?? fetch
		);
	} catch (error) {
		throw new HppParseError(
			'UPSTREAM_ERROR',
			'AI gagal membaca cerita belanja. Coba tulis lebih jelas atau input manual.'
		);
	}

	const items = parseHppModelResponse(content);
	if (!items.length) {
		throw new HppParseError(
			'EMPTY_RESULT',
			'AI belum menemukan bahan yang jelas dari cerita belanja.'
		);
	}
	return items;
}

export function hppBranchDb(
	env: Record<string, unknown> | undefined,
	sessionBranch: unknown
): { rawDb: D1Database; branch: BranchId } {
	const branch = normalizeBranch(sessionBranch);
	return { rawDb: getD1Database(env, branch), branch };
}
