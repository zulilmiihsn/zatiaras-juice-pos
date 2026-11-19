import { dev } from '$app/environment';

// Build menyimpan shell publik; Vite dev tetap memakai hook sesi dan D1 biasa.
export const prerender = !dev;
export const ssr = false;
