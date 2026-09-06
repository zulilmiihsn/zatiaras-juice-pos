/**
 * 📊 ZatiarasPOS - Executive Financial PDF Generator
 * Menghasilkan Laporan Keuangan & Arus Kas standar korporat & akuntansi resmi (Clean, Formal, Audit-Ready).
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatRupiah } from '$lib/utils/currency';
import { LOGO_BASE64 } from '$lib/utils/logoBase64';
import type { BukuKasRecord, LaporanSummary } from '$lib/types/laporan';
import type { ReportGroups } from '$lib/utils/reportGrouping';

export interface GeneratePdfOptions {
	branchName: string;
	startDate: string;
	endDate: string;
	summary: LaporanSummary;
	reportGroups: ReportGroups;
	transactions: BukuKasRecord[];
}

interface JsPdfWithAutoTable {
	lastAutoTable?: { finalY: number };
	internal?: {
		getNumberOfPages?: () => number;
		[key: string]: unknown;
	};
}

function getAutoTableFinalY(doc: jsPDF, fallbackY = 0): number {
	const docWithTable = doc as unknown as JsPdfWithAutoTable;
	return docWithTable.lastAutoTable?.finalY ?? fallbackY;
}

function getTotalPdfPages(doc: jsPDF): number {
	const docWithTable = doc as unknown as JsPdfWithAutoTable;
	return typeof docWithTable.internal?.getNumberOfPages === 'function'
		? docWithTable.internal.getNumberOfPages()
		: 1;
}

/** Helper untuk mengelompokkan transaksi berdasarkan nama item/keterangan */
function groupRecordsByName(
	records: BukuKasRecord[]
): { name: string; tunai: number; qris: number; total: number }[] {
	const map = new Map<string, { tunai: number; qris: number; total: number }>();
	for (const r of records) {
		const name = (r.deskripsi?.trim() || r.catatan?.trim() || r.nama?.trim() || 'Lain-lain').trim();
		const nom = Number(r.nominal || 0);
		const isTunai =
			String(r.metode_bayar || '')
				.trim()
				.toLowerCase() === 'tunai';

		const cur = map.get(name) || { tunai: 0, qris: 0, total: 0 };
		if (isTunai) {
			cur.tunai += nom;
		} else {
			cur.qris += nom;
		}
		cur.total += nom;
		map.set(name, cur);
	}
	return Array.from(map.entries())
		.map(([name, data]) => ({ name, ...data }))
		.sort((a, b) => b.total - a.total);
}

