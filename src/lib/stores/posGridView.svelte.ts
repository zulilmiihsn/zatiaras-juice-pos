class PosGridViewState {
	value = $state(true);

	constructor() {
		if (typeof window !== 'undefined') {
			try {
				const saved = localStorage.getItem('pos_grid_view');
				if (saved !== null) {
					this.value = saved === 'true';
				}
			} catch {
				// ignore
			}
		}
	}

	toggle() {
		this.value = !this.value;
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem('pos_grid_view', String(this.value));
			} catch {
				// ignore
			}
		}
	}
}
export const posGridView = new PosGridViewState();
