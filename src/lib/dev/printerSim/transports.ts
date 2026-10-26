/**
 * Fake hardware behind the app's real print paths. The app keeps calling navigator.bluetooth,
 * navigator.usb, WebSocket and the intent launcher exactly as in production; only what answers
 * those calls is simulated, with the timing and failure modes of the real links.
 */
import { ungzip } from 'pako';
import { setIntentLauncher } from '$lib/utils/receiptPrint';
import { buildReceiptEscPos } from '$lib/utils/escposBuilder';
import { BYTES_PER_LINE, DOTS_PER_LINE, type VirtualMtp2 } from './mtp2';

export type BleProfile = 'ae00' | 'unknown-uuid' | 'spp-only';
export type CashierDevice = 'android' | 'pc';

export interface LinkSettings {
	bleProfile: BleProfile;
	/** BLE connection interval in ms (asumsi; Android usually negotiates 7.5–50). */
	bleIntervalMs: number;
	/** Packets the phone gets out per connection event (asumsi; 1 when Android waits per write). */
	blePacketsPerEvent: number;
	/** Classic Bluetooth SPP throughput in bytes/s (asumsi). */
	sppBytesPerSecond: number;
	/** USB bulk throughput in bytes/s (asumsi). */
	usbBytesPerSecond: number;
	device: CashierDevice;
	faults: {
		bleDisconnectAfterBytes: number | null;
		usbDriverLocked: boolean;
		serverDown: boolean;
		rawBtMissing: boolean;
	};
}

export const DEFAULT_LINK_SETTINGS: LinkSettings = {
	bleProfile: 'ae00',
	bleIntervalMs: 15,
	blePacketsPerEvent: 1,
	sppBytesPerSecond: 11_000,
	usbBytesPerSecond: 150_000,
	device: 'android',
	faults: {
		bleDisconnectAfterBytes: null,
		usbDriverLocked: false,
		serverDown: false,
		rawBtMissing: false
	}
};

export type LinkEvent = {
	at: number;
	channel: string;
	message: string;
	level: 'info' | 'warn' | 'error';
};

export interface LinkStats {
	channel: string;
	startedAt: number;
	endedAt: number | null;
	bytes: number;
	writes: number;
	largestWrite: number;
	violations: number;
}

export interface SimHost {
	printer: VirtualMtp2;
	settings: LinkSettings;
	/** Shows the browser's device chooser; resolves to the picked index or null when cancelled. */
	choose(kind: 'bluetooth' | 'usb', names: string[]): Promise<number | null>;
	log(event: Omit<LinkEvent, 'at'>): void;
	stats(stats: LinkStats): void;
}

const MTP2_SERVICE = '0000ae00-0000-1000-8000-00805f9b34fb';
const UNKNOWN_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const BLE_PAYLOAD = 20;
const ANDROID_UA =
	'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const now = () => performance.now();

function requireGesture(): void {
	const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
		.userActivation;
	if (activation && !activation.isActive)
		throw new DOMException(
			'Must be handling a user gesture to show a permission request.',
			'SecurityError'
		);
}

function newStats(channel: string): LinkStats {
	return {
		channel,
		startedAt: now(),
		endedAt: null,
		bytes: 0,
		writes: 0,
		largestWrite: 0,
		violations: 0
	};
}

/** Serialises packets onto a shared air-time schedule. */
class Pacer {
	private next = 0;
	constructor(private readonly costMs: () => number) {}
	async slot(packets = 1): Promise<void> {
		const start = Math.max(now(), this.next);
		this.next = start + this.costMs() * packets;
		await sleep(this.next - now());
	}
}

/** Streams bytes over a flow-controlled link at a fixed rate. */
async function streamBlocking(
	host: SimHost,
	data: Uint8Array,
	bytesPerSecond: number,
	chunk = 512
) {
	for (let offset = 0; offset < data.length; offset += chunk) {
		const part = data.subarray(offset, offset + chunk);
		await sleep((part.length / bytesPerSecond) * 1000);
		await host.printer.receiveBlocking(part, now);
	}
}

