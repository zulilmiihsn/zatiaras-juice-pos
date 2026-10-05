import { realtimeManager } from '$lib/realtime/realtimeManager';
import {
	acknowledgeNotificationDelivered,
	acknowledgeNotificationSeen,
	claimNotificationAlarm,
	clearNotificationContext,
	consumeOrderNotificationPage,
	hasVisibleNotificationQueue,
	readNotificationContext,
	readNotificationSound,
	saveNotificationSound,
	updateNotificationQueueVisibility
} from '$lib/utils/orderNotificationLocal';
import type { ActiveOrderNotificationContext } from '$lib/utils/orderNotificationLocal';
import {
	fetchNotificationPage,
	getNotificationScope,
	getOrderNotificationConfig,
	notificationRegistration,
	notificationScopeMatches,
	registerNotificationDevice,
	sendNotificationAcknowledgement,
	verifyNotificationSession
} from '$lib/services/orderNotificationService';
import type { NotificationScope } from '$lib/services/orderNotificationService';
import type { OrderNotificationConfig, OrderPushSubscription } from '$lib/types/orderNotifications';
import { readOfflineSessionSnapshot } from '$lib/auth/offlineSession';
import { clearUserRole, setUserRole } from '$lib/stores/userRole.svelte';

let context = $state<ActiveOrderNotificationContext | null>(null);
let soundEnabled = $state(true);
let audioReady = $state(false);
let pushActive = $state(false);
let pushReady = $state(false);
let workerReady = $state(false);
let pushConfig = $state<OrderNotificationConfig | null>(null);
let notificationPermission = $state<NotificationPermission | 'unsupported'>('unsupported');
let busy = $state(false);
let error = $state('');
let status = $state('Memeriksa kesiapan perangkat…');
let audio: AudioContext | null = null;
const CHIME_FREQUENCIES = [659.25, 783.99, 987.77] as const;
const activeNotes = new Set<OscillatorNode>();
let ringBusy = false;
let channel: BroadcastChannel | null = null;
let running = false;
let validatedScope: NotificationScope | null = null;
let disposedGeneration = 0;
let reconcileFlight: Promise<void> | null = null;
let reconcileAgain = false;
let clientId = '';
let currentPath = '';
let queueAccessible = false;
let lastRing = 0;
let lastAckSeen = -1;
let lastAckDelivered = -1;

function visibleQueue(): boolean {
	return (
		queueAccessible &&
		/^\/antrean(?:\/|$)/.test(currentPath) &&
		document.visibilityState === 'visible'
	);
}
function announce() {
	channel?.postMessage({ type: 'changed' });
}
async function unlockAudio(): Promise<void> {
	try {
		if (!audio) {
			const created = new AudioContext();
			created.onstatechange = () => {
				if (audio === created) audioReady = running && created.state === 'running';
			};
			audio = created;
		}
		const currentAudio = audio;
		const generation = disposedGeneration;
		await currentAudio.resume();
		if (audio === currentAudio && generation === disposedGeneration && running)
			audioReady = currentAudio.state === 'running';
	} catch {
		audioReady = false;
	}
}
function stopChime() {
	for (const note of activeNotes) note.stop();
	activeNotes.clear();
}
function chime() {
	if (!audio || audio.state !== 'running') {
		audioReady = false;
		return;
	}
	const now = audio.currentTime;
	for (let index = 0; index < CHIME_FREQUENCIES.length; index++) {
		const oscillator = audio.createOscillator();
		activeNotes.add(oscillator);
		const gain = audio.createGain();
		const start = now + index * 0.2;
		oscillator.frequency.value = CHIME_FREQUENCIES[index];
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(0.13, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17);
		oscillator.connect(gain);
		gain.connect(audio.destination);
		oscillator.start(start);
		oscillator.stop(start + 0.18);
		oscillator.onended = () => {
			activeNotes.delete(oscillator);
			oscillator.disconnect();
			gain.disconnect();
		};
	}
}
async function loadLocal(): Promise<void> {
	const local = await readNotificationContext();
	const scope = getNotificationScope();
	if (local && !notificationScopeMatches(local, scope)) {
		await clearNotificationContext(local.context_id);
		navigator.serviceWorker?.controller?.postMessage({
			type: 'ANTREAN_CONTEXT_CLEAR',
			context_id: local.context_id
		});
		context = null;
		pushActive = false;
		stopChime();
		announce();
		return;
	}
	if (
		!validatedScope ||
		!scope ||
		validatedScope.expires_at <= Date.now() ||
		validatedScope.branch !== scope.branch ||
		validatedScope.user_id !== scope.user_id
	) {
		context = null;
		pushActive = false;
		stopChime();
		return;
	}
	if (context?.context_id !== local?.context_id) {
		lastAckSeen = -1;
		lastAckDelivered = -1;
	}
	context = local;
	if (!local) pushActive = false;
	soundEnabled = await readNotificationSound();
	if (!context?.events.length || !soundEnabled) stopChime();
}
async function acknowledgeVisible(): Promise<void> {
	if (!context || !visibleQueue() || !notificationScopeMatches(context)) return;
	stopChime();
	const captured = context;
	const generation = disposedGeneration;
	let cursor = captured.read_cursor;
	for (const event of captured.events) cursor = Math.max(cursor, event.sequence);
	await updateNotificationQueueVisibility(captured.context_id, clientId, true);
	context = await acknowledgeNotificationSeen(captured.context_id, cursor);
	navigator.serviceWorker?.controller?.postMessage({
		type: 'ANTREAN_CLOSE_NOTIFICATIONS',
		context_id: captured.context_id,
		cursor
	});
	if (cursor > captured.seen_cursor || captured.events.length) {
		announce();
		if (context && navigator.onLine) {
			try {
				await sendNotificationAcknowledgement(captured, cursor, 'seen');
				if (generation === disposedGeneration && context?.context_id === captured.context_id)
					lastAckSeen = Math.max(lastAckSeen, cursor);
			} catch {
				if (generation === disposedGeneration)
					error = 'Antrean telah dibuka di perangkat ini; konfirmasi server menunggu koneksi.';
			}
		}
	}
}
function synchronizeSessionRole() {
	const snapshot = readOfflineSessionSnapshot();
	if (snapshot && typeof snapshot.user.role === 'string')
		setUserRole(snapshot.user.role, snapshot.user);
	else clearUserRole();
}

