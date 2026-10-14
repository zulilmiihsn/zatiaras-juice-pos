// Kebijakan fokus modal kanonik tunggal.
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

// Stack dialog aktif (urut buka) untuk nested + inert yang benar.
// Hanya dialog teratas yang menangani Escape/Tab.
const dialogStack: HTMLElement[] = [];
const inertTouched = new Set<Element>();

function markInert(element: Element): void {
	if (element.hasAttribute('inert') || inertTouched.has(element)) return;
	inertTouched.add(element);
	element.setAttribute('inert', '');
}

// Inert semua saudara di tiap tingkat leluhur dialog (modal inline
// maupun portal), plus anak body yang tak memuat dialog aktif.
function applyBackgroundInert(): void {
	for (const dialog of dialogStack) {
		let current: Element | null = dialog;
		while (current && current !== document.body) {
			const parent: Element | null = current.parentElement;
			if (!parent) break;
			for (const sibling of Array.from(parent.children) as Element[]) {
				if (sibling === current) continue;
				let shieldsActive = false;
				for (const other of dialogStack) {
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
		for (const dialog of dialogStack) {
			if (child === dialog || child.contains(dialog)) {
				insideDialog = true;
				break;
			}
		}
		if (!insideDialog) markInert(child);
	}
	// Dialog bawah yang tidak memuat dialog teratas (mis. sheet portal
	// bertumpuk) juga inert: hanya dialog teratas yang menjebak/menutup.
	const top = dialogStack[dialogStack.length - 1];
	for (const dialog of dialogStack) {
		if (dialog !== top && !dialog.contains(top)) markInert(dialog);
	}
}

// Inert dihitung ulang dari nol tiap stack berubah, agar tanda lama
// (mis. leluhur dialog baru yang di-inert untuk dialog sebelumnya) lepas.
function recomputeBackgroundInert(): void {
	clearBackgroundInert();
	if (dialogStack.length > 0) applyBackgroundInert();
}

function clearBackgroundInert(): void {
	for (const element of inertTouched) {
		element.removeAttribute('inert');
	}
	inertTouched.clear();
}

function safeFocus(element: HTMLElement | null | undefined): boolean {
	if (!element || typeof element.focus !== 'function') return false;
	try {
		element.focus({ preventScroll: true });
	} catch {
		// Best-effort: fokus tak boleh melempar dari cleanup.
	}
	return document.activeElement === element;
}

function focusInside(node: HTMLElement): void {
	safeFocus(focusablesOf(node)[0] ?? node);
}

export function modalFocus(node: HTMLElement, options?: ModalFocusOptions) {
	const trigger = document.activeElement as HTMLElement | null;
	// Panel tanpa focusable tetap harus bisa menerima fokus program.
	if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
	dialogStack.push(node);
	recomputeBackgroundInert();

	// Initial focus sesudah render; timer dibersihkan saat destroy.
	// Fokus yang sudah di dalam (mis. autofocus pemanggil) dipertahankan.
	const initialTimer = setTimeout(() => {
		if (!node.contains(document.activeElement)) focusInside(node);
	}, 0);

	function handleKeyDown(event: KeyboardEvent): void {
		// Keydown dialog nested menggelembung ke leluhurnya; hanya dialog
		// teratas yang boleh menutup/menjebak.
		if (event.defaultPrevented || dialogStack[dialogStack.length - 1] !== node) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			options?.onEscape?.();
			return;
		}
		if (event.key !== 'Tab') return;
		const focusables = focusablesOf(node);
		const active = document.activeElement as HTMLElement | null;
		const index = active ? focusables.indexOf(active) : -1;
		if (index === -1 && active && active !== node && node.contains(active)) {
			// Fokus pada elemen non-tabbable di tengah panel (mis. heading
			// tabindex=-1): lanjut ke kontrol berikut/sebelumnya menurut urutan
			// dokumen, wrap bila tidak ada.
			const following = focusables.filter(
				(element) => active.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
			);
			const preceding = focusables.filter(
				(element) => active.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING
			);
			event.preventDefault();
			safeFocus(
				event.shiftKey
					? (preceding[preceding.length - 1] ?? focusables[focusables.length - 1])
					: (following[0] ?? focusables[0])
			);
			return;
		}
		const atEdge = index === -1 || (event.shiftKey ? index === 0 : index === focusables.length - 1);
		if (!atEdge) return;
		event.preventDefault();
		safeFocus(focusables[trapFocusStep(focusables.length, index, event.shiftKey)]);
	}

	node.addEventListener('keydown', handleKeyDown);

	return {
		destroy() {
			clearTimeout(initialTimer);
			node.removeEventListener('keydown', handleKeyDown);
			const position = dialogStack.indexOf(node);
			if (position !== -1) dialogStack.splice(position, 1);
			// Inert yang dipasang untuk dialog ini (mis. isi dialog induk) dilepas.
			recomputeBackgroundInert();
			// Restore ke pemicu bila masih ada dan bisa difokus (tidak
			// terlepas/disabled/inert); jika tidak, ke dialog teratas tersisa.
			if (trigger && trigger.isConnected && safeFocus(trigger)) return;
			const top = dialogStack[dialogStack.length - 1];
			if (top) focusInside(top);
			else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
		}
	};
}
