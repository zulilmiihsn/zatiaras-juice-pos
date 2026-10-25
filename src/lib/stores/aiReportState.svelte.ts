import type { AiReportEvent, AiReportMessage } from '$lib/types/ai';
import { AiReportError, streamAiReport } from '$lib/services/aiReportService';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { userRole, userProfile } from '$lib/stores/userRole.svelte';
import { getOfflineSessionRevision } from '$lib/auth/offlineSession';

function contextIdentity(): string {
	const profile =
		userProfile.value && typeof userProfile.value === 'object'
			? (userProfile.value as Record<string, unknown>)
			: null;
	const user =
		typeof profile?.id === 'string'
			? profile.id
			: typeof profile?.username === 'string'
				? profile.username
				: null;
	let revision: string | null = null;
	try {
		if (typeof window !== 'undefined') revision = getOfflineSessionRevision();
	} catch {
		// Auth/branch events also invalidate state when the local session cache is unavailable.
	}
	return JSON.stringify([
		selectedBranch.value,
		selectedBranch.contextEpoch,
		userRole.value,
		user,
		typeof profile?.branch === 'string' ? profile.branch : null,
		revision
	]);
}

export function createAiReportState(stream = streamAiReport) {
	let messages = $state<AiReportMessage[]>([]);
	let isLoading = $state(false);
	let active: { controller: AbortController; identity: string; messageId: string } | null = null;
	let disposed = false;
	let mounted = false;
	let observedIdentity = contextIdentity();

	function update(id: string, change: Partial<AiReportMessage>) {
		messages = messages.map((message) => (message.id === id ? { ...message, ...change } : message));
	}

	function invalidate() {
		const previous = active;
		active = null;
		isLoading = false;
		previous?.controller.abort();
	}

	function reset() {
		invalidate();
		messages = [];
	}

	function synchronizeContext() {
		const identity = contextIdentity();
		if (identity === observedIdentity) return;
		observedIdentity = identity;
		reset();
	}

	function stop() {
		if (!active) return;
		const id = active.messageId;
		const content = messages.find((message) => message.id === id)?.content ?? '';
		invalidate();
		update(id, { content: `${content} _(analisis dihentikan pengguna)_`, isStreaming: false });
	}

	async function ask(question: string) {
		const cleanQ = question.trim();
		if (!cleanQ || disposed) return;
		synchronizeContext();
		if (active) stop();
		const flight = {
			controller: new AbortController(),
			identity: contextIdentity(),
			messageId: crypto.randomUUID()
		};
		const branch = selectedBranch.value;
		const history = messages.map(({ role, content }) => ({ role, content }));
		active = flight;
		isLoading = true;
		messages = [
			...messages,
			{ id: crypto.randomUUID(), role: 'user', content: cleanQ },
			{ id: flight.messageId, role: 'assistant', content: '', isStreaming: true }
		];
		let content = '';
		const ownsRequest = () =>
			!disposed && active === flight && flight.identity === contextIdentity();
		try {
			for await (const event of stream({
				question: cleanQ,
				branch,
				history,
				signal: flight.controller.signal
			})) {
				if (!ownsRequest()) {
					flight.controller.abort();
					break;
				}
				applyEvent(event);
			}
			if (ownsRequest()) update(flight.messageId, { isStreaming: false });
		} catch (error) {
			if (ownsRequest() && !flight.controller.signal.aborted) {
				update(flight.messageId, {
					content:
						error instanceof AiReportError
							? error.message
							: 'Terjadi kesalahan koneksi saat menghubungi Asisten AI. Pastikan koneksi internet stabil.',
					isStreaming: false
				});
			}
		} finally {
			// Only the owner may clear request state; a stopped request can finish after its successor.
			if (active === flight) {
				if (flight.identity !== contextIdentity()) messages = [];
				active = null;
				isLoading = false;
			}
		}

		function applyEvent(event: AiReportEvent) {
			if (event.type === 'token') {
				content += event.text;
				update(flight.messageId, { content, isStreaming: true });
			} else if (event.type === 'meta') {
				update(flight.messageId, {
					...(event.dateRange ? { dateRange: event.dateRange } : {}),
					...(event.webSearch !== undefined ? { webSearch: event.webSearch } : {})
				});
			} else if (event.type === 'error') {
				content += `\n\n_Peringatan: ${event.error}_`;
				update(flight.messageId, { content, isStreaming: false });
			} else {
				update(flight.messageId, { isStreaming: false });
			}
		}
	}

	function storageChanged(event: StorageEvent) {
		if (
			event.key === 'zatiaras_session' ||
			event.key === 'zatiaras_session_revision' ||
			event.key === 'selectedBranch'
		)
			synchronizeContext();
	}

	function mount() {
		if (mounted || typeof window === 'undefined' || disposed) return;
		mounted = true;
		synchronizeContext();
		window.addEventListener('selected-branch-changed', synchronizeContext);
		window.addEventListener('auth-session-refreshed', synchronizeContext);
		window.addEventListener('storage', storageChanged);
	}

	function destroy() {
		disposed = true;
		reset();
		if (mounted) {
			window.removeEventListener('selected-branch-changed', synchronizeContext);
			window.removeEventListener('auth-session-refreshed', synchronizeContext);
			window.removeEventListener('storage', storageChanged);
			mounted = false;
		}
	}

	return {
		get messages() {
			return messages;
		},
		get isLoading() {
			return isLoading;
		},
		ask,
		stop,
		reset,
		mount,
		destroy
	};
}
