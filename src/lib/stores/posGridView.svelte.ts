class PosGridViewState {
	value = $state(false);
	toggle() {
		this.value = !this.value;
	}
}
export const posGridView = new PosGridViewState();
