import { json, error as kitError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAnyRole, requireAuthSession } from '$lib/server/apiAuth';
import { parseHppModelResponse, type HppParsedPurchase } from '$lib/utils/hppParse';
import type { RequestHandler } from './$types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-chat';

async function parseWithAi(text: string, apiKey: string): Promise<HppParsedPurchase[]> {
	const response = await fetch(OPENROUTER_API_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://zatiaraspos.com',
			'X-Title': 'Zatiaras POS'
		},
		body: JSON.stringify({
			model: MODEL,
			messages: [
				{
					role: 'system',
					content:
						'Anda membantu owner Zatiaras Juice menghitung HPP dari cerita belanja mingguan. Parse cerita natural menjadi JSON array bahan. Unit output hanya gram, ml, pcs, buah. Konversi kg ke gram dan liter ke ml. purchase_qty adalah kuantitas jumlah dasar setelah konversi. purchase_cost adalah total harga beli bahan itu. biaya_per_satuan = purchase_cost / purchase_qty. Field wajib: nama, satuan, purchase_qty, purchase_cost, biaya_per_satuan. Contoh: [{"nama":"Gula Pasir","satuan":"gram","purchase_qty":1000,"purchase_cost":20000,"biaya_per_satuan":20}]. Jika ada item ambigu, tetap ambil yang jelas saja. Return JSON array saja tanpa markdown.'
				},
				{ role: 'user', content: text }
			],
			temperature: 0.1,
			max_tokens: 800
		})
	});
	if (!response.ok) throw new Error(`AI parse failed ${response.status}`);
	const data = await response.json();
	const content = String(data?.choices?.[0]?.message?.content || '[]');
	return parseHppModelResponse(content);
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik']);
	const body = (await request.json().catch(() => null)) as { text?: string } | null;
	const text = String(body?.text || '')
		.trim()
		.slice(0, 2000);
	if (!text) return json({ ok: true, source: 'ai', items: [] });

	const apiKey =
		((platform?.env as Record<string, unknown> | undefined)?.OPENROUTER_API_KEY as string) ||
		env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw kitError(503, 'AI belum aktif. Isi OPENROUTER_API_KEY atau input bahan manual.');
	}

	const items = await parseWithAi(text, apiKey).catch(() => {
		throw kitError(
			502,
			'AI gagal membaca cerita belanja. Coba tulis lebih jelas atau input manual.'
		);
	});
	if (!items.length) {
		throw kitError(422, 'AI belum menemukan bahan yang jelas dari cerita belanja.');
	}

	return json({ ok: true, source: 'ai', items });
};
