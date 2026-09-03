/**
 * Unified Multi-Method Printer Engine (Thermal POS Exclusive)
 * Mendukung 3 jalur pencetakan kasir murni:
 * 1. Web Bluetooth (BLE 4.0/5.0) — ESC/POS Direct
 * 2. WebUSB (Kabel USB Printer POS) — ESC/POS Direct
 * 3. Android Intent (RawBT / iMin Helper App) — Gzip Base64
 */

import { browser } from '$app/environment';
import { buildReceiptEscPos } from '$lib/utils/escposBuilder';
import { printViaIntent } from '$lib/utils/receiptPrint';

export type PrinterMethod = 'bluetooth' | 'usb' | 'intent';
export type PaperSize = '58mm' | '80mm';

export interface PrinterConfig {
	method: PrinterMethod;
	paperSize: PaperSize;
	deviceName?: string;
}

const DEFAULT_CONFIG: PrinterConfig = {
	method: 'intent',
	paperSize: '58mm',
	deviceName: ''
};

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
		endpoints: UsbEndpointLike[];
	}>;
}

interface UsbDeviceLike {
	productName?: string;
	configuration: {
		interfaces: UsbInterfaceLike[];
	} | null;
	open: () => Promise<void>;
	selectConfiguration: (config: number) => Promise<void>;
	claimInterface: (interfaceNumber: number) => Promise<void>;
	transferOut: (endpointNumber: number, data: Uint8Array | BufferSource) => Promise<unknown>;
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

/** Baca konfigurasi printer dari localStorage */
export function getPrinterConfig(): PrinterConfig {
	if (!browser) return DEFAULT_CONFIG;
	try {
		const raw = localStorage.getItem('pos_printer_config');
		if (raw) {
			const parsed = JSON.parse(raw);
			return {
				method:
					parsed.method === 'bluetooth' || parsed.method === 'usb' || parsed.method === 'intent'
						? parsed.method
						: DEFAULT_CONFIG.method,
				paperSize: parsed.paperSize === '80mm' ? '80mm' : '58mm',
				deviceName: parsed.deviceName || ''
			};
		}
	} catch {
		// fallback
	}
	return DEFAULT_CONFIG;
}

/** Simpan konfigurasi printer ke localStorage */
export function savePrinterConfig(config: Partial<PrinterConfig>): PrinterConfig {
	const current = getPrinterConfig();
	const updated = { ...current, ...config };
	if (browser) {
		try {
			localStorage.setItem('pos_printer_config', JSON.stringify(updated));
		} catch {
			// ignore
		}
	}
	return updated;
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

	const server = await device.gatt.connect();
	let targetCharacteristic: BluetoothCharacteristicLike | null = null;

	// Iterasi services untuk mencari characteristic writable
	for (const serviceUuid of KNOWN_BLE_SERVICES) {
		try {
			const service = await server.getPrimaryService(serviceUuid);
			const characteristics = await service.getCharacteristics();
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
				const services = await server.getPrimaryServices();
				for (const service of services) {
					const characteristics = await service.getCharacteristics();
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
		throw new Error('Karakteristik cetak tidak ditemukan pada printer Bluetooth ini.');
	}

	activeBluetoothDevice = device;
	activeBluetoothCharacteristic = targetCharacteristic;

	const deviceName = device.name || 'Printer Bluetooth';
	savePrinterConfig({ deviceName, method: 'bluetooth' });

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
	const CHUNK_SIZE = 64; // safe MTU size for cheap thermal printers
	for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
		const chunk = data.slice(offset, offset + CHUNK_SIZE);
		if (
			characteristic.properties.writeWithoutResponse &&
			characteristic.writeValueWithoutResponse
		) {
			await characteristic.writeValueWithoutResponse(chunk);
		} else if (characteristic.writeValueWithResponse) {
			await characteristic.writeValueWithResponse(chunk);
		} else if (characteristic.writeValue) {
			await characteristic.writeValue(chunk);
		}
		// Delay kecil 15ms agar buffer printer sempat memproses
		await new Promise((r) => setTimeout(r, 15));
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

	const device = await navUsb
		.requestDevice({
			filters: [{ classCode: 7 }] // 7 = Printer Class
		})
		.catch(async () => {
			// Fallback: accept any USB device
			return await navUsb.requestDevice({ filters: [] });
		});

	if (!device) {
		throw new Error('Printer USB tidak dipilih.');
	}

	await device.open();
	if (device.configuration === null) {
		await device.selectConfiguration(1);
	}

	// Cari interface printer
	let targetInterface: UsbInterfaceLike | null = null;
	let outEndpoint: UsbEndpointLike | null = null;

	if (device.configuration) {
		for (const iface of device.configuration.interfaces) {
			for (const alt of iface.alternates) {
				for (const ep of alt.endpoints) {
					if (ep.direction === 'out') {
						targetInterface = iface;
						outEndpoint = ep;
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

	await device.claimInterface(targetInterface.interfaceNumber);
	activeUsbDevice = device;
	activeUsbEndpointNumber = outEndpoint.endpointNumber;

	const deviceName = device.productName || 'Printer USB';
	savePrinterConfig({ deviceName, method: 'usb' });

	return { name: deviceName };
}

/** Kirim data bytes ke Printer USB */
async function sendUsbData(
	device: UsbDeviceLike,
	endpointNumber: number,
	data: Uint8Array
): Promise<void> {
	await device.transferOut(endpointNumber, data);
}

export interface UnifiedPrintPayload {
	html: string;
	receiptData?: Parameters<typeof buildReceiptEscPos>[0];
}

/**
 * Router Utama Cetak Struk
 * Otomatis menggunakan salah satu dari 3 metode yang dipilih user di Pengaturan Printer.
 */
export async function printReceiptUnified(payload: UnifiedPrintPayload): Promise<void> {
	const config = getPrinterConfig();

	switch (config.method) {
		case 'bluetooth': {
			if (!activeBluetoothCharacteristic) {
				await connectBluetoothPrinter();
			}
			if (payload.receiptData && activeBluetoothCharacteristic) {
				const bytes = buildReceiptEscPos(payload.receiptData, { paperSize: config.paperSize });
				await sendBluetoothChunked(activeBluetoothCharacteristic, bytes);
				return;
			}
			// Fallback ke intent bila binary builder tidak tersedia
			printViaIntent(payload.html);
			break;
		}

		case 'usb': {
			if (!activeUsbDevice || activeUsbEndpointNumber === null) {
				await connectUsbPrinter();
			}
			if (payload.receiptData && activeUsbDevice && activeUsbEndpointNumber !== null) {
				const bytes = buildReceiptEscPos(payload.receiptData, { paperSize: config.paperSize });
				await sendUsbData(activeUsbDevice, activeUsbEndpointNumber, bytes);
				return;
			}
			printViaIntent(payload.html);
			break;
		}

		case 'intent':
		default: {
			printViaIntent(payload.html);
			break;
		}
	}
}

/** Jalankan Tes Cetak Struk Uji Coba */
export async function testPrintUnified(method: PrinterMethod, paperSize: PaperSize): Promise<void> {
	const dummyData = {
		storeName: 'ZATIARAS JUICE',
		address: 'Jl. Contoh Alamat No. 123',
		phone: '0812-3456-7890',
		instagram: '@zatiarasjuice',
		customerName: 'Pelanggan Tes',
		dateTime: new Date().toLocaleString('id-ID'),
		items: [
			{ name: 'Jus Mangga (Jumbo)', qty: 1, price: 15000, details: 'Normal' },
			{ name: 'Jus Alpukat', qty: 1, price: 12000, addOns: [{ name: 'Topping Nata', price: 3000 }] }
		],
		total: 30000,
		paymentMethod: 'tunai',
		cashReceived: 50000,
		change: 20000,
		footerMessage: 'TES PRINT BERHASIL!\nTerima kasih sudah ngejus.'
	};

	const dummyHtml = `
		<div style="text-align:center; font-family:monospace;">
			<h3>ZATIARAS JUICE</h3>
			<p>Jl. Contoh Alamat No. 123</p>
			<hr/>
			<p>TES CETAK STRUK BERHASIL</p>
			<p>Total: Rp30.000 (Tunai)</p>
			<hr/>
			<p>Metode: ${method.toUpperCase()} (${paperSize})</p>
		</div>
	`;

	if (method === 'bluetooth') {
		if (!activeBluetoothCharacteristic) {
			await connectBluetoothPrinter();
		}
		if (activeBluetoothCharacteristic) {
			const bytes = buildReceiptEscPos(dummyData, { paperSize });
			await sendBluetoothChunked(activeBluetoothCharacteristic, bytes);
		} else {
			throw new Error('Koneksi Bluetooth printer gagal dibentuk');
		}
	} else if (method === 'usb') {
		if (!activeUsbDevice || activeUsbEndpointNumber === null) {
			await connectUsbPrinter();
		}
		if (activeUsbDevice && activeUsbEndpointNumber !== null) {
			const bytes = buildReceiptEscPos(dummyData, { paperSize });
			await sendUsbData(activeUsbDevice, activeUsbEndpointNumber, bytes);
		} else {
			throw new Error('Koneksi USB printer gagal dibentuk');
		}
	} else {
		printViaIntent(dummyHtml);
	}
}
