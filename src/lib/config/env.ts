// Environment configuration
export const config = {
	// Environment
	NODE_ENV: import.meta.env.MODE || 'development',

	// API Endpoints
	OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',

	// Model AI hanya di $lib/server/aiGateway (DEFAULT_AI_MODEL, gratis saja).

	// Request configuration
	MAX_TOKENS: 2000,
	TEMPERATURE: 0.7
};
