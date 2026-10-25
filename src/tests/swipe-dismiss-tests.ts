import assert from 'node:assert/strict';
import { resolveSwipeDirection } from '../lib/utils/swipeDismiss';

// Keputusan arah murni. Perilaku gestur di DOM (pointer capture, abaikan tombol/link,
// pantul balik) dibuktikan e2e: e2e/stock-dialogs.spec.ts dan e2e/antrean-notifications.spec.ts.

const banner = { up: 25, left: 45, right: 45 };

assert.equal(resolveSwipeDirection(0, -26, banner), 'up', 'Lewat ambang atas: menutup ke atas');
assert.equal(resolveSwipeDirection(0, -25, banner), null, 'Tepat di ambang atas: belum menutup');
assert.equal(resolveSwipeDirection(-46, 0, banner), 'left', 'Lewat ambang kiri: menutup ke kiri');
assert.equal(resolveSwipeDirection(46, 0, banner), 'right', 'Lewat ambang kanan: menutup ke kanan');
assert.equal(resolveSwipeDirection(45, 0, banner), null, 'Tepat di ambang kanan: belum menutup');
assert.equal(resolveSwipeDirection(0, 200, banner), null, 'Geser ke bawah tidak pernah menutup');
assert.equal(resolveSwipeDirection(0, 0, banner), null, 'Tanpa gerak: tidak menutup');
assert.equal(resolveSwipeDirection(-100, -30, banner), 'up', 'Atas diprioritaskan atas samping');

const upOnly = { up: 40 };
assert.equal(resolveSwipeDirection(-300, 0, upOnly), null, 'Arah tanpa ambang diabaikan: kiri');
assert.equal(resolveSwipeDirection(300, 0, upOnly), null, 'Arah tanpa ambang diabaikan: kanan');
assert.equal(resolveSwipeDirection(0, -41, upOnly), 'up', 'Hanya atas: menutup ke atas');
assert.equal(resolveSwipeDirection(0, -41, {}), null, 'Tanpa ambang sama sekali: tidak menutup');

console.log('swipe-dismiss-tests: resolveSwipeDirection contract passed');
