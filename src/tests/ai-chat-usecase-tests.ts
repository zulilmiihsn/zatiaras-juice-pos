import assert from 'node:assert/strict';
import {
	extractJsonFromText,
	fastResolveRequirements,
	formatDateForAI,
	getBusinessMemory,
	parseMemoryCommand,
	recentContextForAi1,
	runMemoryAction,
	sanitizeChatHistory,
	saveBusinessMemoryNote,
	clearBusinessMemory,
	toYMDWita
} from '$lib/server/ai/aiChatUseCase';
import { createTestD1 } from './helpers/testD1';

// parseMemoryCommand: klasifikasi perintah memori.
assert.deepEqual(parseMemoryCommand('Ingat: target 50 juta'), {
	type: 'save',
	note: 'target 50 juta'
});
assert.deepEqual(parseMemoryCommand('catat: stok menipis'), {
	type: 'save',
	note: 'stok menipis'
});
assert.deepEqual(parseMemoryCommand('Simpan catatan: buka cabang baru'), {
	type: 'save',
	note: 'buka cabang baru'
});
assert.deepEqual(parseMemoryCommand('HAPUS MEMORI'), { type: 'clear' });
assert.deepEqual(parseMemoryCommand('Lihat memori'), { type: 'view' });
assert.deepEqual(parseMemoryCommand('catatan bisnis yang tersimpan di mana?'), { type: 'view' });
assert.equal(parseMemoryCommand('berapa omzet bulan ini?'), null);
assert.equal(parseMemoryCommand('ingat tanpa titik dua'), null);

// sanitizeChatHistory: saring peran, batasi 10 & 1500 char.
assert.deepEqual(sanitizeChatHistory(null), []);
assert.deepEqual(sanitizeChatHistory('bukan-array'), []);
{
	const history = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `q${i}` }));
	const clean = sanitizeChatHistory(history);
	assert.equal(clean.length, 10);
	assert.deepEqual(
		clean.map((m) => m.content),
		Array.from({ length: 10 }, (_, i) => `q${i + 2}`)
	);
	const mixed = sanitizeChatHistory([
		{ role: 'system', content: 'x' },
		{ role: 'user', content: 42 },
		{ role: 'assistant', content: 'ok' },
		null
	]);
	assert.deepEqual(mixed, [{ role: 'assistant', content: 'ok' }]);
	const long = sanitizeChatHistory([{ role: 'user', content: 'a'.repeat(2000) }]);
	assert.equal(long[0].content.length, 1500);
}

// recentContextForAi1: format User/AI, 4 terakhir, 250 char.
{
	const ctx = recentContextForAi1([
		{ role: 'user', content: 'halo' },
		{ role: 'assistant', content: 'hai' }
	]);
	assert.equal(ctx, 'User: halo\nAI: hai');
}

// toYMDWita: matematika UTC+8 deterministik, independen TZ host.
assert.equal(toYMDWita(new Date('2026-09-01T16:00:00.000Z')), '2026-09-02');
assert.equal(toYMDWita(new Date('2026-09-01T15:59:59.000Z')), '2026-09-01');

// formatDateForAI: toleran ICU, pastikan komponen tanggal ada.
{
	const out = formatDateForAI('2026-09-02');
	assert.ok(out.includes('September') && out.includes('2026'), out);
}

// extractJsonFromText: fence, bare, dan teks sekitar.
assert.equal(extractJsonFromText('```json\n{"a":1}\n```'), '{"a":1}');
assert.equal(extractJsonFromText('hasilnya {"a":1} selesai'), '{"a":1}');
assert.equal(extractJsonFromText('{"a":1}'), '{"a":1}');

// fastResolveRequirements: null untuk ambigu/tak dikenal.
assert.equal(fastResolveRequirements('Juli dan Agustus', '2026-09-16'), null);
assert.equal(fastResolveRequirements('xyzzy foo bar', '2026-09-16'), null);
{
	const resolved = fastResolveRequirements('menu terlaris bulan Agustus 2026', '2026-09-16');
	assert.ok(resolved !== null);
	assert.equal(resolved.periode.start, '2026-08-01');
	assert.equal(resolved.periode.end, '2026-08-31');
}

// Memori DB: simpan/baca/isolasi cabang/retensi.
{
	const { db, close } = await createTestD1();
	try {
		assert.equal(await getBusinessMemory(db, 'samarinda'), '');
		const notes = await saveBusinessMemoryNote(db, 'samarinda', 'Target 50 juta');
		assert.deepEqual(notes, ['Target 50 juta']);
		assert.equal(await getBusinessMemory(db, 'samarinda'), '1. Target 50 juta');
		// Isolasi cabang: cabang lain tidak melihat catatan ini.
		assert.equal(await getBusinessMemory(db, 'balikpapan'), '');
		// Retensi maksimal 10 catatan.
		for (let i = 0; i < 11; i++) await saveBusinessMemoryNote(db, 'samarinda', `n${i}`);
		const kept = await getBusinessMemory(db, 'samarinda');
		assert.ok(!kept.includes('Target 50 juta'));
		assert.ok(kept.includes('n10'));
		assert.equal(kept.split('\n').length, 10);
		// runMemoryAction: save/view/clear dengan teks kontrak.
		await clearBusinessMemory(db, 'samarinda');
		const saved = await runMemoryAction(db, 'samarinda', { type: 'save', note: 'Buka jam 7' });
		assert.ok(saved.answer.includes('samarinda') && saved.answer.includes('Buka jam 7'));
		const viewed = await runMemoryAction(db, 'samarinda', { type: 'view' });
		assert.ok(viewed.answer.includes('Buka jam 7'));
		const cleared = await runMemoryAction(db, 'samarinda', { type: 'clear' });
		assert.ok(cleared.answer.includes('dibersihkan'));
		assert.equal(await getBusinessMemory(db, 'samarinda'), '');
		const emptyView = await runMemoryAction(db, 'samarinda', { type: 'view' });
		assert.ok(emptyView.answer.includes('Belum ada'));
	} finally {
		await close();
	}
}

console.log('ai-chat-usecase-tests: all assertions passed');
process.exit(0);
