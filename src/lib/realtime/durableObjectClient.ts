import { selectedBranch } from '$lib/stores/selectedBranch.svelte';

type RealtimeCallback = (message: Record<string, unknown>) => void;

let socket: WebSocket | null = null;
let socketBranch = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let branchListenerRegistered = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastPingSentAt = 0;
const realtimeHealth = {
	connected: false,
	branch: '',
	latencyMs: 0,
	reconnectAttempt: 0,
	lastOpenAt: 0,
	lastMessageAt: 0,
	lastCloseAt: 0
};
const subscriptions = new Map<string, Set<RealtimeCallback>>();

function getRealtimeUrl(branch: string) {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const params = new URLSearchParams({ branch });
	return `${protocol}//${window.location.host}/api/realtime?${params.toString()}`;
}

function clearReconnectTimer() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
}

function stopHeartbeat() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

function startHeartbeat() {
	stopHeartbeat();
	heartbeatTimer = setInterval(() => {
		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		lastPingSentAt = Date.now();
		socket.send('ping');
	}, 15000);
}

function scheduleReconnect() {
	clearReconnectTimer();
	const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000);
	reconnectAttempt += 1;
	realtimeHealth.reconnectAttempt = reconnectAttempt;
	reconnectTimer = setTimeout(() => {
		socket = null;
		connectRealtimeSocket();
	}, delay);
}

function closeSocket() {
	clearReconnectTimer();
	stopHeartbeat();
	if (socket) {
		socket.onopen = null;
		socket.onmessage = null;
		socket.onclose = null;
		socket.onerror = null;
		if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
			socket.close(1000, 'reconnect');
		}
	}
	socket = null;
	realtimeHealth.connected = false;
}

function dispatchRealtimeMessage(message: Record<string, unknown>) {
	const table = typeof message.table === 'string' ? message.table : '';
	const callbacks = subscriptions.get(table);
	if (!callbacks?.size) return;

	for (const callback of callbacks) {
		callback(message);
	}
}

function connectRealtimeSocket() {
	if (typeof window === 'undefined') return null;

	const path = window.location.pathname;
	if (path === '/login' || path === '/offline' || path === '/unauthorized') {
		return null;
	}
	if (!localStorage.getItem('zatiaras_session')) {
		return null;
	}

	const branch = selectedBranch.value || 'samarinda';
	if (
		socket &&
		socketBranch === branch &&
		(socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
	) {
		return socket;
	}

	if (socketBranch && socketBranch !== branch) {
		closeSocket();
	}

	socketBranch = branch;
	realtimeHealth.branch = branch;
	socket = new WebSocket(getRealtimeUrl(branch));

	socket.onopen = () => {
		reconnectAttempt = 0;
		realtimeHealth.connected = true;
		realtimeHealth.reconnectAttempt = 0;
		realtimeHealth.lastOpenAt = Date.now();
		clearReconnectTimer();
		startHeartbeat();
	};

	socket.onmessage = (event) => {
		realtimeHealth.lastMessageAt = Date.now();
		if (event.data === 'pong') {
			realtimeHealth.latencyMs = lastPingSentAt ? Date.now() - lastPingSentAt : 0;
			return;
		}

		try {
			const message = JSON.parse(String(event.data)) as Record<string, unknown>;
			dispatchRealtimeMessage(message);
		} catch {
			// [CATATAN]: Ignore malformed realtime messages.
		}
	};

	socket.onclose = (event) => {
		socket = null;
		stopHeartbeat();
		realtimeHealth.connected = false;
		realtimeHealth.lastCloseAt = Date.now();
		if (
			subscriptions.size > 0 &&
			event.code !== 1000 &&
			event.code !== 1008 &&
			event.code !== 4401 &&
			localStorage.getItem('zatiaras_session')
		) {
			scheduleReconnect();
		}
	};

	socket.onerror = () => {
		socket?.close();
	};

	return socket;
}

function ensureBranchListener() {
	if (branchListenerRegistered || typeof window === 'undefined') return;
	branchListenerRegistered = true;
	window.addEventListener('selected-branch-changed', () => {
		reconnectAttempt = 0;
		closeSocket();
		if (subscriptions.size > 0) {
			connectRealtimeSocket();
		}
	});
}

export function subscribeToRealtimeTable(
	table: string,
	callback: RealtimeCallback
): (() => void) | null {
	if (typeof window === 'undefined') return null;

	ensureBranchListener();
	const callbacks = subscriptions.get(table) || new Set<RealtimeCallback>();
	callbacks.add(callback);
	subscriptions.set(table, callbacks);
	connectRealtimeSocket();

	return () => {
		const tableCallbacks = subscriptions.get(table);
		if (!tableCallbacks) return;

		tableCallbacks.delete(callback);
		if (tableCallbacks.size === 0) {
			subscriptions.delete(table);
		}
		if (subscriptions.size === 0) {
			closeSocket();
		}
	};
}

export function resetRealtimeSocket() {
	closeSocket();
	if (subscriptions.size > 0) {
		connectRealtimeSocket();
	}
}

export function getRealtimeHealth() {
	return { ...realtimeHealth };
}
