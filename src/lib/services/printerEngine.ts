/**
 * Unified Multi-Method Printer Engine (Thermal POS Exclusive)
 * Mendukung 4 jalur pencetakan kasir murni:
 * 1. Web Bluetooth (BLE 4.0/5.0) — ESC/POS Direct
 * 2. WebUSB (Kabel USB Printer POS) — ESC/POS Direct
 * 3. Android Intent (RawBT / iMin Helper App) — Gzip Base64
 * 4. Server Lokal (RawBT Print Server di Windows/PC) — ESC/POS via WebSocket
 */

import { browser } from '$app/environment';
import {
	buildRawBtIntentUrl,
	buildSampleReceipt,
	DEFAULT_RECEIPT_SETTINGS,
	launchIntent,
	printViaIntent
} from '$lib/utils/receiptPrint';
import { renderReceipt } from '$lib/utils/receiptRaster';
import type { ReceiptData } from '$lib/utils/receiptLayout';
import {
	DEFAULT_PRINTER_CONFIG,
	parsePrinterConfig,
	type PaperSize,
	type PrinterConfig,
	type PrinterMethod,
	type PrintMode
} from '$lib/utils/printerConfig';

export type { PaperSize, PrinterConfig, PrinterMethod, PrintMode };
export type { AndroidPrinterApp } from '$lib/utils/printerConfig';

// Known BLE Service UUIDs used by common 58mm/80mm thermal printers
const KNOWN_BLE_SERVICES = [
	'000018f0-0000-1000-8000-00805f9b34fb', // Standard Thermal Printer Service
	'49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent Service
	'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // PosBank / Xprinter Service
	'0000ae00-0000-1000-8000-00805f9b34fb', // Goojprt / Mpt-II
	'0000fee7-0000-1000-8000-00805f9b34fb' // Tencent / Micro-printer
];

interface BluetoothCharacteristicLike {
	properties: {
		write?: boolean;
		writeWithoutResponse?: boolean;
	};
	writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
	writeValueWithResponse?: (data: BufferSource) => Promise<void>;
	writeValue?: (data: BufferSource) => Promise<void>;
}

interface BluetoothRemoteGATTServerLike {
	connected?: boolean;
	connect: () => Promise<BluetoothRemoteGATTServerLike>;
	disconnect: () => void;
	getPrimaryService: (service: string) => Promise<{
		getCharacteristics: () => Promise<BluetoothCharacteristicLike[]>;
	}>;
	getPrimaryServices?: () => Promise<
		Array<{
			getCharacteristics: () => Promise<BluetoothCharacteristicLike[]>;
		}>
	>;
}

interface BluetoothDeviceLike {
	name?: string;
	gatt?: BluetoothRemoteGATTServerLike;
}

interface UsbEndpointLike {
	endpointNumber: number;
	direction: 'in' | 'out';
}

interface UsbInterfaceLike {
	interfaceNumber: number;
	alternates: Array<{
		alternateSetting?: number;
		endpoints: UsbEndpointLike[];
	}>;
}

interface UsbDeviceLike {
	productName?: string;
	opened?: boolean;
	configuration: {
		interfaces: UsbInterfaceLike[];
	} | null;
	open: () => Promise<void>;
	selectConfiguration: (config: number) => Promise<void>;
	claimInterface: (interfaceNumber: number) => Promise<void>;
	selectAlternateInterface?: (interfaceNumber: number, alternateSetting: number) => Promise<void>;
	transferOut: (
		endpointNumber: number,
		data: Uint8Array | BufferSource
	) => Promise<{ status: string; bytesWritten?: number }>;
	close?: () => Promise<void>;
}

interface NavigatorHardware {
	bluetooth?: {
		requestDevice: (options: {
			acceptAllDevices?: boolean;
			optionalServices?: string[];
		}) => Promise<BluetoothDeviceLike>;
	};
	usb?: {
		requestDevice: (options: { filters: Array<{ classCode?: number }> }) => Promise<UsbDeviceLike>;
	};
}

