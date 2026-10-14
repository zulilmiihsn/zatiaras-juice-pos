/**
 * Markdown sederhana dari jawaban AI ke HTML untuk `{@html}`. Semua teks di-escape
 * dulu (`&`, `<`, `>`) sebelum format ditambahkan; atribut HTML tidak pernah
 * berasal dari isi pesan, jadi teks model tidak bisa menyisipkan tag atau handler.
 * Mendukung judul, daftar, tabel, garis, tebal, miring, dan kode inline.
 */
export function renderMarkdown(md: string): string {
	if (!md) return '';
	const escapeHtml = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	const rawLines = md.trim().split('\n');
	let html = '';
	let inList = false;
	let inTable = false;
	let tableHeaders: string[] = [];
	let tableRows: string[][] = [];

	const flushTable = () => {
		if (!inTable) return;
		html +=
			'<div class="my-2.5 w-full max-w-full overflow-x-auto rounded-xl border border-pink-100 bg-white shadow-2xs">';
		html += '<table class="min-w-full border-collapse text-left text-xs text-slate-700">';
		if (tableHeaders.length > 0) {
			html +=
				'<thead class="border-b border-pink-100 bg-pink-50/70 text-[10px] sm:text-[11px] font-bold text-pink-700 uppercase tracking-wider">';
			html += '<tr>';
			for (const h of tableHeaders) {
				html += `<th class="px-2.5 py-2 whitespace-nowrap">${h}</th>`;
			}
			html += '</tr></thead>';
		}
		html += '<tbody class="divide-y divide-slate-100">';
		for (const row of tableRows) {
			html += '<tr class="transition-colors hover:bg-pink-50/30">';
			for (const cell of row) {
				html += `<td class="px-2.5 py-1.5 leading-snug whitespace-nowrap sm:whitespace-normal">${cell}</td>`;
			}
			html += '</tr>';
		}
		html += '</tbody></table></div>';
		inTable = false;
		tableHeaders = [];
		tableRows = [];
	};

	const flushList = () => {
		if (!inList) return;
		html += '</ul>';
		inList = false;
	};

	const inlineFormat = (text: string) => {
		let t = escapeHtml(text);
		t = t.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900">$1</strong>');
		t = t.replace(/\*(.*?)\*/g, '<em class="text-slate-600 italic">$1</em>');
		t = t.replace(
			/`([^`]+)`/g,
			'<code class="rounded bg-pink-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-pink-700 break-all">$1</code>'
		);
		return t;
	};

	for (let i = 0; i < rawLines.length; i++) {
		const line = rawLines[i].trim();

		if (line.startsWith('|') && line.endsWith('|')) {
			flushList();
			const cells = line
				.slice(1, -1)
				.split('|')
				.map((c) => inlineFormat(c.trim()));

			const isDivider = cells.every((c) => /^[-:\s]+$/.test(c));
			if (isDivider) continue;

			if (!inTable) {
				inTable = true;
				tableHeaders = cells;
			} else {
				tableRows.push(cells);
			}
			continue;
		} else if (inTable) {
			flushTable();
		}

		if (/^---+$|^\*\*\*+$/.test(line)) {
			flushList();
			html += '<hr class="my-3 border-pink-100" />';
			continue;
		}

		if (/^###\s+/.test(line)) {
			flushList();
			html += `<h4 class="mt-3 mb-1 text-xs font-black uppercase tracking-wider text-pink-700 break-words">${inlineFormat(line.replace(/^###\s+/, ''))}</h4>`;
			continue;
		}
		if (/^##\s+/.test(line)) {
			flushList();
			html += `<h3 class="mt-3.5 mb-1.5 text-sm font-black tracking-tight text-slate-900 break-words">${inlineFormat(line.replace(/^##\s+/, ''))}</h3>`;
			continue;
		}
		if (/^#\s+/.test(line)) {
			flushList();
			html += `<h2 class="mt-4 mb-2 text-base font-black tracking-tight text-slate-900 break-words">${inlineFormat(line.replace(/^#\s+/, ''))}</h2>`;
			continue;
		}

		if (/^-\s+/.test(line) || /^\*\s+/.test(line)) {
			if (!inList) {
				html += '<ul class="my-2 space-y-1 pl-4 list-disc text-xs sm:text-sm text-slate-700">';
				inList = true;
			}
			html += `<li class="leading-relaxed break-words">${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`;
			continue;
		} else if (inList) {
			flushList();
		}

		if (!line) continue;

		html += `<p class="my-1.5 text-xs sm:text-sm leading-relaxed text-slate-700 break-words">${inlineFormat(line)}</p>`;
	}

	flushList();
	flushTable();
	return html;
}
