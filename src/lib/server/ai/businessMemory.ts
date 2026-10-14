/** Memori bisnis per cabang yang bisa disimpan, dilihat, dan dihapus lewat chat AI. */

import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '../branchResolver';

export type MemoryCommand =
	{ type: 'save'; note: string } | { type: 'view' } | { type: 'clear' } | null;

/** Klasifikasi perintah memori bisnis dari pertanyaan yang sudah di-trim. */
export function parseMemoryCommand(cleanQ: string): MemoryCommand {
	const rememberMatch = cleanQ.match(
		/^(?:ingat|catat|simpan(?:\s+catatan)?|tambah(?:\s+memori)?)\s*:\s*(.+)$/i
	);
	if (rememberMatch) return { type: 'save', note: rememberMatch[1].trim() };

	const qLower = cleanQ.toLowerCase();
	if (
		qLower === 'lihat memori' ||
		qLower === 'lihat catatan bisnis' ||
		qLower === 'cek memori' ||
		qLower === 'apa saja memorimu?' ||
		qLower === 'catatan bisnis' ||
		qLower.includes('catatan bisnis yang tersimpan')
	) {
		return { type: 'view' };
	}
	if (
		qLower === 'hapus memori' ||
		qLower === 'reset memori' ||
		qLower === 'hapus catatan bisnis' ||
		qLower === 'bersihkan memori'
	) {
		return { type: 'clear' };
	}
	return null;
}

function parseBusinessMemoryNotes(raw: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new Error('Memori bisnis tersimpan rusak; simpan catatan baru dibatalkan.', { cause });
	}
	if (
		!parsed ||
		typeof parsed !== 'object' ||
		!('catatan' in parsed) ||
		!Array.isArray(parsed.catatan) ||
		!parsed.catatan.every((note): note is string => typeof note === 'string')
	) {
		throw new Error('Format memori bisnis tersimpan tidak valid; simpan catatan baru dibatalkan.');
	}
	return parsed.catatan;
}

/** Ambil daftar memori & target bisnis cabang dari tabel pengaturan */
export async function getBusinessMemory(rawDb: D1Database, branch: BranchContext): Promise<string> {
	try {
		const row = (await rawDb
			.prepare(
				`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory' LIMIT 1`
			)
			.bind(branch)
			.first()) as { nilai?: string } | null;
		if (row?.nilai) {
			const notes = parseBusinessMemoryNotes(row.nilai);
			return notes.map((note, index) => `${index + 1}. ${note}`).join('\n');
		}
	} catch (error) {
		// Best-effort context for AI: answering without memory is safer than blocking the chat.
		console.warn('[AI] Business memory unavailable; continuing without it', error);
	}
	return '';
}

/** Simpan catatan / target bisnis ke memori permanen cabang (maksimal 10). */
export async function saveBusinessMemoryNote(
	rawDb: D1Database,
	branch: BranchContext,
	note: string
): Promise<string[]> {
	const currentNotes: string[] = [];
	const row = (await rawDb
		.prepare(
			`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory' LIMIT 1`
		)
		.bind(branch)
		.first()) as { nilai?: string } | null;
	if (row?.nilai) currentNotes.push(...parseBusinessMemoryNotes(row.nilai));

	currentNotes.push(note.trim());
	const trimmedNotes = currentNotes.slice(-10);

	const payload = JSON.stringify({
		catatan: trimmedNotes,
		updated_at: new Date().toISOString()
	});

	await rawDb
		.prepare(
			`INSERT INTO pengaturan (id, cabang_id, kunci, nilai, updated_at)
			 VALUES (?, ?, 'ai_business_memory', ?, datetime('now'))
			 ON CONFLICT(cabang_id, kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = datetime('now')`
		)
		.bind(crypto.randomUUID(), branch, payload)
		.run();

	return trimmedNotes;
}

/** Bersihkan semua memori bisnis cabang */
export async function clearBusinessMemory(rawDb: D1Database, branch: BranchContext): Promise<void> {
	await rawDb
		.prepare(`DELETE FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory'`)
		.bind(branch)
		.run();
}

/** Jalankan perintah memori dan bangun teks jawaban. */
export async function runMemoryAction(
	rawDb: D1Database,
	branch: BranchContext,
	action: Exclude<MemoryCommand, null>
): Promise<{ answer: string }> {
	if (action.type === 'save') {
		const updatedNotes = await saveBusinessMemoryNote(rawDb, branch, action.note);
		return {
			answer:
				`Catatan bisnis berhasil disimpan ke memori permanen cabang **${branch}**:\n\n` +
				updatedNotes.map((c, i) => `${i + 1}. ${c}`).join('\n') +
				`\n\n_Catatan ini akan otomatis dijadikan tolok ukur acuan pada setiap analisis laporan mendatang._`
		};
	}
	if (action.type === 'view') {
		const memoryText = await getBusinessMemory(rawDb, branch);
		return {
			answer: memoryText
				? `Berikut catatan memori bisnis cabang **${branch}** saat ini:\n\n${memoryText}\n\n_Ketik \`Ingat: <catatan>\` untuk menambah, atau \`Hapus memori\` untuk mereset._`
				: `Belum ada catatan memori bisnis untuk cabang **${branch}**.\n\nKetik contoh: \`Ingat: Target omzet bulan ini 50 juta\` untuk mengajari AI acuan tokomu.`
		};
	}
	await clearBusinessMemory(rawDb, branch);
	return {
		answer: `Seluruh catatan memori bisnis cabang **${branch}** telah berhasil dibersihkan.`
	};
}
