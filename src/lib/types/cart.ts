import type { Product } from './product';

export interface CartProduct {
	id: string | number;
	nama: string;
	harga: number;
	harga_jumbo?: number | null;
	tipe: Product['tipe'] | 'custom';
	stok?: number | null;
	lacak_stok?: boolean | number | null;
	lacak_bahan?: boolean | number | null;
	kategori_id?: string | number | null;
	gambar?: string;
	deskripsi?: string;
	ekstra_ids?: Array<string | number>;
	is_active?: boolean;
	price_token?: string;
}

export interface CartAddOn {
	id: string | number;
	nama: string;
	harga: number;
	is_active?: boolean;
	price_token?: string;
}

export interface CartItem {
	product: CartProduct;
	jumlah: number;
	addOns: CartAddOn[];
	porsi?: 'reguler' | 'jumbo';
	gula: string;
	es: string;
	catatan: string;
}
