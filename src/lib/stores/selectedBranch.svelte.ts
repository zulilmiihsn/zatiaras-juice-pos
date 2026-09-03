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

	set value(v: BranchType) {
		this.#value = v;
		if (typeof window !== 'undefined') {
			localStorage.setItem('selectedBranch', v);
			window.dispatchEvent(new CustomEvent('selected-branch-changed', { detail: { branch: v } }));
		}
	}
}

export const selectedBranch = new BranchState();
