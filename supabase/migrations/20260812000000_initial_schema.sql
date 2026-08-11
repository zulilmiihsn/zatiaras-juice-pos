-- ============================================================================
-- 🍹 ZATIARAS POS INITIAL DATABASE SCHEMA MIGRATION
-- Migration Date: 2026-08-12
-- Database Engine: PostgreSQL / Supabase
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABEL PROFIL / USERS
CREATE TABLE IF NOT EXISTS public.profil (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'kasir' CHECK (role IN ('kasir', 'pemilik', 'admin', 'manager')),
    cabang VARCHAR(50) DEFAULT 'Balikpapan',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL KATEGORI
CREATE TABLE IF NOT EXISTS public.kategori (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABEL TAMBAHAN / ADD-ONS
CREATE TABLE IF NOT EXISTS public.tambahan (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    harga NUMERIC(12, 2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABEL PRODUK
CREATE TABLE IF NOT EXISTS public.produk (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    harga NUMERIC(12, 2) DEFAULT 0,
    category_id BIGINT REFERENCES public.kategori(id) ON DELETE SET NULL,
    tipe VARCHAR(20) NOT NULL DEFAULT 'minuman' CHECK (tipe IN ('minuman', 'makanan', 'snack')),
    gambar TEXT,
    deskripsi TEXT,
    ekstra_ids BIGINT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABEL BUKU KAS
CREATE TABLE IF NOT EXISTS public.buku_kas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id VARCHAR(50),
    waktu TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tipe VARCHAR(10) NOT NULL CHECK (tipe IN ('in', 'out')),
    nominal NUMERIC(14, 2) NOT NULL DEFAULT 0,
    amount NUMERIC(14, 2) DEFAULT 0,
    sumber VARCHAR(20) DEFAULT 'pos',
    jenis VARCHAR(50) DEFAULT 'pendapatan_usaha',
    keterangan TEXT,
    payment_method VARCHAR(20) DEFAULT 'tunai',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABEL TRANSAKSI KASIR
CREATE TABLE IF NOT EXISTS public.transaksi_kasir (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buku_kas_id UUID REFERENCES public.buku_kas(id) ON DELETE CASCADE,
    transaction_code VARCHAR(50),
    customer_name VARCHAR(100),
    produk_id BIGINT REFERENCES public.produk(id) ON DELETE SET NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    harga_satuan NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_harga NUMERIC(12, 2) NOT NULL DEFAULT 0,
    addOns JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABEL SESI TOKO
CREATE TABLE IF NOT EXISTS public.sesi_toko (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opening_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    opening_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closing_time TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    user_id UUID REFERENCES public.profil(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEKS PERFORMA QUERY
CREATE INDEX IF NOT EXISTS idx_buku_kas_waktu ON public.buku_kas(waktu);
CREATE INDEX IF NOT EXISTS idx_buku_kas_sumber ON public.buku_kas(sumber);
CREATE INDEX IF NOT EXISTS idx_produk_category ON public.produk(category_id);
CREATE INDEX IF NOT EXISTS idx_transaksi_kasir_buku_kas ON public.transaksi_kasir(buku_kas_id);