// Active Hardware Connections Cache
let activeBluetoothDevice: BluetoothDeviceLike | null = null;
let activeBluetoothCharacteristic: BluetoothCharacteristicLike | null = null;
let activeUsbDevice: UsbDeviceLike | null = null;
let activeUsbEndpointNumber: number | null = null;
let printing = false;

async function printerTimeout<T>(
	operation: Promise<T>,
	message: string,
	timeout = 10_000
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeout);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Baca konfigurasi printer dari localStorage */
export function getPrinterConfig(): PrinterConfig {
	if (!browser) return { ...DEFAULT_PRINTER_CONFIG };
	try {
		const raw = localStorage.getItem('pos_printer_config');
		if (raw) return parsePrinterConfig(JSON.parse(raw));
	} catch {
		// fallback
	}
	return { ...DEFAULT_PRINTER_CONFIG };
}

/** Simpan konfigurasi printer ke localStorage */
export function savePrinterConfig(config: Partial<PrinterConfig>): PrinterConfig {
	const current = getPrinterConfig();
	const updated = parsePrinterConfig({ ...current, ...config });
	if (browser) {
		try {
			localStorage.setItem('pos_printer_config', JSON.stringify(updated));
		} catch {
			throw new Error(
				'Pengaturan printer tidak dapat disimpan. Izinkan penyimpanan situs lalu coba lagi.'
			);
		}
	}
	return updated;
}

/**
 * Nama perangkat yang diingat hanya kenyamanan. Penyimpanan situs yang diblokir tidak boleh
 * menggagalkan koneksi atau cetak; halaman Pengaturan Printer tetap melaporkannya lewat
 * savePrinterConfig langsung.
 */
function rememberPrinter(deviceName: string, method: 'bluetooth' | 'usb'): void {
	try {
		savePrinterConfig({ deviceName, method });
	} catch {
		// Koneksi yang baru dibuat tetap dipakai pada sesi ini.
	}
}

/** Periksa apakah Web Bluetooth didukung browser */
export function isBluetoothSupported(): boolean {
	if (!browser || typeof navigator === 'undefined') return false;
	const nav = navigator as unknown as NavigatorHardware;
	return typeof nav.bluetooth !== 'undefined';
}

/** Periksa apakah WebUSB didukung browser */
export function isUsbSupported(): boolean {
	if (!browser || typeof navigator === 'undefined') return false;
	const nav = navigator as unknown as NavigatorHardware;
	return typeof nav.usb !== 'undefined';
}

/** Hubungkan ke Printer Thermal Bluetooth (BLE) */
export async function connectBluetoothPrinter(): Promise<{ name: string }> {
	if (!isBluetoothSupported()) {
		throw new Error('Web Bluetooth tidak didukung di browser ini. Gunakan Chrome / Edge.');
	}

	const nav = navigator as unknown as NavigatorHardware;
	const navBluetooth = nav.bluetooth;
	if (!navBluetooth) {
		throw new Error('Web Bluetooth tidak tersedia di perangkat ini.');
	}

	const device = await navBluetooth.requestDevice({
		acceptAllDevices: true,
		optionalServices: KNOWN_BLE_SERVICES
	});

	if (!device || !device.gatt) {
		throw new Error('Gagal menghubungkan ke perangkat Bluetooth.');
	}

	const server = await printerTimeout(
		device.gatt.connect(),
		'Koneksi Bluetooth melewati batas waktu.'
	);
	let targetCharacteristic: BluetoothCharacteristicLike | null = null;

	// Iterasi services untuk mencari characteristic writable
	for (const serviceUuid of KNOWN_BLE_SERVICES) {
		try {
			const service = await printerTimeout(
				server.getPrimaryService(serviceUuid),
				'Layanan Bluetooth tidak merespons.',
				3_000
			);
			const characteristics = await printerTimeout(
				service.getCharacteristics(),
				'Karakteristik Bluetooth tidak merespons.',
				3_000
			);
			for (const char of characteristics) {
				if (char.properties.write || char.properties.writeWithoutResponse) {
					targetCharacteristic = char;
					break;
				}
			}
			if (targetCharacteristic) break;
		} catch {
			// service not available on this device, continue
		}
	}

	if (!targetCharacteristic) {
		// Fallback: coba cari seluruh services yang diekspos device
		if (typeof server.getPrimaryServices === 'function') {
			try {
				const services = await printerTimeout(
					server.getPrimaryServices(),
					'Pencarian layanan Bluetooth melewati batas waktu.',
					3_000
				);
				for (const service of services) {
					const characteristics = await printerTimeout(
						service.getCharacteristics(),
						'Karakteristik Bluetooth tidak merespons.',
						3_000
					);
					for (const char of characteristics) {
						if (char.properties.write || char.properties.writeWithoutResponse) {
							targetCharacteristic = char;
							break;
						}
					}
					if (targetCharacteristic) break;
				}
			} catch {
				// ignore
			}
		}
	}

	if (!targetCharacteristic) {
		server.disconnect();
		throw new Error('Karakteristik cetak tidak ditemukan pada printer Bluetooth ini.');
	}

	activeBluetoothDevice = device;
	activeBluetoothCharacteristic = targetCharacteristic;

	const deviceName = device.name || 'Printer Bluetooth';
	rememberPrinter(deviceName, 'bluetooth');

	return { name: deviceName };
}

