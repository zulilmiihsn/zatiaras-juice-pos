import { browser } from '$app/environment';
import { subscribeToRealtimeTable } from '$lib/realtime/durableObjectClient';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';

class RealtimeManager {
	private callbacks = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
	private lowerUnsubs = new Map<string, (() => void) | null>();
	private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private latestPayload = new Map<string, Record<string, unknown>>();

	subscribe(table: string, callback: (payload: Record<string, unknown>) => void): () => void {
		if (!browser) return () => {};

		if (!this.callbacks.has(table)) {
			this.callbacks.set(table, new Set());
		}
		const set = this.callbacks.get(table)!;
		set.add(callback);

		// Jika ini subscriber pertama untuk tabel ini, buka koneksi Durable Object
		if (set.size === 1 && !this.lowerUnsubs.has(table)) {
			const unsub = subscribeToRealtimeTable(table, (payload) => {
				this.latestPayload.set(table, payload);
				if (this.pendingTimers.has(table)) return;

				const id = setTimeout(async () => {
					this.pendingTimers.delete(table);
					const latest = this.latestPayload.get(table);
					this.latestPayload.delete(table);
					await cacheOrchestrator.invalidateCacheOnChange(table);
					if (latest !== undefined) {
						const listeners = this.callbacks.get(table);
						if (listeners) {
							for (const cb of Array.from(listeners)) {
								try {
									cb(latest);
								} catch (err) {
									console.error(`[RealtimeManager] Callback error on table ${table}:`, err);
								}
							}
						}
					}
				}, 250);
				this.pendingTimers.set(table, id);
			});
			this.lowerUnsubs.set(table, unsub);
		}

		// Return disposer function spesifik untuk subscriber ini
		return () => {
			const listeners = this.callbacks.get(table);
			if (listeners) {
				listeners.delete(callback);
				if (listeners.size === 0) {
					this.callbacks.delete(table);
					const timer = this.pendingTimers.get(table);
					if (timer) {
						clearTimeout(timer);
						this.pendingTimers.delete(table);
					}
					this.latestPayload.delete(table);
					const unsub = this.lowerUnsubs.get(table);
					if (unsub) {
						unsub();
						this.lowerUnsubs.delete(table);
					}
				}
			}
		};
	}

	unsubscribe(table: string) {
		const timer = this.pendingTimers.get(table);
		if (timer) {
			clearTimeout(timer);
			this.pendingTimers.delete(table);
		}
		this.latestPayload.delete(table);
		this.callbacks.delete(table);
		const unsub = this.lowerUnsubs.get(table);
		if (unsub) {
			unsub();
			this.lowerUnsubs.delete(table);
		}
	}

	unsubscribeAll() {
		for (const id of this.pendingTimers.values()) clearTimeout(id);
		this.pendingTimers.clear();
		this.latestPayload.clear();
		this.callbacks.clear();
		for (const unsub of this.lowerUnsubs.values()) unsub?.();
		this.lowerUnsubs.clear();
	}
}

export const realtimeManager = new RealtimeManager();

if (browser) {
	window.addEventListener('beforeunload', () => realtimeManager.unsubscribeAll());
}
