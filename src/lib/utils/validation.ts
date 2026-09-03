// [CATATAN]: Validation utilities untuk sistem POS Zatiaras

export interface ValidationRule {
	required?: boolean;
	minLength?: number;
	maxLength?: number;
	pattern?: RegExp;
	min?: number;
	max?: number;
	custom?: (value: string) => string | null;
}

export interface ValidationResult {
	isValid: boolean;
	errors: string[];
}

// [CATATAN]: Sanitasi input untuk mencegah XSS dan injection
export function sanitizeInput(input: string): string {
	if (typeof input !== 'string') return '';

	return input
		.trim()
		.replace(/[<>]/g, '') // Remove potential HTML tags
		.replace(/javascript:/gi, '') // Remove javascript: protocol
		.replace(/on\w+=/gi, '') // Remove event handlers
		.replace(/script/gi, '') // Remove script tags
		.replace(/iframe/gi, ''); // Remove iframe tags
}

// [CATATAN]: Validasi nomor (untuk harga, quantity, dll)
export function validateNumber(value: unknown, rules: ValidationRule = {}): ValidationResult {
	const errors: string[] = [];

	if (rules.required && (value === null || value === undefined || value === '')) {
		errors.push('Field ini wajib diisi');
		return { isValid: false, errors };
	}

	if (value === null || value === undefined || value === '') {
		return { isValid: true, errors: [] };
	}

	const numValue =
		typeof value === 'string' ? parseFloat(value.replace(/[^\d.-]/g, '')) : Number(value);

	if (isNaN(numValue)) {
		errors.push('Nilai harus berupa angka');
		return { isValid: false, errors };
	}

	if (rules.min !== undefined && numValue < rules.min) {
		errors.push(`Nilai minimal adalah ${rules.min}`);
	}

	if (rules.max !== undefined && numValue > rules.max) {
		errors.push(`Nilai maksimal adalah ${rules.max}`);
	}

	return { isValid: errors.length === 0, errors };
}

// [CATATAN]: Validasi teks
export function validateText(value: unknown, rules: ValidationRule = {}): ValidationResult {
	const errors: string[] = [];

	if (rules.required && (!value || value.toString().trim() === '')) {
		errors.push('Field ini wajib diisi');
		return { isValid: false, errors };
	}

	if (!value || value.toString().trim() === '') {
		return { isValid: true, errors: [] };
	}

	const strValue = value.toString().trim();

	if (rules.minLength && strValue.length < rules.minLength) {
		errors.push(`Minimal ${rules.minLength} karakter`);
	}

	if (rules.maxLength && strValue.length > rules.maxLength) {
		errors.push(`Maksimal ${rules.maxLength} karakter`);
	}

	if (rules.pattern && !rules.pattern.test(strValue)) {
		errors.push('Format tidak valid');
	}

	if (rules.custom) {
		const customError = rules.custom(strValue);
		if (customError) {
			errors.push(customError);
		}
	}

	return { isValid: errors.length === 0, errors };
}

// [CATATAN]: Validasi password (simplified - untuk demo)
export function validatePasswordDemo(password: string): ValidationResult {
	return validateText(password, {
		required: true,
		minLength: 6
	});
}

// [CATATAN]: Validasi pemasukan/pengeluaran
export function validateIncomeExpense(data: {
	nominal?: unknown;
	jenis?: unknown;
	deskripsi?: unknown;
}): ValidationResult {
	const errors: string[] = [];

	// [CATATAN]: Validasi nominal
	const amountValidation = validateNumber(data.nominal, {
		required: true,
		min: 0
	});
	if (!amountValidation.isValid) {
		errors.push(`Nominal: ${amountValidation.errors.join(', ')}`);
	}

	// [CATATAN]: Validasi jenis
	if (!data.jenis) {
		errors.push('Jenis harus dipilih');
	}

	// [CATATAN]: Validasi deskripsi
	const descriptionValidation = validateText(data.deskripsi, {
		required: true,
		minLength: 3,
		maxLength: 200
	});
	if (!descriptionValidation.isValid) {
		errors.push(`Deskripsi: ${descriptionValidation.errors.join(', ')}`);
	}

	return { isValid: errors.length === 0, errors };
}

// [CATATAN]: Validasi waktu
export function validateTime(time: string): ValidationResult {
	const errors: string[] = [];

	if (!time) {
		errors.push('Waktu harus diisi');
		return { isValid: false, errors };
	}

	const timePattern = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

	if (!timePattern.test(time)) {
		errors.push('Format waktu tidak valid (HH:MM)');
		return { isValid: false, errors };
	}

	return { isValid: true, errors: [] };
}

// ── Schema Runtime Validators (DEBT-001) ──────────────────────────────────

export interface RuntimeValidation<T> {
	success: boolean;
	data?: T;
	error?: string;
}

export function validateCheckoutPayload(input: unknown): RuntimeValidation<{
	items: Array<{ product_id?: string; jumlah: number; [key: string]: unknown }>;
	metode_bayar: string;
	idempotency_key: string;
	cash_received?: number;
	customer_name?: string;
}> {
	if (!input || typeof input !== 'object') {
		return { success: false, error: 'Payload transaksi harus berupa object' };
	}
	const obj = input as Record<string, unknown>;
	if (!Array.isArray(obj.items) || obj.items.length === 0) {
		return { success: false, error: 'Item transaksi tidak boleh kosong' };
	}
	for (const it of obj.items) {
		if (
			!it ||
			typeof it !== 'object' ||
			typeof (it as Record<string, unknown>).jumlah !== 'number'
		) {
			return { success: false, error: 'Setiap item harus memiliki jumlah valid' };
		}
	}
	if (typeof obj.idempotency_key !== 'string' || obj.idempotency_key.length < 8) {
		return { success: false, error: 'idempotency_key harus berupa string minimal 8 karakter' };
	}
	const metode = typeof obj.metode_bayar === 'string' ? obj.metode_bayar : 'tunai';
	return {
		success: true,
		data: {
			items: obj.items as Array<{ product_id?: string; jumlah: number }>,
			metode_bayar: metode,
			idempotency_key: obj.idempotency_key,
			cash_received: typeof obj.cash_received === 'number' ? obj.cash_received : undefined,
			customer_name: typeof obj.nama_pelanggan === 'string' ? obj.nama_pelanggan : undefined
		}
	};
}

export function validateTaxConfigPayload(input: unknown): RuntimeValidation<{
	enabled: boolean;
	rate: number;
	apply_threshold: boolean;
	threshold?: number;
	nama?: string;
}> {
	if (!input || typeof input !== 'object') {
		return { success: false, error: 'Payload konfigurasi pajak harus berupa object' };
	}
	const obj = input as Record<string, unknown>;
	if (typeof obj.enabled !== 'boolean') {
		return { success: false, error: 'Field enabled harus bertipe boolean' };
	}
	const rate = Number(obj.rate);
	if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
		return { success: false, error: 'Rate pajak harus antara 0 dan 1 (0% - 100%)' };
	}
	const threshold =
		typeof obj.threshold === 'number' && Number.isFinite(obj.threshold) ? obj.threshold : undefined;
	return {
		success: true,
		data: {
			enabled: obj.enabled,
			rate,
			apply_threshold: Boolean(obj.apply_threshold),
			threshold,
			nama: typeof obj.nama === 'string' ? obj.nama : undefined
		}
	};
}
