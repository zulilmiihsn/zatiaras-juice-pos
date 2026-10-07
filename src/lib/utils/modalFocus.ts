// Kebijakan fokus modal kanonik tunggal (AUD-023).
// Dipakai AppModal + modalSheet: initial focus, Tab trap,
// Escape, background inert, restore trigger, cleanup.
// Tanpa dependensi Svelte/store agar bisa dipakai action murni.

export interface ModalFocusOptions {
	onEscape?: () => void;
}

const FOCUSABLE_SELECTOR =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Matematika trap murni (diuji unit): indeks fokus berikut
// dengan wrap. -1 = tak ada yang bisa difokuskan.
export function trapFocusStep(length: number, activeIndex: number, shift: boolean): number {
	if (length <= 0) return -1;
	if (activeIndex < 0 || activeIndex >= length) return shift ? length - 1 : 0;
	if (shift) return (activeIndex - 1 + length) % length;
	return (activeIndex + 1) % length;
}

function focusablesOf(node: HTMLElement): HTMLElement[] {
	return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(element) => element.offsetParent !== null || element === document.activeElement
	);
}

// Stack dialog aktif untuk nested + inert yang benar.
const activeDialogs = new Set<HTMLElement>();
const inertTouched = new Set<Element>();

function markInert(element: Element): void {
	if (element.hasAttribute('inert') || inertTouched.has(element)) return;
	inertTouched.add(element);
	element.setAttribute('inert', '');
}

// Inert semua saudara di tiap tingkat leluhur dialog (modal inline
// maupun portal), plus anak body yang tak memuat dialog aktif.
function applyBackgroundInert(): void {
	for (const dialog of activeDialogs) {
		let current: Element | null = dialog;
		while (current && current !== document.body) {
			const parent: Element | null = current.parentElement;
			if (!parent) break;
			for (const sibling of Array.from(parent.children) as Element[]) {
				if (sibling === current) continue;
				let shieldsActive = false;
				for (const other of activeDialogs) {
					if (sibling === other || sibling.contains(other)) {
						shieldsActive = true;
						break;
					}
				}
				if (!shieldsActive) markInert(sibling);
			}
			current = parent;
		}
	}
	for (const child of Array.from(document.body.children)) {
		let insideDialog = false;
		for (const dialog of activeDialogs) {
			if (child === dialog || child.contains(dialog)) {
				insideDialog = true;
				break;
			}
		}
		if (!insideDialog) markInert(child);
	}
}

function clearBackgroundInert(): void {
	for (const element of inertTouched) {
		element.removeAttribute('inert');
	}
	inertTouched.clear();
}

function safeFocus(element: HTMLElement | null): void {
	if (!element || typeof element.focus !== 'function') return;
	try {
		element.focus({ preventScroll: true });
	} catch {
		// Best-effort: fokus tak boleh melempar dari cleanup.
	}
}

export function modalFocus(node: HTMLElement, options?: ModalFocusOptions) {
	const trigger = document.activeElement as HTMLElement | null;
	activeDialogs.add(node);
	applyBackgroundInert();

	// Initial focus sesudah render; timer dibersihkan saat destroy.
	// Tanpa focusable, fokus ke panel sendiri (tabindex=-1 bisa difokus program).
	const initialTimer = setTimeout(() => {
		const focusables = focusablesOf(node);
		safeFocus(focusables[0] ?? node);
	}, 0);

	function handleKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			options?.onEscape?.();
			return;
		}
		if (event.key !== 'Tab') return;
		const focusables = focusablesOf(node);
		if (focusables.length === 0) {
			event.preventDefault();
			return;
		}
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			safeFocus(last);
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			safeFocus(first);
		}
	}

	node.addEventListener('keydown', handleKeyDown);

	return {
		destroy() {
			clearTimeout(initialTimer);
			node.removeEventListener('keydown', handleKeyDown);
			activeDialogs.delete(node);
			if (activeDialogs.size === 0) {
				clearBackgroundInert();
			} else {
				applyBackgroundInert();
			}
			// Restore hanya bila trigger masih di dokumen.
			if (trigger && trigger.isConnected) {
				safeFocus(trigger);
			} else {
				safeFocus(document.body);
			}
		}
	};
}
