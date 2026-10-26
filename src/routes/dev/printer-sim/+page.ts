import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

// Simulator perangkat keras hanya untuk pengembangan; build produksi menjawab 404.
export const ssr = false;

export function load() {
	if (!dev) error(404, 'Tidak ditemukan');
}
