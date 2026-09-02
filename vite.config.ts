import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const pwaPrerenderPlaceholder = '__pwa-placeholder.json';

function ensurePwaPrerenderPlaceholder() {
	return {
		name: 'ensure-pwa-prerender-placeholder',
		apply: 'build' as const,
		closeBundle() {
			const placeholderPath = join(
				process.cwd(),
				'.svelte-kit',
				'output',
				'prerendered',
				pwaPrerenderPlaceholder
			);

			mkdirSync(dirname(placeholderPath), { recursive: true });
			writeFileSync(placeholderPath, '{}\n');
		}
	};
}

export default defineConfig({
	plugins: [
		sveltekit(),
		tailwindcss(),
		ensurePwaPrerenderPlaceholder(),
		SvelteKitPWA({
			registerType: 'prompt',
			injectRegister: 'auto',
			integration: {
				closeBundleOrder: 'post'
			},
			workbox: {
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
				navigateFallback: null,
				// navigateFallbackDenylist removed since fallback is null
				globPatterns: [
					'client/**/*.{js,css,html,ico,png,svg,webp,avif,woff2,woff,webmanifest}',
					'prerendered/**/*.{html,json}'
				],
				manifestTransforms: [
					async (entries) => ({
						manifest: entries
							.filter((entry) => !entry.url.endsWith(pwaPrerenderPlaceholder))
							.map((entry) => {
								let url = entry.url;
								if (url.startsWith('client/')) {
									url = url.slice(7);
								} else if (url.startsWith('prerendered/dependencies/')) {
									url = url.slice(25);
								} else if (url.startsWith('prerendered/pages/')) {
									url = url.slice(18);
								}

								if (url.endsWith('.html')) {
									if (url === 'index.html') {
										url = '/';
									} else if (url.endsWith('/index.html')) {
										url = url.slice(0, -'/index.html'.length);
									} else {
										url = url.slice(0, -'.html'.length);
									}
								}

								return { ...entry, url };
							}),
						warnings: []
					})
				],
				runtimeCaching: [
					{
						urlPattern: ({ request, url }) =>
							request.mode === 'navigate' && /^\/pos(?:\/|$)/.test(url.pathname),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'pos-navigation-v1',
							networkTimeoutSeconds: 3,
							cacheableResponse: { statuses: [0, 200] },
							expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
							precacheFallback: { fallbackURL: '/offline' }
						}
					},
					{
						urlPattern: /\.(?:png|jpg|jpeg|svg|webp|avif)$/,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'images-cache',
							expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 14 }
						}
					},
					{
						urlPattern: /\.(?:woff2?|ttf|otf)$/,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'fonts-cache',
							expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 }
						}
					}
				]
			},
			includeAssets: ['favicon.svg', '180x180.png', '192x192.png', '144x144.png', '512x512.png'],
			manifest: {
				name: 'Zatiaras POS',
				short_name: 'ZatiarasPOS',
				description:
					'Zatiaras POS - Aplikasi Kasir Modern, Cepat & Mudah untuk Bisnis Minuman Anda.',
				theme_color: '#ec4899',
				background_color: '#ffffff',
				display: 'standalone',
				orientation: 'portrait',
				scope: '/',
				start_url: '/',
				screenshots: [
					{
						src: 'screenshots/beranda.jpg',
						sizes: '1080x2400',
						type: 'image/jpeg',
						form_factor: 'narrow',
						label: 'Dashboard Beranda'
					},
					{
						src: 'screenshots/kasir.jpg',
						sizes: '1080x2400',
						type: 'image/jpeg',
						form_factor: 'narrow',
						label: 'Kasir / POS Pintar'
					},
					{
						src: 'screenshots/laporan.jpg',
						sizes: '1080x2400',
						type: 'image/jpeg',
						form_factor: 'narrow',
						label: 'Laporan Penjualan'
					},
					{
						src: 'screenshots/pengaturan.jpg',
						sizes: '1080x2400',
						type: 'image/jpeg',
						form_factor: 'narrow',
						label: 'Manajemen Cabang & Menu'
					}
				],
				icons: [
					{
						src: 'img/192x192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: 'img/512x512.png',
						sizes: '512x512',
						type: 'image/png'
					},
					{
						src: 'img/180x180.png',
						sizes: '180x180',
						type: 'image/png'
					},
					{
						src: 'img/144x144.png',
						sizes: '144x144',
						type: 'image/png'
					}
				]
			}
		})
	],
	build: {
		rollupOptions: {
			external: ['bcryptjs', 'bcrypt', 'crypto', 'fs', 'path', 'os'],
			output: {
				manualChunks(id) {
					if (id.includes('/node_modules/svelte/')) return 'vendor-svelte';
				}
			}
		},
		chunkSizeWarningLimit: 500, // Reduce warning limit for better optimization
		sourcemap: false, // Disable sourcemap untuk production
		minify: 'terser',
		terserOptions: {
			compress: {
				drop_console: true, // Remove console.log in production
				drop_debugger: true,
				pure_funcs: ['console.log', 'console.info', 'console.debug']
			}
		}
		// Tree shaking is enabled by default in Vite
	},
	optimizeDeps: {
		include: ['idb-keyval', 'js-base64', 'pako', 'uuid', 'workbox-window'],
		exclude: ['svelte', 'bcryptjs', 'bcrypt', 'crypto', 'fs', 'path', 'os', '@lucide/svelte']
	},
	server: {
		fs: {
			allow: ['..']
		}
	},
	preview: {
		port: 4173,
		strictPort: false
	}
});
