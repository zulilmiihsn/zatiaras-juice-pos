/**
 * Helper teks murni untuk asisten AI: ekstraksi JSON, klasifikasi pertanyaan,
 * format tanggal, dan sanitasi riwayat chat. Tanpa I/O.
 */

import { resolveAiPeriod, hasPeriodQualifier, detectAiIntent } from '../aiPeriod';
import { parseDataRequirements, type DataRequirements } from './prompts';
import type { AiChatMessage as ChatMessage } from '../aiGateway';

/** Bersihkan markdown code-fence atau teks percakapan dan ekstrak object JSON murni. */
export function extractJsonFromText(content: string): string {
	let clean = content.trim();
	const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	if (fenceMatch) {
		clean = fenceMatch[1].trim();
	}
	const firstBrace = clean.indexOf('{');
	const lastBrace = clean.lastIndexOf('}');
	if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
		clean = clean.slice(firstBrace, lastBrace + 1).trim();
	}
	return clean;
}

/** Format YYYY-MM-DD dalam zona waktu WITA (UTC+8). */
export function toYMDWita(date: Date): string {
	const utcTime = date.getTime();
	const witaTime = new Date(utcTime + 8 * 60 * 60 * 1000);
	return witaTime.toISOString().slice(0, 10);
}

/**
 * Fast-path intent & date resolver (F27): periode eksplisit dulu, lalu intent.
 * Ambigu/tak dikenali -> null agar analyzer lanjutan dipakai.
 */
export function fastResolveRequirements(
	question: string,
	todayWita: string
): DataRequirements | null {
	const q = question.toLowerCase().trim();
	const period = resolveAiPeriod(q, todayWita);
	if (hasPeriodQualifier(q) && !period) return null;
	const intent = detectAiIntent(q);
	if (!intent) return null;
	const resolved = period ?? {
		start: `${todayWita.slice(0, 7)}-01`,
		end: todayWita,
		type: 'monthly' as const
	};
	try {
		return parseDataRequirements(
			{
				periode: resolved,
				jenisData: intent.jenisData,
				prioritas: intent.prioritas,
				scope: intent.scope
			},
			todayWita
		);
	} catch {
		return null;
	}
}

/** Deteksi apakah pertanyaan memerlukan riset eksternal ke web/internet */
export function isWebSearchRequested(question: string): boolean {
	const q = question.toLowerCase();
	const keywords = [
		'browsing',
		'browse',
		'internet',
		'cari di web',
		'cari di internet',
		'cari di google',
		'googling',
		'search',
		'tren',
		'trend',
		'viral',
		'hits',
		'kompetitor',
		'pesaing',
		'pasaran',
		'harga pasar',
		'tiktok',
		'instagram',
		'sosmed',
		'media sosial',
		'resep baru',
		'ide menu baru',
		'kekinian'
	];
	return keywords.some((kw) => q.includes(kw));
}

/** Deteksi apakah pertanyaan merupakan konsultasi strategi/edukasi bisnis FnB */
export function isStrategicQuestion(question: string): boolean {
	const q = question.toLowerCase();
	const keywords = [
		'strategi',
		'taktik',
		'tips',
		'rekomendasi',
		'psikologi',
		'decoy',
		'anchoring',
		'bundling',
		'charm pricing',
		'menu engineering',
		'cara',
		'harus apa',
		'apa yang harus',
		'saran',
		'menurutmu',
		'pendapatmu',
		'gimana',
		'bagaimana',
		'maju',
		'laris',
		'ramai',
		'sepi',
		'kaya',
		'sukses',
		'tingkatkan',
		'kembangkan',
		'evaluasi',
		'solusi',
		'ide',
		'bantu',
		'digital marketing',
		'local seo',
		'reciprocity',
		'loss aversion',
		'promosi'
	];
	return keywords.some((kw) => q.includes(kw));
}

/** Deteksi apakah pertanyaan seputar stok/inventaris bahan baku */
export function isInventoryQuestion(question: string): boolean {
	const q = question.toLowerCase();
	const keywords = [
		'stok',
		'bahan',
		'sisa buah',
		'buah habis',
		'ambang stok',
		'restok',
		'persediaan'
	];
	return keywords.some((kw) => q.includes(kw));
}

/** Format tanggal untuk prompt AI (locale id-ID, deterministik input -> output). */
export function formatDateForAI(dateStr: string): string {
	const parts = dateStr.split('-');
	const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
	return date.toLocaleDateString('id-ID', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

/** Saring riwayat multi-turn: 10 bubble terakhir, konten dibatasi 1500 char. */
export function sanitizeChatHistory(history: unknown): ChatMessage[] {
	if (!Array.isArray(history)) return [];
	return history
		.slice(-10)
		.filter(
			(m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
		)
		.map((m) => ({
			role: m.role as 'user' | 'assistant',
			content: String(m.content).slice(0, 1500)
		}));
}

/** Ringkasan 4 bubble terakhir untuk konteks AI 1. */
export function recentContextForAi1(history: ChatMessage[]): string {
	return history
		.slice(-4)
		.map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 250)}`)
		.join('\n');
}
