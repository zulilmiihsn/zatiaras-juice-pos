import assert from 'node:assert/strict';
import { trapFocusStep } from '../lib/utils/modalFocus';

// AUD-023/054: matematika trap kebijakan kanonik nyata (dipakai modalFocus action).
// Mock focus manager terpisah dihapus: ia hanya menguji dirinya sendiri. Perilaku
// DOM nyata (fokus awal, Tab/Shift+Tab, Escape nested, inert, restore) dibuktikan
// e2e/modal-focus.spec.ts terhadap modalFocus asli di browser.

assert.equal(trapFocusStep(0, 0, false), -1, 'Tanpa focusable: tidak ada target');
assert.equal(trapFocusStep(0, -1, true), -1, 'Tanpa focusable, Shift+Tab: tidak ada target');
assert.equal(trapFocusStep(4, 3, false), 0, 'Tab dari terakhir kembali ke pertama');
assert.equal(trapFocusStep(4, 0, true), 3, 'Shift+Tab dari pertama ke terakhir');
assert.equal(trapFocusStep(4, 1, false), 2, 'Tab maju satu');
assert.equal(trapFocusStep(4, 2, true), 1, 'Shift+Tab mundur satu');
assert.equal(trapFocusStep(4, -1, false), 0, 'Fokus di luar daftar: Tab ke pertama');
assert.equal(trapFocusStep(4, -1, true), 3, 'Fokus di luar daftar: Shift+Tab ke terakhir');
assert.equal(trapFocusStep(4, 9, false), 0, 'Indeks basi: Tab ke pertama');
assert.equal(trapFocusStep(1, 0, false), 0, 'Satu kontrol: tetap di sana');
assert.equal(trapFocusStep(1, 0, true), 0, 'Satu kontrol, Shift+Tab: tetap di sana');

console.log('a11y-focus-tests: trapFocusStep contract passed (AUD-023/054)');
