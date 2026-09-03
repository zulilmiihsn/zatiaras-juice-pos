export interface AiChatMessage {
	id: string;
	content: string;
	role: 'user' | 'assistant';
	timestamp: Date;
}

export interface TransactionAnalysis {
	id: string;
	originalText: string;
	detectedTransactions: DetectedTransaction[];
	recommendations: AiRecommendation[];
	confidence: number;
}

export interface DetectedTransaction {
	type: 'pemasukan' | 'pengeluaran' | 'penjualan' | 'unknown';
	amount: number;
	deskripsi: string;
	category?: string;
	confidence: number;
	products?: unknown[]; // Product details for sales transactions
}

export interface AiRecommendation {
	id: string;
	action: 'create_transaction' | 'update_transaction' | 'create_category';
	title: string;
	deskripsi: string;
	data: unknown;
	priority: 'high' | 'medium' | 'low';
}

export interface AiChatState {
	isOpen: boolean;
	messages: AiChatMessage[];
	isLoading: boolean;
	currentAnalysis?: TransactionAnalysis;
}

export interface AutoApplyResult {
	success: boolean;
	appliedRecommendations: string[];
	errors: string[];
	message: string;
}