function fakeBluetooth(host: SimHost) {
	let connected = false;
	let sent = 0;
	let stats = newStats('BLE');
	const pacer = new Pacer(() => host.settings.bleIntervalMs / host.settings.blePacketsPerEvent);
	const listeners = new Set<() => void>();

	function drop(reason: string) {
		if (!connected) return;
		connected = false;
		host.log({ channel: 'BLE', level: 'error', message: reason });
		for (const listener of listeners) listener();
	}

	const characteristic = {
		uuid: '0000ae01-0000-1000-8000-00805f9b34fb',
		properties: { write: true, writeWithoutResponse: true },
		async writeValueWithoutResponse(value: BufferSource) {
			await write(value, 1);
		},
		async writeValueWithResponse(value: BufferSource) {
			// Request plus acknowledgement each need a connection event.
			await write(value, 2);
		},
		async writeValue(value: BufferSource) {
			await write(value, 2);
		}
	};

	async function write(value: BufferSource, events: number) {
		if (!connected)
			throw new DOMException(
				'GATT Server is disconnected. Cannot perform GATT operations.',
				'NetworkError'
			);
		const bytes =
			value instanceof Uint8Array
				? value
				: ArrayBuffer.isView(value)
					? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
					: new Uint8Array(value);
		if (stats.endedAt === null || now() - stats.endedAt > 2000) {
			stats = newStats('BLE');
			host.log({
				channel: 'BLE',
				level: 'info',
				message: 'Mulai kirim lewat karakteristik 0xAE01'
			});
		}
		stats.writes++;
		stats.largestWrite = Math.max(stats.largestWrite, bytes.length);
		if (bytes.length > BLE_PAYLOAD) {
			stats.violations++;
			host.stats(stats);
			host.log({
				channel: 'BLE',
				level: 'error',
				message: `Tulis ${bytes.length} byte melebihi muatan ATT ${BLE_PAYLOAD} byte (MTU 23)`
			});
			throw new DOMException('GATT operation failed for unknown reason.', 'NetworkError');
		}
		await pacer.slot(events);
		if (!connected)
			throw new DOMException(
				'GATT Server is disconnected. Cannot perform GATT operations.',
				'NetworkError'
			);
		const limit = host.settings.faults.bleDisconnectAfterBytes;
		if (limit !== null && sent + bytes.length > limit) {
			drop(`Koneksi BLE putus setelah ${sent} byte (simulasi gangguan)`);
			throw new DOMException(
				'GATT Server is disconnected. Cannot perform GATT operations.',
				'NetworkError'
			);
		}
		sent += bytes.length;
		stats.bytes += bytes.length;
		stats.endedAt = now();
		host.printer.receiveDropping(bytes.slice(), now());
		host.stats(stats);
	}

	const service = (uuid: string) => ({
		uuid,
		async getCharacteristics() {
			await sleep(60);
			return [
				characteristic,
				{ uuid: '0000ae02-0000-1000-8000-00805f9b34fb', properties: { notify: true } }
			];
		}
	});

	let allowed: string[] = [];
	const exposedService = () =>
		host.settings.bleProfile === 'unknown-uuid' ? UNKNOWN_SERVICE : MTP2_SERVICE;
	const server = {
		get connected() {
			return connected;
		},
		async connect() {
			await sleep(700);
			connected = true;
			sent = 0;
			stats = newStats('BLE');
			host.log({ channel: 'BLE', level: 'info', message: 'GATT terhubung ke MTP-II' });
			return server;
		},
		disconnect() {
			if (connected) host.log({ channel: 'BLE', level: 'info', message: 'GATT diputus oleh app' });
			connected = false;
		},
		async getPrimaryService(uuid: string) {
			await sleep(80);
			if (!allowed.includes(uuid))
				throw new DOMException(
					`Origin is not allowed to access the service ${uuid}.`,
					'SecurityError'
				);
			if (uuid !== exposedService())
				throw new DOMException(
					`No Services matching UUID ${uuid} found in Device.`,
					'NotFoundError'
				);
			return service(uuid);
		},
		async getPrimaryServices() {
			await sleep(80);
			// Chrome only lists services named in optionalServices.
			return allowed.includes(exposedService()) ? [service(exposedService())] : [];
		}
	};

	const device = {
		id: 'sim-mtp2',
		name: 'MTP-II',
		gatt: server,
		addEventListener(type: string, listener: () => void) {
			if (type === 'gattserverdisconnected') listeners.add(listener);
		}
	};

	return {
		async requestDevice(options: { optionalServices?: string[] }) {
			requireGesture();
			allowed = (options.optionalServices ?? []).map((s) => s.toLowerCase());
			// Classic-only (SPP) printers never show up in the Web Bluetooth chooser.
			const names = host.settings.bleProfile === 'spp-only' ? [] : ['MTP-II'];
			const picked = await host.choose('bluetooth', names);
			if (picked === null)
				throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
			return device;
		},
		async getAvailability() {
			return true;
		}
	};
}

