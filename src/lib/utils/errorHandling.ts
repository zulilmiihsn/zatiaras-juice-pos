import type { AppError, ValidationError } from '$lib/types';
import { securityUtils } from '$lib/utils/security';

type ApiErrorPayload = {
	success?: boolean;
	code?: string;
	message?: string;
	error?: string;
	retryAfterSeconds?: number;
};

type NormalizedApiError = {
	status: number;
	code?: string;
	message: string;
	retryAfterSeconds?: number;
};

/**
 * Standardized error handling utilities
 */

export class ErrorHandler {
	/**
	 * Create a standardized error object
	 */
	static createError(message: string, code?: string, details?: Record<string, any>): AppError {
		return {
			message,
			code: code || 'UNKNOWN_ERROR',
			details: details ? JSON.stringify(details) : undefined,
			timestamp: Date.now(),
			stack: new Error().stack
		};
	}

	/**
	 * Create a validation error
	 */
	static createValidationError(field: string, message: string, value?: unknown): ValidationError {
		return {
			field,
			message,
			value
		};
	}

	/**
	 * Safely extract error message from various error types
	 */
	static extractErrorMessage(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}

		if (typeof error === 'string') {
			return error;
		}

		if (error && typeof error === 'object') {
			// [CATATAN]: Handle PostgrestError
			if ('message' in error && typeof error.message === 'string') {
				return error.message;
			}

			// [CATATAN]: Handle error_description
			if ('error_description' in error && typeof error.error_description === 'string') {
				return error.error_description;
			}

			// [CATATAN]: Handle any other object with message property
			if ('message' in error && typeof error.message === 'string') {
				return error.message;
			}
		}

		return 'Unknown error occurred';
	}

	/**
	 * Log error with consistent format
	 */
	static logError(error: unknown, context?: string): void {
		const errorMessage = this.extractErrorMessage(error);
		const timestamp = new Date().toISOString();
		const contextStr = context ? ` [${context}]` : '';

		if (typeof window !== 'undefined') {
			securityUtils.logSecurityEvent('client_error', {
				message: errorMessage,
				context,
				timestamp
			});
			return;
		}

		console.error(`[APP_ERROR]${contextStr}`, { message: errorMessage, timestamp });
	}

	/**
	 * Handle async operations with consistent error handling
	 */
	static async handleAsync<T>(
		operation: () => Promise<T>,
		context?: string
	): Promise<{ data: T | null; error: AppError | null }> {
		try {
			const data = await operation();
			return { data, error: null };
		} catch (error) {
			const appError = this.createError(this.extractErrorMessage(error), 'ASYNC_OPERATION_FAILED', {
				context
			});

			this.logError(error, context);
			return { data: null, error: appError };
		}
	}

	/**
	 * Format error for user display
	 */
	static formatForUser(error: unknown): string {
		const message = this.extractErrorMessage(error);

		// [CATATAN]: Map common error messages to user-friendly versions
		const userFriendlyMessages: Record<string, string> = {
			'Failed to fetch': 'Gagal mengambil data dari server',
			'Network Error': 'Koneksi internet bermasalah',
			Unauthorized: 'Sesi login telah berakhir, silakan login ulang',
			Forbidden: 'Anda tidak memiliki akses ke fitur ini',
			'Not Found': 'Data yang dicari tidak ditemukan',
			'Internal Server Error': 'Terjadi kesalahan pada server',
			'Bad Request': 'Data yang dikirim tidak valid'
		};

		return userFriendlyMessages[message] || message;
	}
}

function formatRetryMessage(baseMessage: string, retryAfterSeconds?: number): string {
	if (!retryAfterSeconds || retryAfterSeconds <= 0) {
		return baseMessage;
	}

	return `${baseMessage} Coba lagi dalam ${retryAfterSeconds} detik.`;
}

function toUserMessage(normalized: NormalizedApiError): string {
	const { status, code, message, retryAfterSeconds } = normalized;

	if (code === 'INVALID_CREDENTIALS') {
		return 'Username atau password salah.';
	}

	if (code === 'CSRF_INVALID') {
		return 'Sesi keamanan berakhir. Silakan coba lagi.';
	}

	if (code === 'UNAUTHORIZED' || status === 401) {
		return 'Sesi login berakhir. Silakan login ulang.';
	}

	if (code === 'FORBIDDEN' || status === 403) {
		return 'Anda tidak memiliki akses untuk tindakan ini.';
	}

	if (code === 'RATE_LIMITED' || status === 429) {
		return formatRetryMessage('Terlalu banyak percobaan.', retryAfterSeconds);
	}

	if (code === 'SERVICE_UNAVAILABLE') {
		return 'Layanan sedang tidak tersedia. Silakan coba lagi nanti.';
	}

	if (message?.trim()) {
		return message;
	}

	if (status >= 500) {
		return 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
	}

	return 'Permintaan tidak dapat diproses.';
}

export function normalizeApiErrorPayload(
	payload: ApiErrorPayload | null | undefined,
	status: number,
	fallbackMessage: string
): NormalizedApiError {
	const retryAfterSeconds =
		typeof payload?.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : undefined;

	return {
		status,
		code: payload?.code,
		message: payload?.message || payload?.error || fallbackMessage,
		retryAfterSeconds
	};
}

export async function parseApiError(response: Response, fallbackMessage: string): Promise<string> {
	const payload = (await response
		.clone()
		.json()
		.catch(() => null)) as ApiErrorPayload | null;
	return String(payload?.message || payload?.error || fallbackMessage);
}

export function getApiErrorMessage(
	payload: ApiErrorPayload | null | undefined,
	status: number,
	fallbackMessage: string
): string {
	return toUserMessage(normalizeApiErrorPayload(payload, status, fallbackMessage));
}

export async function getApiErrorMessageFromResponse(
	response: Response,
	fallbackMessage: string
): Promise<string> {
	let payload: ApiErrorPayload | null = null;
	try {
		payload = await response.clone().json();
	} catch {
		payload = null;
	}

	return getApiErrorMessage(payload, response.status, fallbackMessage);
}

export function reportApiFailure(
	payload: ApiErrorPayload | null | undefined,
	status: number,
	endpoint: string
): void {
	const normalized = normalizeApiErrorPayload(payload, status, 'API request failed');

	securityUtils.logSecurityEvent('api_request_failed', {
		endpoint,
		status: normalized.status,
		code: normalized.code,
		retryAfterSeconds: normalized.retryAfterSeconds,
		message: normalized.message
	});
}

export async function reportApiFailureFromResponse(
	response: Response,
	endpoint: string
): Promise<void> {
	let payload: ApiErrorPayload | null = null;
	try {
		payload = await response.clone().json();
	} catch {
		payload = null;
	}

	reportApiFailure(payload, response.status, endpoint);
}