/** Putus koneksi Bluetooth */
export function disconnectBluetooth(): void {
	if (activeBluetoothDevice && activeBluetoothDevice.gatt?.connected) {
		activeBluetoothDevice.gatt.disconnect();
	}
	activeBluetoothDevice = null;
	activeBluetoothCharacteristic = null;
}

/** Kirim data bytes ke Bluetooth dengan chunking antrean (cegah buffer overflow) */
async function sendBluetoothChunked(
	characteristic: BluetoothCharacteristicLike,
	data: Uint8Array
): Promise<void> {
	const CHUNK_SIZE = 20; // Minimum BLE ATT payload; works without assuming a negotiated larger MTU.
	for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
		const chunk = data.slice(offset, offset + CHUNK_SIZE);
		if (
			characteristic.properties.writeWithoutResponse &&
			characteristic.writeValueWithoutResponse
		) {
			// Each awaited write already waits for the GATT stack, which paces the printer;
			// an extra per-chunk sleep made a raster receipt take tens of seconds.
			await printerTimeout(
				characteristic.writeValueWithoutResponse(chunk),
				'Pengiriman Bluetooth melewati batas waktu. Periksa struk sebelum mencetak ulang.'
			);
		} else if (characteristic.writeValueWithResponse) {
			await printerTimeout(
				characteristic.writeValueWithResponse(chunk),
				'Pengiriman Bluetooth melewati batas waktu. Periksa struk sebelum mencetak ulang.'
			);
		} else if (characteristic.writeValue) {
			await printerTimeout(
				characteristic.writeValue(chunk),
				'Pengiriman Bluetooth melewati batas waktu. Periksa struk sebelum mencetak ulang.'
			);
		} else {
			throw new Error('Printer Bluetooth tidak menyediakan jalur pengiriman data.');
		}
	}
}

