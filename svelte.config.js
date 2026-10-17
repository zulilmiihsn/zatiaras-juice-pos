import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { withSingleFlightEmulation } from './scripts/platform-emulation.mjs';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		files: {
			serviceWorker: 'src/sw.ts'
		},
		// The PWA plugin owns /sw.js registration and the existing update prompt.
		serviceWorker: {
			register: false
		},
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				// Host Supabase: gambar menu lama Samarinda masih menunjuk ke sana. Buang setelah
				// gambar dipindah ke R2 (/api/upload).
				'img-src': ['self', 'data:', 'blob:', 'https://qmlzwklzahcfigjpoavz.supabase.co'],
				'font-src': ['self', 'https://fonts.gstatic.com', 'data:'],
				// Host realtime = origin aplikasi sendiri, tetapi 'self' belum cocok dengan skema
				// ws/wss di semua browser, jadi wss: tetap dibuka. ws: hanya untuk loopback:
				// dev server dan RawBT Print Server lokal. Panggilan AI berjalan di server.
				'connect-src': ['self', 'wss:', 'ws://localhost:*', 'ws://127.0.0.1:*'],
				'worker-src': ['self', 'blob:'],
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
		adapter: withSingleFlightEmulation(
			adapter({
				config: './wrangler.pages.jsonc',
				platformProxy: {
					configPath: process.env.ZATIARAS_E2E_CONFIG || './wrangler.pages.jsonc',
					...(process.env.ZATIARAS_E2E_CONFIG && process.env.ZATIARAS_E2E_STATE
						? { persist: { path: process.env.ZATIARAS_E2E_STATE } }
						: {})
				}
			})
		)
	}
};

export default config;
