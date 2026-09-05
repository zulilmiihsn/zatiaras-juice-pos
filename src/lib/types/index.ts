/**
 * 📚 TYPE DEFINITIONS INDEX
 *
 * Central export file untuk semua type definitions
 * Import semua types dari sini untuk konsistensi
 */

// ============================================================================
// [CATATAN]: 🍹 PRODUCT TYPES
// ============================================================================

export * from './product';
export * from './cart';

// ============================================================================
// [CATATAN]: 📊 LAPORAN & REPORT TYPES
// ============================================================================

export * from './laporan';
export * from './pajak';

// ============================================================================
// [CATATAN]: 🏪 STORE & SESSION TYPES
// ============================================================================

export * from './store';

// ============================================================================
// [CATATAN]: 🔔 NOTIFICATION & MODAL TYPES
// ============================================================================

export type NotifModalType = 'warning' | 'success' | 'error';

// ============================================================================
// [CATATAN]: 🎯 ERROR & EXCEPTION TYPES
// ============================================================================

export interface AppError {
	code: string;
	message: string;
	details?: string;
	stack?: string;
	timestamp: number;
	user_id?: string;
	context?: Record<string, any>;
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