/** Hubungkan ke Printer Thermal USB */
export async function connectUsbPrinter(): Promise<{ name: string }> {
	if (!isUsbSupported()) {
		throw new Error('WebUSB tidak didukung di browser ini. Gunakan Chrome / Edge.');
	}

	const nav = navigator as unknown as NavigatorHardware;
	const navUsb = nav.usb;
	if (!navUsb) {
		throw new Error('WebUSB tidak tersedia di perangkat ini.');
	}

	const device = await navUsb.requestDevice({
		// Printer Class (7) and vendor-specific thermal devices share the explicit device chooser.
		filters: []
	});

	if (!device) {
		throw new Error('Printer USB tidak dipilih.');
	}

	try {
		await printerTimeout(
			device.open(),
			'Printer USB tidak dapat dibuka. Periksa driver dan koneksi kabel.'
		);
		if (device.configuration === null) {
			await printerTimeout(
				device.selectConfiguration(1),
				'Konfigurasi printer USB melewati batas waktu.'
			);
		}

		// Cari interface printer
		let targetInterface: UsbInterfaceLike | null = null;
		let outEndpoint: UsbEndpointLike | null = null;
		let alternateSetting: number | undefined;

		if (device.configuration) {
			for (const iface of device.configuration.interfaces) {
				for (const alt of iface.alternates) {
					for (const ep of alt.endpoints) {
						if (ep.direction === 'out') {
							targetInterface = iface;
							outEndpoint = ep;
							alternateSetting = alt.alternateSetting;
							break;
						}
					}
					if (outEndpoint) break;
				}
				if (outEndpoint) break;
			}
		}

		if (!targetInterface || !outEndpoint) {
			throw new Error('Endpoint printer USB tidak ditemukan.');
		}

		await printerTimeout(
			device.claimInterface(targetInterface.interfaceNumber),
			'Printer USB sedang dipakai aplikasi atau driver lain.'
		);
		if (alternateSetting !== undefined && device.selectAlternateInterface)
			await printerTimeout(
				device.selectAlternateInterface(targetInterface.interfaceNumber, alternateSetting),
				'Pemilihan jalur USB melewati batas waktu.'
			);
		activeUsbDevice = device;
		activeUsbEndpointNumber = outEndpoint.endpointNumber;

		const deviceName = device.productName || 'Printer USB';
		rememberPrinter(deviceName, 'usb');

		return { name: deviceName };
	} catch (error) {
		try {
			if (device.close)
				await printerTimeout(device.close(), 'Penutupan USB melewati batas waktu.', 1_000);
		} catch {
			// Best effort: a failed setup must release its device without hiding the original error.
		}
		activeUsbDevice = null;
		activeUsbEndpointNumber = null;
		throw error;
	}
}

/** Kirim data bytes ke Printer USB */
async function sendUsbData(
	device: UsbDeviceLike,
	endpointNumber: number,
	data: Uint8Array
): Promise<void> {
	for (let offset = 0; offset < data.length;) {
		const chunk = data.slice(offset, offset + 4096);
		const result = await printerTimeout(
			device.transferOut(endpointNumber, chunk),
			'Pengiriman USB melewati batas waktu. Periksa struk sebelum mencetak ulang.'
		);
		if (
			result.status !== 'ok' ||
			(result.bytesWritten !== undefined &&
				(!Number.isInteger(result.bytesWritten) ||
					result.bytesWritten <= 0 ||
					result.bytesWritten > chunk.length))
		)
			throw new Error('Pengiriman USB tidak lengkap. Periksa struk sebelum mencetak ulang.');
		offset += result.bytesWritten ?? chunk.length;
	}
}

// Endpoint RawBT Print Server lokal (dijalankan di PC kasir Windows).
const LOCAL_PRINT_WS_ENDPOINTS = ['ws://localhost:40213/', 'ws://127.0.0.1:40213/'];

/** WebSocket can fail over only before sending; an uncertain print must never be sent twice. */
async function sendToLocalServer(intentUrl: string): Promise<void> {
	for (const url of LOCAL_PRINT_WS_ENDPOINTS) {
		if (await sendToLocalServerWs(intentUrl, url)) return;
	}
	throw new Error(
		"Server printer lokal tidak merespons. Pastikan 'RawBT Print Server' berjalan dan izinkan akses jaringan lokal."
	);
}

function sendToLocalServerWs(intentUrl: string, url: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		let sent = false;
		let finished = false;
		let socket: WebSocket | undefined;
		let drain: ReturnType<typeof setInterval> | undefined;
		const finish = (error?: Error) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			clearInterval(drain);
			if (socket) {
				socket.onopen = socket.onclose = socket.onerror = null;
				socket.close();
			}
			if (error) reject(error);
			else resolve(sent);
		};
		const uncertain = () =>
			new Error('Pengiriman server printer terputus. Periksa struk sebelum mencetak ulang.');
		const timer = setTimeout(() => finish(sent ? uncertain() : undefined), 5_000);
		try {
			socket = new WebSocket(url);
			socket.onopen = () => {
				try {
					sent = true;
					socket!.send(intentUrl);
					const flushed = () => {
						if (socket?.bufferedAmount === 0) finish();
					};
					drain = setInterval(flushed, 25);
					flushed();
				} catch {
					finish(uncertain());
				}
			};
			socket.onerror = () => finish(sent ? uncertain() : undefined);
			// Server yang menutup koneksi setelah menerima pekerjaan itu normal. Browser tidak
			// me-reset bufferedAmount saat close, jadi 0 berarti semua byte sudah keluar.
			socket.onclose = () => finish(sent && socket!.bufferedAmount > 0 ? uncertain() : undefined);
		} catch {
			finish();
		}
	});
}

