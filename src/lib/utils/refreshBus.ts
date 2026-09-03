type RefreshEventCallback = () => void | Promise<void>;

class RefreshBus {
	private listeners: Map<string, RefreshEventCallback[]> = new Map();

	/**
	 * Mendaftarkan callback untuk sebuah event refresh.
	 * @param eventName Nama event yang didengarkan
	 * @param callback Fungsi yang dipanggil saat event terpicu
	 * @returns Fungsi untuk menghapus listener
	 */
	on(eventName: string, callback: RefreshEventCallback): () => void {
		if (!this.listeners.has(eventName)) {
			this.listeners.set(eventName, []);
		}
		this.listeners.get(eventName)!.push(callback);

		return () => this.off(eventName, callback);
	}

	/**
	 * Menghapus callback dari event refresh.
	 */
	off(eventName: string, callback: RefreshEventCallback): void {
		const eventListeners = this.listeners.get(eventName);
		if (eventListeners) {
			this.listeners.set(
				eventName,
				eventListeners.filter((cb) => cb !== callback)
			);
		}
	}

	/**
	 * Memicu event refresh, memanggil semua callback yang terdaftar.
	 */
	emit(eventName: string): void {
		const eventListeners = this.listeners.get(eventName);
		if (eventListeners) {
			eventListeners.forEach((callback) => {
				try {
					callback();
				} catch (error) {
					console.error(`Error in refreshBus listener for ${eventName}:`, error);
				}
			});
		}
	}
}

export const refreshBus = new RefreshBus();
