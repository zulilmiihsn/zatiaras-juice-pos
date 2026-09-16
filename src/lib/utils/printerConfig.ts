export type PrinterMethod = 'bluetooth' | 'usb' | 'intent' | 'server';
export type PaperSize = '58mm' | '80mm';

export interface PrinterConfig {
	method: PrinterMethod;
	paperSize: PaperSize;
	deviceName?: string;
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
	method: 'intent',
	paperSize: '58mm',
	deviceName: ''
};

/** Normalisasi konfigurasi printer mentah (murni, tanpa localStorage). */
export function parsePrinterConfig(raw: unknown): PrinterConfig {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_PRINTER_CONFIG };
	const parsed = raw as Partial<Record<keyof PrinterConfig, unknown>>;
	const method = parsed.method;
	return {
		method:
			method === 'bluetooth' || method === 'usb' || method === 'intent' || method === 'server'
				? method
				: DEFAULT_PRINTER_CONFIG.method,
		paperSize: parsed.paperSize === '80mm' ? '80mm' : '58mm',
		deviceName: typeof parsed.deviceName === 'string' ? parsed.deviceName : ''
	};
}