function fakeUsb(host: SimHost) {
	let stats = newStats('USB');
	const device = {
		productName: 'MTP-II',
		manufacturerName: 'GOOJPRT',
		opened: false,
		configuration: null as null | { interfaces: unknown[] },
		async open() {
			await sleep(120);
			device.opened = true;
		},
		async close() {
			await sleep(40);
			device.opened = false;
		},
		async selectConfiguration() {
			device.configuration = {
				interfaces: [
					{
						interfaceNumber: 0,
						alternates: [
							{
								alternateSetting: 0,
								endpoints: [
									{ endpointNumber: 2, direction: 'in' },
									{ endpointNumber: 1, direction: 'out' }
								]
							}
						]
					}
				]
			};
		},
		async claimInterface() {
			await sleep(30);
			if (host.settings.faults.usbDriverLocked)
				throw new DOMException('Unable to claim interface.', 'NetworkError');
		},
		async selectAlternateInterface() {},
		async transferOut(endpoint: number, data: BufferSource) {
			if (!device.opened)
				throw new DOMException('The device must be opened first.', 'InvalidStateError');
			if (endpoint !== 1)
				throw new DOMException(
					'The specified endpoint is not part of a claimed interface.',
					'NotFoundError'
				);
			const bytes = new Uint8Array(
				ArrayBuffer.isView(data)
					? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
					: data
			);
			if (stats.endedAt === null || now() - stats.endedAt > 2000) stats = newStats('USB');
			stats.writes++;
			stats.largestWrite = Math.max(stats.largestWrite, bytes.length);
			// Bulk OUT is NAKed while the printer buffer is full, so the transfer just takes longer.
			await streamBlocking(host, bytes, host.settings.usbBytesPerSecond, 64);
			stats.bytes += bytes.length;
			stats.endedAt = now();
			host.stats(stats);
			return { status: 'ok', bytesWritten: bytes.length };
		}
	};
	return {
		async requestDevice() {
			requireGesture();
			const picked = await host.choose('usb', ['GOOJPRT MTP-II']);
			if (picked === null) throw new DOMException('No device selected.', 'NotFoundError');
			return device;
		},
		async getDevices() {
			return [];
		}
	};
}

function decodeRawBt(url: string): Uint8Array {
	const match =
		/^intent:base64,([A-Za-z0-9+/=]+)#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/.exec(
			url
		);
	if (!match) throw new Error('Amplop intent RawBT tidak sah');
	const binary = atob(match[1]);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** RawBT (Android) and RawBT Print Server (PC) both forward ESC/POS unchanged over SPP. */
async function rawBtForward(host: SimHost, channel: string, bytes: Uint8Array, connectMs: number) {
	const stats = newStats(channel);
	host.log({ channel, level: 'info', message: `RawBT menerima ${bytes.length} byte ESC/POS` });
	await sleep(connectMs);
	host.log({ channel, level: 'info', message: 'SPP (RFCOMM) terhubung ke MTP-II' });
	await streamBlocking(host, bytes, host.settings.sppBytesPerSecond);
	stats.bytes = bytes.length;
	stats.writes = 1;
	stats.largestWrite = bytes.length;
	stats.endedAt = now();
	host.stats(stats);
	host.log({ channel, level: 'info', message: 'RawBT selesai mengirim' });
}

/** print-intent receives HTML; the helper renders it at printer resolution and sends raster ESC/POS. */
async function printIntentForward(host: SimHost, url: string) {
	const channel = 'print-intent';
	const match = /^intent:\/\/#Intent;scheme=print-intent;S\.content=([A-Za-z0-9+/=]+);end$/.exec(
		url
	);
	if (!match) throw new Error('Amplop print-intent tidak sah');
	const binary = atob(match[1]);
	const gz = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) gz[i] = binary.charCodeAt(i);
	const pages = JSON.parse(ungzip(gz, { toText: true })) as string[];
	const html = pages[0] ?? '';
	const img = /<img src="(data:image\/png;base64,[^"]+)" width="(\d+)" height="(\d+)"/.exec(html);
	const printWidthMm = Number(/html,body\{margin:0;padding:0;width:(\d+)mm/.exec(html)?.[1] ?? 48);
	if (!img) throw new Error('HTML print-intent tidak berisi gambar struk');
	host.log({
		channel,
		level: 'info',
		message: `print-intent menerima HTML ${html.length} karakter, lebar halaman ${printWidthMm} mm`
	});
	const image = new Image();
	image.src = img[1];
	await image.decode();
	// Asumsi: the helper fits the page width onto the printer's 384 dots and thresholds at 50%.
	const scale = DOTS_PER_LINE / Number(img[2]);
	const width = DOTS_PER_LINE;
	const height = Math.round(Number(img[3]) * scale);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(image, 0, 0, Number(img[2]) * scale, height);
	const pixels = ctx.getImageData(0, 0, width, height).data;
	const bits = new Uint8Array(BYTES_PER_LINE * height);
	for (let i = 0; i < width * height; i++) if (pixels[i * 4] < 128) bits[i >> 3] |= 0x80 >> (i & 7);
	if (scale !== 1)
		host.log({
			channel,
			level: 'warn',
			message: `Helper menskalakan gambar ${img[2]} px ke ${Math.round(Number(img[2]) * scale)} dot`
		});
	await rawBtForward(host, channel, buildReceiptEscPos({ width, height, bytes: bits }), 1500);
}

