import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'https://unpkg.com'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'font-src': ['self', 'https://fonts.gstatic.com', 'data:'],
				'connect-src': [
					'self',
					'ws:',
					'wss:',
					'https://openrouter.ai',
					'https://unpkg.com',
					'https://cdn.jsdelivr.net'
				],
				'worker-src': ['self', 'blob:', 'https://cdn.jsdelivr.net'],
				'media-src': ['self', 'data:', 'blob:'],
				'object-src': ['none'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		},
		csrf: {
			trustedOrigins: ['self']
		},
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({
			config: './wrangler.pages.jsonc',
			platformProxy: {
				configPath: './wrangler.pages.jsonc'
			}
		})
	}
};

export default config;
