import { json, error as kitError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAnyRole, requireAuthSession } from '$lib/server/apiAuth';
import type { RequestHandler } from './$types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-chat';

type ParsedPurchase = {
	nama: string;
	satuan: 'gram' | 'ml' | 'pcs' | 'buah';
	purchase_qty: number;
	purchase_cost: number;
	biaya_per_satuan: number;
};

function normalizeUnit(satuan: string): { satuan: ParsedPurchase['satuan']; multiplier: number } {
	const normalized = satuan.toLowerCase();
	if (['kg', 'kilo', 'kilogram'].includes(normalized)) return { satuan: 'gram', multiplier: 1000 };
	if (['g', 'gr', 'gram'].includes(normalized)) return { satuan: 'gram', multiplier: 1 };
	if (['l', 'liter'].includes(normalized)) return { satuan: 'ml', multiplier: 1000 };
	if (['ml', 'mili', 'mililiter'].includes(normalized)) return { satuan: 'ml', multiplier: 1 };
	if (['buah'].includes(normalized)) return { satuan: 'buah', multiplier: 1 };
	return { satuan: 'pcs', multiplier: 1 };
}

function normalizeName(value: string): string {
	return value
		.replace(/\b(beli|belanja|stok|harga|rp)\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
}

async function parseWithAi(text: string, apiKey: string): Promise<ParsedPurchase[]> {
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
						'Anda membantu owner Zatiaras Juice menghitung HPP dari cerita belanja mingguan. Parse cerita natural menjadi JSON array bahan. Unit output hanya gram, ml, pcs, buah. Konversi kg ke gram dan liter ke ml. purchase_qty adalah kuantitas setelah konversi. purchase_cost adalah total harga beli bahan itu. biaya_per_satuan = purchase_cost / purchase_qty. Field wajib: name, satuan, purchase_qty, purchase_cost, biaya_per_satuan. Jika ada item ambigu, tetap ambil yang jelas saja. Return JSON array saja tanpa markdown.'
				},
				{ role: 'user', content: text }
			],
			temperature: 0.1,
			max_tokens: 800
		})
	});
	if (!response.ok) throw new Error(`AI parse failed ${response.status}`);
	const data = await response.json();
	const content = String(data?.choices?.[0]?.message?.content || '[]')
		.replace(/^```json/i, '')
		.replace(/^```/i, '')
		.replace(/```$/i, '')
		.trim();
	const parsed = JSON.parse(content);
	if (!Array.isArray(parsed)) return [];
	return parsed
		.map((item) => {
			const satuan = normalizeUnit(String(item.satuan || 'pcs')).satuan;
			const purchaseQty = Number(item.purchase_qty || 0);
			const purchaseCost = Number(item.purchase_cost || 0);
			return {
				nama: normalizeName(String(item.nama || '')),
				satuan,
				purchase_qty: purchaseQty,
				purchase_cost: purchaseCost,
				biaya_per_satuan:
					Number(item.biaya_per_satuan || 0) ||
					(purchaseQty > 0 ? Math.round((purchaseCost / purchaseQty) * 100) / 100 : 0)
			};
		})
		.filter((item) => item.nama && item.purchase_qty > 0 && item.purchase_cost > 0);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik']);
	const body = (await request.json().catch(() => null)) as { text?: string } | null;
	const text = String(body?.text || '')
		.trim()
		.slice(0, 2000);
	if (!text) return json({ ok: true, source: 'ai', items: [] });

	const apiKey = env.OPENROUTER_API_KEY;
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