function fakeWebSocket(host: SimHost, Original: typeof WebSocket) {
	class PrintServerSocket extends EventTarget {
		static readonly CONNECTING = 0;
		static readonly OPEN = 1;
		static readonly CLOSING = 2;
		static readonly CLOSED = 3;
		readyState = 0;
		bufferedAmount = 0;
		onopen: ((ev: Event) => void) | null = null;
		onclose: ((ev: Event) => void) | null = null;
		onerror: ((ev: Event) => void) | null = null;
		onmessage: ((ev: Event) => void) | null = null;
		constructor(readonly url: string) {
			super();
			setTimeout(() => {
				if (host.settings.faults.serverDown) {
					host.log({
						channel: 'Server',
						level: 'error',
						message: `${url} menolak koneksi (server mati)`
					});
					this.readyState = 3;
					this.onerror?.(new Event('error'));
					this.onclose?.(new Event('close'));
					return;
				}
				this.readyState = 1;
				host.log({ channel: 'Server', level: 'info', message: `WebSocket terbuka: ${url}` });
				this.onopen?.(new Event('open'));
			}, 40);
		}
		send(text: string) {
			if (this.readyState !== 1)
				throw new DOMException('WebSocket is not open', 'InvalidStateError');
			this.bufferedAmount += text.length;
			// Loopback drains at tens of MB/s.
			setTimeout(
				() => {
					this.bufferedAmount = 0;
					let bytes: Uint8Array;
					try {
						bytes = decodeRawBt(text);
					} catch (error) {
						host.log({ channel: 'Server', level: 'error', message: (error as Error).message });
						return;
					}
					setTimeout(() => {
						this.readyState = 3;
						this.onclose?.(new Event('close'));
					}, 30);
					void rawBtForward(host, 'Server', bytes, 300);
				},
				Math.max(1, text.length / 40_000)
			);
		}
		close() {
			this.readyState = 3;
		}
	}
	const isPrintServer = (url: string | URL) =>
		/^ws:\/\/(localhost|127\.0\.0\.1):40213\/?$/.test(String(url));
	const Patched = function (this: unknown, url: string | URL, protocols?: string | string[]) {
		return isPrintServer(url) ? new PrintServerSocket(String(url)) : new Original(url, protocols);
	} as unknown as typeof WebSocket;
	Object.assign(Patched, {
		CONNECTING: 0,
		OPEN: 1,
		CLOSING: 2,
		CLOSED: 3,
		prototype: Original.prototype
	});
	return Patched;
}

/** Installs every fake; the returned function restores the real browser objects. */
export function installPrinterSim(host: SimHost): () => void {
	const nav = navigator as unknown as Record<string, unknown>;
	const OriginalWebSocket = window.WebSocket;
	Object.defineProperty(navigator, 'bluetooth', { value: fakeBluetooth(host), configurable: true });
	Object.defineProperty(navigator, 'usb', { value: fakeUsb(host), configurable: true });
	Object.defineProperty(navigator, 'userAgent', {
		get: () =>
			host.settings.device === 'android' ? ANDROID_UA : Object.getPrototypeOf(navigator).userAgent,
		configurable: true
	});
	window.WebSocket = fakeWebSocket(host, OriginalWebSocket);
	setIntentLauncher((url) => {
		if (host.settings.device !== 'android') {
			host.log({
				channel: 'Intent',
				level: 'error',
				message: 'Browser PC tidak bisa membuka intent Android'
			});
			return;
		}
		if (host.settings.faults.rawBtMissing) {
			host.log({
				channel: 'Intent',
				level: 'error',
				message: 'Aplikasi helper tidak terpasang: Android menampilkan halaman error / Play Store'
			});
			return;
		}
		const task = url.startsWith('intent:base64,')
			? Promise.resolve().then(() => rawBtForward(host, 'RawBT', decodeRawBt(url), 700 + 1200))
			: printIntentForward(host, url);
		task.catch((error: Error) =>
			host.log({ channel: 'Intent', level: 'error', message: error.message })
		);
	});
	return () => {
		setIntentLauncher(null);
		window.WebSocket = OriginalWebSocket;
		delete nav.bluetooth;
		delete nav.usb;
		delete nav.userAgent;
	};
}
