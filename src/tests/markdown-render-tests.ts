import assert from 'node:assert/strict';
import { renderMarkdown } from '../lib/utils/markdown';

// Output dipakai {@html}: teks dari model AI tidak boleh menjadi tag atau atribut aktif.
const hostile = [
	'<script>alert(1)</script>',
	'**<img src=x onerror=alert(1)>**',
	'| <b>kolom</b> | <svg onload=alert(1)> |\n|---|---|\n| a | b |',
	'### <iframe src="javascript:alert(1)"></iframe>',
	'- `<a href="javascript:alert(1)">x</a>`'
];
for (const input of hostile) {
	const html = renderMarkdown(input);
	assert.doesNotMatch(html, /<(script|img|svg|iframe|a|b)[\s>]/i, `tag mentah lolos: ${input}`);
	assert.match(html, /&lt;/, `teks berbahaya tidak di-escape: ${input}`);
}

// Format yang didukung tetap dirender.
assert.equal(renderMarkdown(''), '');
assert.match(renderMarkdown('# Judul'), /<h2[^>]*>Judul<\/h2>/);
assert.match(renderMarkdown('**tebal** dan *miring*'), /<strong[^>]*>tebal<\/strong>/);
assert.match(renderMarkdown('**tebal** dan *miring*'), /<em[^>]*>miring<\/em>/);
assert.match(
	renderMarkdown('- satu\n- dua'),
	/<ul[^>]*>.*<li[^>]*>satu<\/li>.*<li[^>]*>dua<\/li>.*<\/ul>/s
);
const table = renderMarkdown('| Produk | Qty |\n|---|---|\n| Jus | 3 |');
assert.match(table, /<th[^>]*>Produk<\/th>/);
assert.match(table, /<td[^>]*>3<\/td>/);
assert.equal((table.match(/<tr/g) ?? []).length, 2, 'baris pemisah tabel tidak ikut dirender');

console.log('markdown-render-tests: escape XSS dan format dasar passed');