export interface UnifiedPrintPayload {
	receiptData: ReceiptData;
}

/**
 * Router Utama Cetak Struk
 * Otomatis menggunakan salah satu dari 4 metode yang dipilih user di Pengaturan Printer.
 */
export async function printReceiptUnified(payload: UnifiedPrintPayload): Promise<void> {
	await executePrint(payload.receiptData, getPrinterConfig());
}

async function executePrint(data: ReceiptData, config: PrinterConfig): Promise<void> {
	if (!browser) throw new Error('Cetak struk hanya tersedia di browser.');
	if (printing) throw new Error('Pencetakan masih berlangsung. Tunggu sampai pengiriman selesai.');
	printing = true;
	try {
		// Device selection must start within the click's user activation, before rasterization awaits.
		if (
			config.method === 'bluetooth' &&
			(!activeBluetoothCharacteristic || !activeBluetoothDevice?.gatt?.connected)
		)
			await connectBluetoothPrinter();
		if (
			config.method === 'usb' &&
			(!activeUsbDevice || activeUsbDevice.opened === false || activeUsbEndpointNumber === null)
		)
			await connectUsbPrinter();
		if (config.method === 'intent' && !/Android/i.test(navigator.userAgent))
			throw new Error(
				'Metode Aplikasi Android membutuhkan perangkat Android dan aplikasi helper. Pilih USB atau Server Lokal untuk komputer.'
			);
		// The HTML print-intent helper prints a picture, so it never takes the printer-font mode.
		const htmlOnly = config.method === 'intent' && config.androidApp !== 'rawbt';
		const rendered = await renderReceipt(
			data,
			config.paperSize,
			htmlOnly ? 'image' : config.printMode
		);
		const bytes = rendered.escpos;
		switch (config.method) {
			case 'bluetooth':
				if (!activeBluetoothCharacteristic) throw new Error('Printer Bluetooth belum terhubung.');
				await sendBluetoothChunked(activeBluetoothCharacteristic, bytes);
				break;
			case 'usb':
				if (!activeUsbDevice || activeUsbEndpointNumber === null)
					throw new Error('Printer USB belum terhubung.');
				await sendUsbData(activeUsbDevice, activeUsbEndpointNumber, bytes);
				break;
			case 'server':
				await sendToLocalServer(buildRawBtIntentUrl(bytes));
				break;
			case 'intent':
				if (config.androidApp === 'rawbt') {
					const intent = buildRawBtIntentUrl(bytes);
					if (intent.length > 400_000)
						throw new Error(
							'Struk terlalu panjang untuk RawBT Android. Gunakan USB atau Bluetooth langsung.'
						);
					launchIntent(intent);
				} else {
					await printViaIntent(rendered.html);
				}
				break;
		}
	} catch (error) {
		if (config.method === 'bluetooth') disconnectBluetooth();
		if (config.method === 'usb' && activeUsbDevice) {
			try {
				if (activeUsbDevice.close)
					await printerTimeout(
						activeUsbDevice.close(),
						'Penutupan koneksi USB melewati batas waktu.',
						1_000
					);
			} catch {
				// Best effort: discard a failed device even when its driver cannot close cleanly.
			}
			activeUsbDevice = null;
			activeUsbEndpointNumber = null;
		}
		throw error;
	} finally {
		printing = false;
	}
}

/** Jalankan Tes Cetak Struk Uji Coba */
export async function testPrintUnified(
	method: PrinterMethod,
	paperSize: PaperSize,
	data: ReceiptData = buildSampleReceipt(DEFAULT_RECEIPT_SETTINGS),
	androidApp: PrinterConfig['androidApp'] = getPrinterConfig().androidApp,
	printMode: PrintMode = getPrinterConfig().printMode
): Promise<void> {
	await executePrint(data, { ...getPrinterConfig(), method, paperSize, androidApp, printMode });
}