export function generateLaporanPdf(options: GeneratePdfOptions): void {
	const doc = new jsPDF({
		orientation: 'portrait',
		unit: 'mm',
		format: 'a4'
	});

	const { branchName, startDate, endDate, summary, reportGroups, transactions } = options;

	// Palette Warna Dokumen Keuangan Resmi & Akuntansi
	const colDark: [number, number, number] = [15, 23, 42]; // Slate-900 (Teks Utama)
	const colSlate800: [number, number, number] = [30, 41, 59]; // Slate-800 (Header Tabel)
	const colMuted: [number, number, number] = [71, 85, 105]; // Slate-600 (Keterangan)
	const colLightMuted: [number, number, number] = [148, 163, 184]; // Slate-400 (Garis/Catatan)
	const colBorder: [number, number, number] = [203, 213, 225]; // Slate-300 (Border Halus)
	const colBgHeader: [number, number, number] = [241, 245, 249]; // Slate-100 (Subseksi)
	const colBgCard: [number, number, number] = [248, 250, 252]; // Slate-50 (Kartu Ringkasan)
	const colNegative: [number, number, number] = [190, 18, 60]; // Rose-700 (Jika Rugi)

	const pendapatan = Number(summary?.pendapatan || 0);
	const pengeluaran = Number(summary?.pengeluaran || 0);
	const labaKotor = Number(summary?.labaKotor || pendapatan - pengeluaran);
	const pajak = Number(summary?.pajak || 0);
	const labaBersih = Number(
		summary?.labaBersih || (summary?.saldo ?? pendapatan - pengeluaran - pajak)
	);

	// Helper Render Judul Seksi Formal
	function renderSectionHeader(title: string, subcaption: string, currentY: number): number {
		// Garis Aksen Kiri Tipis & Elegan
		doc.setFillColor(...colSlate800);
		doc.rect(14, currentY, 2, 7, 'F');

		doc.setFont('helvetica', 'bold');
		doc.setFontSize(9.5);
		doc.setTextColor(...colDark);
		doc.text(title, 18, currentY + 5.2);

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(7.5);
		doc.setTextColor(...colMuted);
		doc.text(subcaption, 18, currentY + 9.5);

		return currentY + 13;
	}

	// ─── 1. KOP SURAT / EXECUTIVE LETTERHEAD RESMI ───────────────────────────────
	let y = 12;

	// Logo Toko (Kiri)
	try {
		if (LOGO_BASE64) {
			doc.addImage(LOGO_BASE64, 'PNG', 14, y, 16, 16);
		}
	} catch {}

	const headerTextX = 33;

	// Nama Usaha & Judul Laporan
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(14);
	doc.setTextColor(...colDark);
	doc.text('ZATIARAS JUICE', headerTextX, y + 4.5);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9.5);
	doc.setTextColor(...colSlate800);
	doc.text('LAPORAN KEUANGAN & REKONSILIASI KAS', headerTextX, y + 9.5);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(...colMuted);
	doc.text(`Cabang / Unit : ${branchName.toUpperCase()}  |  Sistem Informasi POS`, headerTextX, y + 14);

	// Blok Metadata Kanan (Rapi, Standar Surat Resmi)
	const metaX = 130;
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(...colDark);
	doc.text('Periode Laporan', metaX, y + 4.5);
	doc.text(':', metaX + 22, y + 4.5);
	doc.setFont('helvetica', 'bold');
	doc.text(`${startDate} s/d ${endDate}`, metaX + 25, y + 4.5);

	doc.setFont('helvetica', 'normal');
	doc.text('Waktu Cetak', metaX, y + 9);
	doc.text(':', metaX + 22, y + 9);
	doc.text(`${new Date().toLocaleString('id-ID')}`, metaX + 25, y + 9);

	doc.text('Status Dokumen', metaX, y + 13.5);
	doc.text(':', metaX + 22, y + 13.5);
	doc.setFont('helvetica', 'bold');
	doc.text('Sah & Terverifikasi', metaX + 25, y + 13.5);

	// Garis Ganda Pembatas Kop Surat Resmi (Double Rule)
	y = 31;
	doc.setDrawColor(...colSlate800);
	doc.setLineWidth(0.6);
	doc.line(14, y, 196, y);

	doc.setDrawColor(...colBorder);
	doc.setLineWidth(0.2);
	doc.line(14, y + 1.2, 196, y + 1.2);

	// ─── 2. IKHTISAR KEUANGAN (EXECUTIVE FINANCIAL TILES) ────────────────────────
	y += 5;
	const cardW = 43.5;
	const cardH = 19;
	const cardGap = 2.6;
	const startX = 14;

	const kpiCards = [
		{
			title: 'TOTAL PENDAPATAN',
			value: `Rp ${formatRupiah(pendapatan)}`,
			isNegative: false
		},
		{
			title: 'TOTAL PENGELUARAN',
			value: `Rp ${formatRupiah(pengeluaran)}`,
			isNegative: false
		},
		{
			title: 'LABA KOTOR',
			value: `Rp ${formatRupiah(labaKotor)}`,
			isNegative: labaKotor < 0
		},
		{
			title: 'LABA BERSIH (NET)',
			value: `Rp ${formatRupiah(labaBersih)}`,
			isNegative: labaBersih < 0
		}
	];

	kpiCards.forEach((card, idx) => {
		const cx = startX + idx * (cardW + cardGap);
		doc.setFillColor(...colBgCard);
		doc.setDrawColor(...colBorder);
		doc.setLineWidth(0.3);
		doc.roundedRect(cx, y, cardW, cardH, 1.5, 1.5, 'FD');

		// Judul Card
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(6.8);
		doc.setTextColor(...colMuted);
		doc.text(card.title, cx + 3.5, y + 5.5);

		// Garis Pemisah Tipis
		doc.setDrawColor(226, 232, 240);
		doc.setLineWidth(0.15);
		doc.line(cx + 3.5, y + 7.8, cx + cardW - 3.5, y + 7.8);

		// Nilai Nominal Prominen
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(9.5);
		doc.setTextColor(...(card.isNegative ? colNegative : colDark));
		doc.text(card.value, cx + 3.5, y + 14.5);
	});

	y += cardH + 7;

	// ─── 3. TABEL I: RINCIAN PENDAPATAN & ARUS KAS MASUK ────────────────────────
	y = renderSectionHeader(
		'I. RINCIAN PENDAPATAN & ARUS KAS MASUK',
		'Detail omzet penjualan produk POS dan penerimaan kas lainnya (Tunai & QRIS/Non-Tunai)',
		y
	);

	const tunaiUsaha = reportGroups.pemasukanUsahaTunai.reduce(
		(a, b) => a + Number(b.nominal || 0),
		0
	);
	const qrisUsaha = reportGroups.pemasukanUsahaQris.reduce((a, b) => a + Number(b.nominal || 0), 0);
	const sumPemasukanUsaha = tunaiUsaha + qrisUsaha;

	const tunaiLain = reportGroups.pemasukanLainTunai.reduce((a, b) => a + Number(b.nominal || 0), 0);
	const qrisLain = reportGroups.pemasukanLainQris.reduce((a, b) => a + Number(b.nominal || 0), 0);
	const sumPemasukanLain = tunaiLain + qrisLain;

	const totalPemasukan = reportGroups.totalTunaiPemasukan + reportGroups.totalQrisPemasukan;

	const salesGrouped = groupRecordsByName([
		...reportGroups.pemasukanUsahaTunai,
		...reportGroups.pemasukanUsahaQris
	]);
	const otherIncomeGrouped = groupRecordsByName([
		...reportGroups.pemasukanLainTunai,
		...reportGroups.pemasukanLainQris
	]);

	type TableCell =
		| string
		| number
		| {
				content: string;
				colSpan?: number;
				rowSpan?: number;
				styles?: Record<string, unknown>;
		  };
	type TableRow = TableCell[];

	const pemasukanRows: TableRow[] = [];

	// Sub-seksi A: Pendapatan Usaha
	pemasukanRows.push([
		{
			content: 'A. PENDAPATAN USAHA (PENJUALAN MENU / PRODUK POS)',
			colSpan: 6,
			styles: {
				fontStyle: 'bold',
				fillColor: colBgHeader,
				textColor: colDark,
				fontSize: 7.5
			}
		}
	]);

	if (salesGrouped.length === 0) {
		pemasukanRows.push([
			{
				content: 'Tidak ada data penjualan produk pada periode ini',
				colSpan: 6,
				styles: { fontStyle: 'italic', halign: 'center', textColor: colMuted, fontSize: 7.5 }
			}
		]);
	} else {
		salesGrouped.forEach((item, idx) => {
			const percent =
				totalPemasukan > 0 ? `${((item.total / totalPemasukan) * 100).toFixed(1)}%` : '0.0%';
			pemasukanRows.push([
				String(idx + 1),
				item.name,
				`Rp ${formatRupiah(item.tunai)}`,
				`Rp ${formatRupiah(item.qris)}`,
				`Rp ${formatRupiah(item.total)}`,
				percent
			]);
		});
	}

	// Subtotal Pendapatan Usaha
	pemasukanRows.push([
		'',
		'Subtotal Pendapatan Usaha (Penjualan)',
		`Rp ${formatRupiah(tunaiUsaha)}`,
		`Rp ${formatRupiah(qrisUsaha)}`,
		`Rp ${formatRupiah(sumPemasukanUsaha)}`,
		totalPemasukan > 0 ? `${((sumPemasukanUsaha / totalPemasukan) * 100).toFixed(1)}%` : '0.0%'
	]);

	// Sub-seksi B: Pemasukan Lain-lain
	pemasukanRows.push([
		{
			content: 'B. PEMASUKAN LAIN-LAIN / KAS MASUK NON-PENJUALAN',
			colSpan: 6,
			styles: {
				fontStyle: 'bold',
				fillColor: colBgHeader,
				textColor: colDark,
				fontSize: 7.5
			}
		}
	]);

	if (otherIncomeGrouped.length === 0) {
		pemasukanRows.push([
			{
				content: 'Tidak ada data penerimaan kas lain pada periode ini',
				colSpan: 6,
				styles: { fontStyle: 'italic', halign: 'center', textColor: colMuted, fontSize: 7.5 }
			}
		]);
	} else {
		otherIncomeGrouped.forEach((item, idx) => {
			const percent =
				totalPemasukan > 0 ? `${((item.total / totalPemasukan) * 100).toFixed(1)}%` : '0.0%';
			pemasukanRows.push([
				String(idx + 1),
				item.name,
				`Rp ${formatRupiah(item.tunai)}`,
				`Rp ${formatRupiah(item.qris)}`,
				`Rp ${formatRupiah(item.total)}`,
				percent
			]);
		});
	}

	// Subtotal Pemasukan Lain
	pemasukanRows.push([
		'',
		'Subtotal Pemasukan Lainnya',
		`Rp ${formatRupiah(tunaiLain)}`,
		`Rp ${formatRupiah(qrisLain)}`,
		`Rp ${formatRupiah(sumPemasukanLain)}`,
		totalPemasukan > 0 ? `${((sumPemasukanLain / totalPemasukan) * 100).toFixed(1)}%` : '0.0%'
	]);

	// TOTAL KESELURUHAN PEMASUKAN (A + B)
	pemasukanRows.push([
		'',
		'TOTAL KESELURUHAN PENDAPATAN / KAS MASUK (A + B)',
		`Rp ${formatRupiah(reportGroups.totalTunaiPemasukan)}`,
		`Rp ${formatRupiah(reportGroups.totalQrisPemasukan)}`,
		`Rp ${formatRupiah(totalPemasukan)}`,
		'100.0%'
	]);

	autoTable(doc, {
		startY: y,
		theme: 'grid',
		head: [
			[
				'No',
				'Kategori & Rincian Sumber Pemasukan',
				'Kas Tunai (Rp)',
				'QRIS / Non-Tunai (Rp)',
				'Total Nominal (Rp)',
				'Porsi %'
			]
		],
		body: pemasukanRows as any,
		headStyles: {
			fillColor: colSlate800,
			textColor: [255, 255, 255],
			fontStyle: 'bold',
			fontSize: 7.5,
			cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 }
		},
		bodyStyles: {
			fontSize: 7.2,
			textColor: colDark,
			cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
			lineColor: [226, 232, 240],
			lineWidth: 0.2
		},
		columnStyles: {
			0: { cellWidth: 8, halign: 'center' },
			1: { cellWidth: 'auto' },
			2: { cellWidth: 32, halign: 'right' },
			3: { cellWidth: 32, halign: 'right' },
			4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
			5: { cellWidth: 16, halign: 'center' }
		},
		didParseCell: (data) => {
			const cellText = String(data.cell.raw ?? '');
			if (cellText.startsWith('Subtotal')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [248, 250, 252];
			} else if (cellText.startsWith('TOTAL KESELURUHAN')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [226, 232, 240];
				data.cell.styles.textColor = colDark;
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 8;

	// ─── 4. TABEL II: RINCIAN PENGELUARAN & BEBAN OPERASIONAL ───────────────────
	if (y > 210) {
		doc.addPage();
		y = 16;
	}

	y = renderSectionHeader(
		'II. RINCIAN PENGELUARAN & BEBAN OPERASIONAL',
		'Detail belanja bahan baku, biaya operasional, dan pengeluaran kas lainnya',
		y
	);

	const tunaiBebanUsaha = reportGroups.bebanUsahaTunai.reduce(
		(a, b) => a + Number(b.nominal || 0),
		0
	);
	const qrisBebanUsaha = reportGroups.bebanUsahaQris.reduce(
		(a, b) => a + Number(b.nominal || 0),
		0
	);
	const sumBebanUsaha = tunaiBebanUsaha + qrisBebanUsaha;

	const tunaiBebanLain = reportGroups.bebanLainTunai.reduce(
		(a, b) => a + Number(b.nominal || 0),
		0
	);
	const qrisBebanLain = reportGroups.bebanLainQris.reduce((a, b) => a + Number(b.nominal || 0), 0);
	const sumBebanLain = tunaiBebanLain + qrisBebanLain;

	const totalPengeluaran = reportGroups.totalTunaiPengeluaran + reportGroups.totalQrisPengeluaran;

	const expenseGrouped = groupRecordsByName([
		...reportGroups.bebanUsahaTunai,
		...reportGroups.bebanUsahaQris
	]);
	const otherExpenseGrouped = groupRecordsByName([
		...reportGroups.bebanLainTunai,
		...reportGroups.bebanLainQris
	]);

	const pengeluaranRows: TableRow[] = [];

	// Sub-seksi A: Beban Usaha
	pengeluaranRows.push([
		{
			content: 'A. BEBAN USAHA (OPERASIONAL & BAHAN BAKU TOKO)',
			colSpan: 6,
			styles: {
				fontStyle: 'bold',
				fillColor: colBgHeader,
				textColor: colDark,
				fontSize: 7.5
			}
		}
	]);

	if (expenseGrouped.length === 0) {
		pemasukanRows.push([
			{
				content: 'Tidak ada data beban operasional pada periode ini',
				colSpan: 6,
				styles: { fontStyle: 'italic', halign: 'center', textColor: colMuted, fontSize: 7.5 }
			}
		]);
	} else {
		expenseGrouped.forEach((item, idx) => {
			const percent =
				totalPengeluaran > 0 ? `${((item.total / totalPengeluaran) * 100).toFixed(1)}%` : '0.0%';
			pengeluaranRows.push([
				String(idx + 1),
				item.name,
				`Rp ${formatRupiah(item.tunai)}`,
				`Rp ${formatRupiah(item.qris)}`,
				`Rp ${formatRupiah(item.total)}`,
				percent
			]);
		});
	}

	// Subtotal Beban Usaha
	pengeluaranRows.push([
		'',
		'Subtotal Beban Usaha (Operasional)',
		`Rp ${formatRupiah(tunaiBebanUsaha)}`,
		`Rp ${formatRupiah(qrisBebanUsaha)}`,
		`Rp ${formatRupiah(sumBebanUsaha)}`,
		totalPengeluaran > 0 ? `${((sumBebanUsaha / totalPengeluaran) * 100).toFixed(1)}%` : '0.0%'
	]);

	// Sub-seksi B: Beban Lainnya
	pengeluaranRows.push([
		{
			content: 'B. BEBAN LAIN-LAIN / BIAYA NON-OPERASIONAL',
			colSpan: 6,
			styles: {
				fontStyle: 'bold',
				fillColor: colBgHeader,
				textColor: colDark,
				fontSize: 7.5
			}
		}
	]);

	if (otherExpenseGrouped.length === 0) {
		pengeluaranRows.push([
			{
				content: 'Tidak ada data beban lainnya pada periode ini',
				colSpan: 6,
				styles: { fontStyle: 'italic', halign: 'center', textColor: colMuted, fontSize: 7.5 }
			}
		]);
	} else {
		otherExpenseGrouped.forEach((item, idx) => {
			const percent =
				totalPengeluaran > 0 ? `${((item.total / totalPengeluaran) * 100).toFixed(1)}%` : '0.0%';
			pengeluaranRows.push([
				String(idx + 1),
				item.name,
				`Rp ${formatRupiah(item.tunai)}`,
				`Rp ${formatRupiah(item.qris)}`,
				`Rp ${formatRupiah(item.total)}`,
				percent
			]);
		});
	}

	// Subtotal Beban Lain
	pengeluaranRows.push([
		'',
		'Subtotal Beban Lainnya',
		`Rp ${formatRupiah(tunaiBebanLain)}`,
		`Rp ${formatRupiah(qrisBebanLain)}`,
		`Rp ${formatRupiah(sumBebanLain)}`,
		totalPengeluaran > 0 ? `${((sumBebanLain / totalPengeluaran) * 100).toFixed(1)}%` : '0.0%'
	]);

	// TOTAL KESELURUHAN PENGELUARAN (A + B)
	pengeluaranRows.push([
		'',
		'TOTAL KESELURUHAN BEBAN / KAS KELUAR (A + B)',
		`Rp ${formatRupiah(reportGroups.totalTunaiPengeluaran)}`,
		`Rp ${formatRupiah(reportGroups.totalQrisPengeluaran)}`,
		`Rp ${formatRupiah(totalPengeluaran)}`,
		'100.0%'
	]);

	autoTable(doc, {
		startY: y,
		theme: 'grid',
		head: [
			[
				'No',
				'Kategori & Rincian Pos Pengeluaran',
				'Kas Tunai (Rp)',
				'QRIS / Non-Tunai (Rp)',
				'Total Nominal (Rp)',
				'Porsi %'
			]
		],
		body: pengeluaranRows as any,
		headStyles: {
			fillColor: colSlate800,
			textColor: [255, 255, 255],
			fontStyle: 'bold',
			fontSize: 7.5,
			cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 }
		},
		bodyStyles: {
			fontSize: 7.2,
			textColor: colDark,
			cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
			lineColor: [226, 232, 240],
			lineWidth: 0.2
		},
		columnStyles: {
			0: { cellWidth: 8, halign: 'center' },
			1: { cellWidth: 'auto' },
			2: { cellWidth: 32, halign: 'right' },
			3: { cellWidth: 32, halign: 'right' },
			4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
			5: { cellWidth: 16, halign: 'center' }
		},
		didParseCell: (data) => {
			const cellText = String(data.cell.raw ?? '');
			if (cellText.startsWith('Subtotal')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [248, 250, 252];
			} else if (cellText.startsWith('TOTAL KESELURUHAN')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [226, 232, 240];
				data.cell.styles.textColor = colDark;
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 8;

	// ─── 5. TABEL III: REKAPITULASI LABA RUGI & SALDO AKHIR ─────────────────────
	if (y > 215) {
		doc.addPage();
		y = 16;
	}

	y = renderSectionHeader(
		'III. REKAPITULASI LABA RUGI, PAJAK & SALDO AKHIR KAS',
		'Perhitungan ringkas laba kotor, potongan pajak penghasilan (PPh Final), dan laba bersih',
		y
	);

	const tunaiMasukTotal = reportGroups.totalTunaiPemasukan;
	const qrisMasukTotal = reportGroups.totalQrisPemasukan;
	const tunaiKeluarTotal = reportGroups.totalTunaiPengeluaran;
	const qrisKeluarTotal = reportGroups.totalQrisPengeluaran;

	const summaryRows: TableRow[] = [
		[
			'Total Arus Kas Masuk / Pendapatan (A)',
			`Rp ${formatRupiah(tunaiMasukTotal)}`,
			`Rp ${formatRupiah(qrisMasukTotal)}`,
			`Rp ${formatRupiah(tunaiMasukTotal + qrisMasukTotal)}`
		],
		[
			'Total Arus Kas Keluar / Beban (B)',
			`Rp ${formatRupiah(tunaiKeluarTotal)}`,
			`Rp ${formatRupiah(qrisKeluarTotal)}`,
			`Rp ${formatRupiah(tunaiKeluarTotal + qrisKeluarTotal)}`
		],
		[
			'Laba (Rugi) Kotor Usaha (A - B)',
			`Rp ${formatRupiah(tunaiMasukTotal - tunaiKeluarTotal)}`,
			`Rp ${formatRupiah(qrisMasukTotal - qrisKeluarTotal)}`,
			`Rp ${formatRupiah(labaKotor)}`
		],
		[
			summary?.taxLabel ? `Potongan Pajak Usaha (${summary.taxLabel})` : 'Pajak Penghasilan UMKM (0,5%)',
			'-',
			'-',
			`Rp ${formatRupiah(pajak)}`
		]
	];

	if (summary?.taxBreakdown && summary.taxBreakdown.length > 1) {
		summary.taxBreakdown.forEach((tb) => {
			summaryRows.push([
				`   ↳ ${tb.nama} (${tb.persentase}%)`,
				'-',
				'-',
				`Rp ${formatRupiah(tb.nominal)}`
			]);
		});
	}

	summaryRows.push([
		'SALDO AKHIR KAS / LABA BERSIH (A - B - Pajak)',
		`Rp ${formatRupiah(reportGroups.totalTunaiAll)}`,
		`Rp ${formatRupiah(reportGroups.totalQrisAll)}`,
		`Rp ${formatRupiah(labaBersih)}`
	]);

	autoTable(doc, {
		startY: y,
		theme: 'grid',
		head: [
			['Kategori Akuntansi & Arus Kas', 'Kas Tunai (Rp)', 'Non-Tunai / QRIS (Rp)', 'Total Nominal (Rp)']
		],
		body: summaryRows as any,
		headStyles: {
			fillColor: colSlate800,
			textColor: [255, 255, 255],
			fontStyle: 'bold',
			fontSize: 7.5,
			cellPadding: { top: 2.8, bottom: 2.8, left: 3.5, right: 3.5 }
		},
		bodyStyles: {
			fontSize: 7.5,
			textColor: colDark,
			cellPadding: { top: 2.5, bottom: 2.5, left: 3.5, right: 3.5 },
			lineColor: [226, 232, 240],
			lineWidth: 0.2
		},
		columnStyles: {
			0: { cellWidth: 78 },
			1: { cellWidth: 34, halign: 'right' },
			2: { cellWidth: 34, halign: 'right' },
			3: { cellWidth: 36, halign: 'right', fontStyle: 'bold' }
		},
		didParseCell: (data) => {
			const cellText = String(data.cell.raw ?? '');
			if (cellText.startsWith('Total Arus Kas') || cellText.startsWith('Laba (Rugi) Kotor')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [241, 245, 249];
			}
			if (cellText.startsWith('SALDO AKHIR KAS')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [226, 232, 240];
				data.cell.styles.textColor = colDark;
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 8;

	// ─── 6. TABEL IV: LOG TRANSAKSI BUKU KAS DETAIL ─────────────────────────────
	if (transactions.length > 0) {
		if (y > 200) {
			doc.addPage();
			y = 16;
		}

		y = renderSectionHeader(
			`IV. LOG TRANSAKSI BUKU KAS DETAIL (${transactions.length} Mutasi)`,
			'Rekaman kronologis mutasi kas masuk dan kas keluar yang tercatat di sistem',
			y
		);

		const transactionRows = transactions.map((t, idx) => {
			const no = String(idx + 1);
			const dateStr = t.waktu || t.created_at || '';
			const formattedDate = dateStr
				? new Date(dateStr).toLocaleString('id-ID', {
						day: '2-digit',
						month: '2-digit',
						year: '2-digit',
						hour: '2-digit',
						minute: '2-digit'
					})
				: '-';

			const isIncome = t.tipe === 'in';
			const tipeText = isIncome ? 'MASUK' : 'KELUAR';
			const kategoriText =
				t.jenis === 'pendapatan_usaha'
					? 'Pendapatan Usaha'
					: t.jenis === 'beban_usaha'
						? 'Beban Usaha'
						: 'Lain-lain';

			const deskripsi =
				t.catatan ||
				t.deskripsi ||
				t.nama ||
				(isIncome ? 'Penjualan POS' : 'Pengeluaran Operasional');
			const metode = (t.metode_bayar || 'Tunai').toUpperCase();
			const nominal = `Rp ${formatRupiah(Number(t.nominal || 0))}`;

			return [no, formattedDate, tipeText, kategoriText, deskripsi, metode, nominal];
		});

		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [
				['No', 'Tanggal/Waktu', 'Tipe', 'Kategori', 'Deskripsi / Keterangan', 'Metode', 'Nominal (Rp)']
			],
			body: transactionRows,
			headStyles: {
				fillColor: colSlate800,
				textColor: [255, 255, 255],
				fontStyle: 'bold',
				fontSize: 7.5,
				cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 }
			},
			bodyStyles: {
				fontSize: 7.2,
				textColor: colDark,
				cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
				lineColor: [226, 232, 240],
				lineWidth: 0.2
			},
			columnStyles: {
				0: { cellWidth: 8, halign: 'center' },
				1: { cellWidth: 26 },
				2: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
				3: { cellWidth: 28 },
				4: { cellWidth: 'auto' },
				5: { cellWidth: 18, halign: 'center' },
				6: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }
			},
			alternateRowStyles: {
				fillColor: [248, 250, 252]
			},
			didParseCell: (data) => {
				if (data.column.index === 2 && data.section === 'body') {
					const val = String(data.cell.raw);
					if (val === 'KELUAR') {
						data.cell.styles.textColor = colNegative;
					}
				}
			},
			margin: { left: 14, right: 14 }
		});

		y = getAutoTableFinalY(doc, y) + 8;
	}

	// ─── 7. LEMBAR PENGESAHAN RESMI (OFFICIAL APPROVAL SIGNATURES) ───────────────
	let signY = y + 2;

	if (signY > 235) {
		doc.addPage();
		signY = 18;
	}

	// Dua Kolom Tanda Tangan Standar Akuntansi & Perusahaan
	const signBoxW = 82;
	const signBoxH = 32;

	// Kotak Kiri (Dibuat Oleh)
	doc.setFillColor(...colBgCard);
	doc.setDrawColor(...colBorder);
	doc.setLineWidth(0.3);
	doc.roundedRect(14, signY, signBoxW, signBoxH, 1.5, 1.5, 'FD');

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(7.5);
	doc.setTextColor(...colDark);
	doc.text('Dibuat & Dilaporkan Oleh:', 18, signY + 5.5);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7);
	doc.setTextColor(...colMuted);
	doc.text('Kasir / Staf Operasional Cabang', 18, signY + 9.5);

	doc.setDrawColor(...colBorder);
	doc.setLineWidth(0.25);
	doc.line(18, signY + 24, 18 + signBoxW - 8, signY + 24);

	doc.setFontSize(6.8);
	doc.setTextColor(...colLightMuted);
	doc.text('( Tanda Tangan & Nama Terang )', 18, signY + 28);

	// Kotak Kanan (Disetujui Oleh)
	doc.setFillColor(...colBgCard);
	doc.setDrawColor(...colBorder);
	doc.setLineWidth(0.3);
	doc.roundedRect(114, signY, signBoxW, signBoxH, 1.5, 1.5, 'FD');

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(7.5);
	doc.setTextColor(...colDark);
	doc.text('Diperiksa & Disetujui Oleh:', 118, signY + 5.5);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7);
	doc.setTextColor(...colMuted);
	doc.text('Pemilik / Pimpinan Manajemen Cabang', 118, signY + 9.5);

	doc.setDrawColor(...colBorder);
	doc.setLineWidth(0.25);
	doc.line(118, signY + 24, 118 + signBoxW - 8, signY + 24);

	doc.setFontSize(6.8);
	doc.setTextColor(...colLightMuted);
	doc.text('( Tanda Tangan & Stempel Resmi )', 118, signY + 28);

	// ─── 8. RUNNING HEADER & RUNNING FOOTER DI SELURUH HALAMAN ───────────────────
	const totalPages = getTotalPdfPages(doc);
	const generatedTimestamp = new Date().toLocaleString('id-ID');

	for (let i = 1; i <= totalPages; i++) {
		doc.setPage(i);

		// Running Header Halaman 2 ke atas
		if (i > 1) {
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(7);
			doc.setTextColor(...colMuted);
			doc.text(`Zatiaras Juice — Laporan Keuangan Periode ${startDate} s/d ${endDate}`, 14, 8);
			doc.text(`Cabang: ${branchName.toUpperCase()}`, 196, 8, { align: 'right' });

			doc.setDrawColor(...colBorder);
			doc.setLineWidth(0.2);
			doc.line(14, 10, 196, 10);
		}

		// Running Footer di Setiap Halaman
		doc.setDrawColor(...colBorder);
		doc.setLineWidth(0.2);
		doc.line(14, 287, 196, 287);

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(7);
		doc.setTextColor(...colMuted);
		doc.text(
			`ZatiarasPOS • Dokumen Keuangan Resmi • Dicetak: ${generatedTimestamp}`,
			14,
			291
		);
		doc.text(`Halaman ${i} dari ${totalPages}`, 196, 291, { align: 'right' });
	}

	// ─── 9. SIMPAN PDF ───────────────────────────────────────────────────────────
	const cleanBranch = branchName.replace(/[^a-zA-Z0-9]/g, '_');
	const fileName = `Laporan_Keuangan_Zatiaras_${cleanBranch}_${startDate}_sd_${endDate}.pdf`;
	doc.save(fileName);
}
