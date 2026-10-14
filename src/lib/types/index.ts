/**
 * 📚 TYPE DEFINITIONS INDEX
 *
 * Central export file untuk semua type definitions
 * Import semua types dari sini untuk konsistensi
 */

// ============================================================================
// 🍹 PRODUCT TYPES
// ============================================================================

export * from './product';
export * from './cart';

// ============================================================================
// 📊 LAPORAN & REPORT TYPES
// ============================================================================

export * from './laporan';
export * from './pajak';

// ============================================================================
// 🏪 STORE & SESSION TYPES
// ============================================================================

export * from './store';

// ============================================================================
// 🔔 NOTIFICATION & MODAL TYPES
// ============================================================================

export type NotifModalType = 'warning' | 'success' | 'error';

// ============================================================================
// 🎯 ERROR & EXCEPTION TYPES
// ============================================================================

export interface AppError {
	code: string;
	message: string;
	details?: string;
	stack?: string;
	timestamp: number;
	user_id?: string;
	context?: Record<string, unknown>;
}

export interface ValidationError {
	field: string;
	message: string;
	value?: unknown;
}

export interface ApiError {
	status: number;
	statusText: string;
	message: string;
	errors?: ValidationError[];
	timestamp: number;
}
