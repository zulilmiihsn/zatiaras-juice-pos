/**
 * Menu publik khusus baca untuk situs pesan: nama, harga, harga jumbo, dan ketersediaan per cabang.
 * Sengaja sempit (tanpa stok mentah, bahan, atau data penjualan) supaya kontraknya tetap stabil
 * walau tabel POS berubah. Situs pesan menyimpan hasilnya di cache, jadi bacaan D1 tetap sedikit.
 */
import { branchContext, getD1Database } from '../branchResolver';
import { branchForOutlet } from './mapping';
import { WebOrderError } from './types';

export interface PublicMenuItem {
	name: string;
	price: number;
	/** Harga jumbo bila ditetapkan di POS; null = situs memakai selisih jumbo standarnya. */
	jumboPrice: number | null;
	available: boolean;
}

export interface PublicMenu {
	outletId: string;
	items: PublicMenuItem[];
}

interface ProductRow {
	nama: string;
	harga: number;
	harga_jumbo: number | null;
	stok: number | null;
	lacak_stok: number | null;
}

export async function loadPublicMenu(
	platform: App.Platform | undefined,
	outletId: string
): Promise<PublicMenu> {
	const resolved = branchForOutlet(outletId);
	if (!resolved) throw new WebOrderError(404, 'Outlet tidak dikenal');
	const branch = branchContext(resolved);
	const db = getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
	const { results } = await db
		.prepare(
			`SELECT nama, harga, harga_jumbo, stok, lacak_stok
			 FROM produk WHERE cabang_id = ? AND is_active = 1 ORDER BY nama`
		)
		.bind(branch)
		.all<ProductRow>();
	const items = (results ?? [])
		.filter((row) => Number(row.harga) > 0)
		.map((row) => ({
			name: String(row.nama),
			price: Math.round(Number(row.harga)),
			jumboPrice: Number(row.harga_jumbo) > 0 ? Math.round(Number(row.harga_jumbo)) : null,
			// Produk yang stoknya dilacak dan habis dianggap tidak tersedia; lainnya tersedia.
			available: !(Number(row.lacak_stok) === 1 && Number(row.stok ?? 0) <= 0)
		}));
	return { outletId, items };
}
