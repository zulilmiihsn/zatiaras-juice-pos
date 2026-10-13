import { untrack } from 'svelte';

export type BranchType = 'samarinda' | 'berau' | 'balikpapan' | 'samarinda2' | 'balikpapan2';

const VALID_BRANCHES: BranchType[] = [
	'samarinda',
	'berau',
	'balikpapan',
	'samarinda2',
	'balikpapan2'
];

class BranchState {
	#value = $state<BranchType>('samarinda');
	#contextEpoch = 0;

	constructor() {
		if (typeof window !== 'undefined') {
			const saved = localStorage.getItem('selectedBranch')?.toLowerCase();
			if (saved && VALID_BRANCHES.includes(saved as BranchType)) {
				this.#value = saved as BranchType;
			}
		}
	}

	get value(): BranchType {
		return this.#value;
	}

	get contextEpoch(): number {
		return this.#contextEpoch;
	}

	set value(v: BranchType) {
		// Setter sering dipanggil dari effect login; pembacaan internal bukan dependency effect itu.
		untrack(() => {
			if (this.#value !== v) this.#contextEpoch++;
			this.#value = v;
			if (typeof window !== 'undefined') {
				localStorage.setItem('selectedBranch', v);
				window.dispatchEvent(new CustomEvent('selected-branch-changed', { detail: { branch: v } }));
			}
		});
	}
}

export const selectedBranch = new BranchState();
