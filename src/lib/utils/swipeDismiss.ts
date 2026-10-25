// Gestur geser-untuk-menutup kanonik tunggal (pointer events: sentuh, pena, mouse).
// Dipakai banner yang melayang di atas halaman. Komponen mengurus tampilannya sendiri
// lewat callback; action ini hanya membaca gestur dan memutuskan arah penutupan.

export type SwipeDirection = 'up' | 'left' | 'right';

export interface SwipeDismissOptions {
	/** Jarak geser minimum (px) per arah. Arah yang tidak tercantum tidak menutup. */
	thresholds: Partial<Record<SwipeDirection, number>>;
	onStart?: () => void;
	/** Selisih posisi (px) sejak awal geser. */
	onDrag?: (deltaX: number, deltaY: number) => void;
	/** `null`: geser dibatalkan atau kurang jauh; komponen mengembalikan posisi awal. */
	onEnd: (direction: SwipeDirection | null) => void;
}

// Geser yang dimulai di kontrol interaktif adalah klik, bukan gestur.
const INTERACTIVE_SELECTOR = 'button, a';

// Keputusan arah murni (diuji unit); atas diprioritaskan lalu kiri dan kanan.
export function resolveSwipeDirection(
	deltaX: number,
	deltaY: number,
	thresholds: SwipeDismissOptions['thresholds']
): SwipeDirection | null {
	if (thresholds.up !== undefined && deltaY < -thresholds.up) return 'up';
	if (thresholds.left !== undefined && deltaX < -thresholds.left) return 'left';
	if (thresholds.right !== undefined && deltaX > thresholds.right) return 'right';
	return null;
}

export function swipeDismiss(node: HTMLElement, initial: SwipeDismissOptions) {
	let options = initial;
	let active = false;
	let startX = 0;
	let startY = 0;
	let deltaX = 0;
	let deltaY = 0;

	function handlePointerDown(event: PointerEvent) {
		if (event.button !== 0 || (event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
		active = true;
		startX = event.clientX;
		startY = event.clientY;
		deltaX = 0;
		deltaY = 0;
		try {
			node.setPointerCapture(event.pointerId);
		} catch {
			// Pointer capture opsional; geser tetap terbaca tanpa itu.
		}
		options.onStart?.();
	}

	function handlePointerMove(event: PointerEvent) {
		if (!active) return;
		deltaX = event.clientX - startX;
		deltaY = event.clientY - startY;
		options.onDrag?.(deltaX, deltaY);
	}

	function handlePointerUp(event: PointerEvent) {
		if (!active) return;
		active = false;
		try {
			node.releasePointerCapture(event.pointerId);
		} catch {
			// Pointer mungkin sudah dilepas saat gestur berakhir.
		}
		options.onEnd(resolveSwipeDirection(deltaX, deltaY, options.thresholds));
	}

	function handlePointerCancel() {
		if (!active) return;
		active = false;
		options.onEnd(null);
	}

	node.addEventListener('pointerdown', handlePointerDown);
	node.addEventListener('pointermove', handlePointerMove);
	node.addEventListener('pointerup', handlePointerUp);
	node.addEventListener('pointercancel', handlePointerCancel);

	return {
		update(next: SwipeDismissOptions) {
			options = next;
		},
		destroy() {
			node.removeEventListener('pointerdown', handlePointerDown);
			node.removeEventListener('pointermove', handlePointerMove);
			node.removeEventListener('pointerup', handlePointerUp);
			node.removeEventListener('pointercancel', handlePointerCancel);
		}
	};
}