async function reconcile(): Promise<void> {
	if (!running) return;
	if (reconcileFlight) {
		reconcileAgain = true;
		return reconcileFlight;
	}
	const generation = disposedGeneration;
	const job = (async () => {
		do {
			reconcileAgain = false;
			try {
				await loadLocal();
				if (!running || generation !== disposedGeneration) return;
				const scopeBefore = getNotificationScope();
				if (!scopeBefore) {
					validatedScope = null;
					synchronizeSessionRole();
					context = null;
					status = 'Masuk kembali untuk menerima notifikasi Antrean.';
					return;
				}
				if (!navigator.onLine) {
					validatedScope = scopeBefore;
					await loadLocal();
					await acknowledgeVisible();
					status =
						'Offline: notifikasi baru menunggu koneksi. Suara lokal tetap mengikuti perangkat ini.';
					return;
				}
				const scope = await verifyNotificationSession();
				if (!running || generation !== disposedGeneration) return;
				if (
					!scope ||
					scope.branch !== scopeBefore.branch ||
					scope.user_id !== scopeBefore.user_id
				) {
					validatedScope = null;
					synchronizeSessionRole();
					await loadLocal();
					reconcileAgain = Boolean(scope);
					status = scope
						? 'Memeriksa sesi baru…'
						: 'Masuk kembali untuk menerima notifikasi Antrean.';
					continue;
				}
				validatedScope = scope;
				context = await registerNotificationDevice();
				pushActive = notificationRegistration.push_active;
				if (!context || !notificationScopeMatches(context) || generation !== disposedGeneration)
					return;
				soundEnabled = context.sound_enabled;
				if (pushReady && !pushConfig)
					void refreshPushReadiness().catch(() => {
						pushConfig = null;
					});
				let hasMore = true;
				while (hasMore && running && generation === disposedGeneration) {
					const captured: ActiveOrderNotificationContext = context;
					const page = await fetchNotificationPage(captured);
					if (!notificationScopeMatches(captured) || generation !== disposedGeneration) return;
					const current = await readNotificationContext();
					if (current?.context_id !== captured.context_id) return;
					context = await consumeOrderNotificationPage(
						captured.context_id,
						page.items,
						page.next_cursor
					);
					if (!context) return;
					if (page.has_more && page.next_cursor <= captured.read_cursor)
						throw new Error('Kursor notifikasi tidak bergerak. Coba lagi.');
					hasMore = page.has_more;
				}
				await acknowledgeVisible();
				if (context?.events.length && queueAccessible && document.visibilityState === 'visible') {
					let cursor = context.delivered_cursor;
					for (const event of context.events) cursor = Math.max(cursor, event.sequence);
					context = await acknowledgeNotificationDelivered(context.context_id, cursor);
				}
				if (context && lastAckSeen !== context.seen_cursor) {
					const captured = context;
					const cursor = captured.seen_cursor;
					await sendNotificationAcknowledgement(captured, cursor, 'seen');
					if (generation === disposedGeneration && context?.context_id === captured.context_id)
						lastAckSeen = Math.max(lastAckSeen, cursor);
				}
				if (context && lastAckDelivered !== context.delivered_cursor) {
					const captured = context;
					const cursor = captured.delivered_cursor;
					await sendNotificationAcknowledgement(captured, cursor, 'delivered');
					if (generation === disposedGeneration && context?.context_id === captured.context_id)
						lastAckDelivered = Math.max(lastAckDelivered, cursor);
				}
				if (
					!running ||
					generation !== disposedGeneration ||
					!context ||
					!notificationScopeMatches(context)
				)
					return;
				error = '';
				status = 'Notifikasi dalam aplikasi siap untuk cabang sesi ini.';
				announce();
			} catch (cause) {
				error = cause instanceof Error ? cause.message : 'Notifikasi perangkat belum tersedia.';
				try {
					await loadLocal();
				} catch {
					context = null;
					status = 'Penyimpanan perangkat tidak tersedia. Notifikasi belum siap.';
				}
			}
		} while (reconcileAgain && running && generation === disposedGeneration);
	})();
	reconcileFlight = job;
	try {
		await job;
	} finally {
		if (reconcileFlight === job) {
			reconcileFlight = null;
			if (reconcileAgain && running) void reconcile();
		}
	}
}
async function ring(): Promise<void> {
	if (
		ringBusy ||
		!audioReady ||
		!context ||
		!soundEnabled ||
		!context.events.length ||
		context.unacked_until <= Date.now() ||
		!notificationScopeMatches(context) ||
		hasVisibleNotificationQueue(context) ||
		Date.now() - lastRing < 4800
	)
		return;
	ringBusy = true;
	const captured = context;
	const play = async () => {
		const latest = await readNotificationContext();
		if (
			!latest ||
			latest.context_id !== captured.context_id ||
			!notificationScopeMatches(latest) ||
			!latest.sound_enabled ||
			!latest.events.length ||
			hasVisibleNotificationQueue(latest)
		)
			return;
		if (await claimNotificationAlarm(latest.context_id, clientId)) {
			lastRing = Date.now();
			chime();
		}
	};
	try {
		if (navigator.locks)
			await navigator.locks.request(
				'zatiaras-antrean-chime',
				{ ifAvailable: true },
				async (lock) => {
					if (lock) await play();
				}
			);
		else await play();
	} finally {
		ringBusy = false;
	}
}
function supportsNotificationWorker(worker: ServiceWorker | null): Promise<boolean> {
	if (!worker) return Promise.resolve(false);
	// iOS 16.4 supports Web Push but lacks withResolvers; its native Promise API needs an executor.
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const finish = (supported: boolean) => {
			clearTimeout(timeout);
			channel.port1.close();
			channel.port2.close();
			resolve(supported);
		};
		const timeout = setTimeout(() => finish(false), 1500);
		channel.port1.onmessage = (event: MessageEvent<unknown>) => {
			const value = event.data;
			finish(
				typeof value === 'object' &&
					value !== null &&
					'type' in value &&
					value.type === 'ANTREAN_CAPABILITIES' &&
					'version' in value &&
					value.version === 1
			);
		};
		try {
			worker.postMessage({ type: 'ANTREAN_CAPABILITIES' }, [channel.port2]);
		} catch {
			finish(false);
		}
	});
}
async function refreshPushReadiness(): Promise<ServiceWorkerRegistration | undefined> {
	const generation = disposedGeneration;
	pushReady = Boolean(
		window.isSecureContext &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
	notificationPermission =
		typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
	if (!pushReady) {
		pushActive = false;
		workerReady = false;
		return;
	}
	if (navigator.onLine && getNotificationScope()) pushConfig = await getOrderNotificationConfig();
	const registration = await navigator.serviceWorker.getRegistration();
	const supported = await supportsNotificationWorker(registration?.active ?? null);
	const subscribed = Boolean(registration && (await registration.pushManager.getSubscription()));
	if (!running || generation !== disposedGeneration) return registration;
	workerReady = supported;
	pushActive = notificationRegistration.push_active && subscribed;
	return registration;
}
export const orderNotifications = {
	get context() {
		return context;
	},
	get unseenCount() {
		return context?.events.length ?? 0;
	},
	get soundEnabled() {
		return soundEnabled;
	},
	get audioReady() {
		return audioReady;
	},
	get pushActive() {
		return pushActive;
	},
	get pushReady() {
		return pushReady;
	},
	get workerReady() {
		return workerReady;
	},
	get pushConfigured() {
		return pushConfig?.push_configured ?? null;
	},
	get busy() {
		return busy;
	},
	get error() {
		return error;
	},
	get status() {
		return status;
	},
	get permission() {
		return notificationPermission;
	},
	setPage(path: string, accessible: boolean) {
		currentPath = path;
		queueAccessible = accessible;
		if (!running) return;
		void (async () => {
			try {
				if (context)
					await updateNotificationQueueVisibility(context.context_id, clientId, visibleQueue());
				await acknowledgeVisible();
				await reconcile();
			} catch {
				error = 'Penyimpanan notifikasi perangkat tidak tersedia.';
			}
		})();
	},
	async setSound(enabled: boolean) {
		try {
			await saveNotificationSound(enabled);
			soundEnabled = enabled;
			if (enabled) await unlockAudio();
			else stopChime();
			announce();
			await reconcile();
		} catch {
			error = 'Pilihan suara belum tersimpan. Penyimpanan perangkat tidak tersedia.';
		}
	},
	async testSound() {
		await unlockAudio();
		if (audioReady) chime();
		else error = 'Suara diblokir browser. Izinkan audio lalu coba lagi.';
	},
	async activatePush() {
		busy = true;
		error = '';
		try {
			if (!pushReady || !navigator.onLine)
				throw new Error('Push memerlukan browser yang mendukung, koneksi online, dan HTTPS.');
			if (!workerReady)
				throw new Error('Perbarui aplikasi lalu muat ulang agar service worker notifikasi siap.');
			const config = pushConfig;
			if (!config?.push_configured || !config.vapid_public_key)
				throw new Error(
					'Push belum dikonfigurasi oleh pengelola server. Muat ulang saat online untuk memeriksa kesiapan.'
				);
			const permission = await Notification.requestPermission();
			notificationPermission = permission;
			if (permission !== 'granted')
				throw new Error(
					permission === 'denied'
						? 'Izin notifikasi ditolak. Ubah izin di pengaturan browser.'
						: 'Izin notifikasi belum diberikan.'
				);
			const registration = await navigator.serviceWorker.getRegistration();
			if (!registration?.active || !(await supportsNotificationWorker(registration.active)))
				throw new Error('Perbarui aplikasi lalu muat ulang agar service worker notifikasi siap.');
			const key = config.vapid_public_key.replace(/-/g, '+').replace(/_/g, '/');
			const applicationServerKey = Uint8Array.from(
				atob(key.padEnd(Math.ceil(key.length / 4) * 4, '=')),
				(char) => char.charCodeAt(0)
			);
			let subscription = await registration.pushManager.getSubscription();
			// An IndexedDB reset can retain the native subscription but lose its ownership token.
			if (subscription && !notificationRegistration.push_active) {
				if (!(await subscription.unsubscribe())) {
					throw new Error('Langganan lama belum dapat dilepas. Coba aktifkan push kembali.');
				}
				subscription = null;
			}
			subscription ??= await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey
			});
			const registered = await registerNotificationDevice(
				subscription.toJSON() as OrderPushSubscription
			);
			if (!registered || !notificationRegistration.push_active)
				throw new Error('Push browser tersedia tetapi belum terdaftar untuk sesi ini.');
			pushActive = true;
			status = 'Push aktif. Suara latar belakang ditentukan sistem operasi.';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Push belum dapat diaktifkan.';
		} finally {
			busy = false;
		}
	},
	async deactivatePush() {
		busy = true;
		try {
			if (!navigator.onLine)
				throw new Error('Online diperlukan untuk menonaktifkan push di server.');
			await registerNotificationDevice(null);
			const registration = await navigator.serviceWorker.getRegistration();
			await (await registration?.pushManager.getSubscription())?.unsubscribe();
			pushActive = false;
			status = 'Push nonaktif. Notifikasi dalam aplikasi tetap aktif.';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Push belum dapat dinonaktifkan.';
		} finally {
			busy = false;
		}
	},
	start(): () => void {
		if (running) return () => {};
		running = true;
		clientId = crypto.randomUUID();
		disposedGeneration++;
		channel =
			typeof BroadcastChannel === 'undefined'
				? null
				: new BroadcastChannel('zatiaras-antrean-notifications');
		const changed = () => {
			void loadLocal()
				.then(acknowledgeVisible)
				.catch(() => {
					context = null;
					error = 'Penyimpanan notifikasi perangkat tidak tersedia.';
				});
		};
		if (channel) channel.onmessage = changed;
		const wake = () => {
			notificationPermission =
				typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
			void reconcile();
		};
		const visibility = () => {
			if (context)
				void updateNotificationQueueVisibility(context.context_id, clientId, visibleQueue()).catch(
					() => {
						context = null;
					}
				);
			wake();
		};
		const gesture = () => {
			if (!audioReady && getNotificationScope()) void unlockAudio();
		};
		const message = (event: MessageEvent) => {
			if (event.data?.type === 'ANTREAN_QUERY_VISIBILITY') {
				const matches = Boolean(
					context &&
					context.context_id === event.data.context_id &&
					notificationScopeMatches(context)
				);
				event.ports[0]?.postMessage({
					context_id: event.data.context_id,
					visible: Boolean(matches && document.visibilityState === 'visible'),
					queue_visible: Boolean(matches && visibleQueue())
				});
			} else if (event.data?.type === 'ANTREAN_PUSH') {
				changed();
				wake();
			}
		};
		const workerChanged = () => {
			void refreshPushReadiness().catch(() => {
				workerReady = false;
			});
		};
		window.addEventListener('online', wake);
		window.addEventListener('focus', wake);
		window.addEventListener('auth-session-refreshed', wake);
		window.addEventListener('storage', wake);
		window.addEventListener('pointerdown', gesture);
		window.addEventListener('keydown', gesture);
		document.addEventListener('visibilitychange', visibility);
		navigator.serviceWorker?.addEventListener('message', message);
		navigator.serviceWorker?.addEventListener('controllerchange', workerChanged);
		const unsub = realtimeManager.subscribe('buku_kas', wake);
		const tick = setInterval(() => {
			void (async () => {
				try {
					await loadLocal();
					if (context)
						await updateNotificationQueueVisibility(context.context_id, clientId, visibleQueue());
					await acknowledgeVisible();
					await ring();
				} catch {
					context = null;
					error = 'Penyimpanan notifikasi perangkat tidak tersedia.';
				}
			})();
		}, 5000);
		const generation = disposedGeneration;
		void refreshPushReadiness()
			.then((registration) => {
				// First installation has no controller until navigation; activation still makes push usable.
				if (pushReady && !registration?.active)
					return navigator.serviceWorker.ready.then(() => {
						if (running && generation === disposedGeneration) workerChanged();
					});
			})
			.catch(() => {
				if (!running || generation !== disposedGeneration) return;
				pushConfig = null;
				workerReady = false;
			});
		wake();
		return () => {
			running = false;
			disposedGeneration++;
			clearInterval(tick);
			unsub();
			channel?.close();
			channel = null;
			window.removeEventListener('online', wake);
			window.removeEventListener('focus', wake);
			window.removeEventListener('auth-session-refreshed', wake);
			window.removeEventListener('storage', wake);
			window.removeEventListener('pointerdown', gesture);
			window.removeEventListener('keydown', gesture);
			document.removeEventListener('visibilitychange', visibility);
			navigator.serviceWorker?.removeEventListener('message', message);
			navigator.serviceWorker?.removeEventListener('controllerchange', workerChanged);
			if (context)
				void updateNotificationQueueVisibility(context.context_id, clientId, false).catch(() => {
					/* Expiring heartbeat handles closed storage. */
				});
			stopChime();
			if (audio) audio.onstatechange = null;
			void audio?.close().catch(() => {
				/* Browser teardown can close audio first. */
			});
			audio = null;
			audioReady = false;
			pushActive = false;
			workerReady = false;
			context = null;
			validatedScope = null;
		};
	}
};
