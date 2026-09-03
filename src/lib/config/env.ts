// [CATATAN]: Environment configuration
export const config = {
	// [CATATAN]: Environment
	NODE_ENV: import.meta.env.MODE || 'development',

	// [CATATAN]: API Endpoints
	OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',

	// [CATATAN]: Model configuration
	MODEL: 'deepseek/deepseek-chat',

	// [CATATAN]: Request configuration
	MAX_TOKENS: 2000,
	TEMPERATURE: 0.7
};
