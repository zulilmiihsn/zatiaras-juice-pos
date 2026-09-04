/**
 * 📊 ZatiarasPOS - Executive Financial PDF Generator
 * Menghasilkan Laporan Keuangan & Arus Kas standar korporat/akuntansi profesional (Client-Side).
 * Dilengkapi Logo Resmi Zatiaras Juice, Analisis Penjualan Menu, Breakdown Beban, Pajak & Log Buku Kas.
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

	// Palette warna korporat Zatiaras Juice & Modern Document Guidelines
	const brandPrimary: [number, number, number] = [190, 24, 93]; // Rose-700 (#be185d)
	const brandDark: [number, number, number] = [30, 41, 59]; // Slate-800 (#1e293b)
	const slate600: [number, number, number] = [71, 85, 105]; // Slate-600
	const slate500: [number, number, number] = [100, 116, 139]; // Slate-500
	const slate400: [number, number, number] = [148, 163, 184]; // Slate-400
	const borderSlate: [number, number, number] = [226, 232, 240]; // Slate-200
	const greenProfit: [number, number, number] = [16, 149, 103]; // Emerald-600
	const redLoss: [number, number, number] = [225, 29, 72]; // Rose-600

	const pendapatan = Number(summary?.pendapatan || 0);
	const pengeluaran = Number(summary?.pengeluaran || 0);
	const labaKotor = Number(summary?.labaKotor || pendapatan - pengeluaran);
	const pajak = Number(summary?.pajak || 0);
	const labaBersih = Number(
		summary?.labaBersih || (summary?.saldo ?? pendapatan - pengeluaran - pajak)
	);

	// Helper render judul seksi dokumen dengan aksen Rose-700
	function renderSectionHeader(title: string, subcaption: string, currentY: number): number {
		doc.setFillColor(...brandPrimary);
		doc.rect(14, currentY, 3, 8, 'F');

		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10.5);
		doc.setTextColor(...brandDark);
		doc.text(title, 19, currentY + 5.5);

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(8);
		doc.setTextColor(...slate500);
		doc.text(subcaption, 19, currentY + 10.5);

		return currentY + 14;
	}

	// ─── 1. TOP ACCENT BAR ───────────────────────────────────────────────────────
	doc.setFillColor(...brandPrimary);
	doc.rect(0, 0, 210, 4.5, 'F');

	// ─── 2. EXECUTIVE HEADER (LOGO & BRANDING RESMI) ─────────────────────────────
	let y = 10;

	// Logo Toko di Sisi Kiri
	try {
		if (LOGO_BASE64) {
			doc.addImage(LOGO_BASE64, 'PNG', 14, y, 20, 20);
		}
	} catch {
		// Fallback jika logo tidak tersedia
	}

	// Brand Title & Tagline
	const brandTextX = 38;
	doc.setTextColor(...brandPrimary);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(16);
	doc.text('ZATIARAS JUICE', brandTextX, y + 6);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9.5);
	doc.setTextColor(...brandDark);
	doc.text('Laporan Keuangan & Rekonsiliasi Arus Kas', brandTextX, y + 11.5);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.setTextColor(...slate500);
	doc.text('Sistem Informasi Akuntansi & Point of Sale (POS)', brandTextX, y + 16);
	doc.text(
		`Outlet: Cabang ${branchName.toUpperCase()}  •  Status: Sah & Terverifikasi Sistem`,
		brandTextX,
		y + 20.5
	);

	// Metadata Box di Sisi Kanan
	const metaBoxX = 120;
	const metaBoxY = 9;
	const metaBoxW = 76;
	const metaBoxH = 24;

	doc.setFillColor(253, 242, 248); // Soft rose tint
	doc.setDrawColor(244, 114, 182); // Pink border
	doc.setLineWidth(0.4);
	doc.roundedRect(metaBoxX, metaBoxY, metaBoxW, metaBoxH, 2.5, 2.5, 'FD');

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(8.5);
	doc.setTextColor(...brandPrimary);
	doc.text('DOKUMEN KEUANGAN RESMI', metaBoxX + 4.5, metaBoxY + 5.5);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.setTextColor(...brandDark);
	doc.text(`Cabang / Outlet  : ${branchName.toUpperCase()}`, metaBoxX + 4.5, metaBoxY + 10.5);
	doc.text(`Periode Laporan  : ${startDate} s/d ${endDate}`, metaBoxX + 4.5, metaBoxY + 15);
	doc.text(
		`Waktu Cetak      : ${new Date().toLocaleString('id-ID')}`,
		metaBoxX + 4.5,
		metaBoxY + 19.5
	);

	// Garis pembatas Header
	y = 37;
	doc.setDrawColor(...borderSlate);
	doc.setLineWidth(0.4);
	doc.line(14, y, 196, y);

	// ─── 3. KPI STAT CARDS (SPACIOUS EXECUTIVE CARDS) ───────────────────────────
	y += 5;
	const cardW = 43;
	const cardH = 22;
	const cardGap = 3.3;
	const startX = 14;

	const kpiCards = [
		{
			title: 'TOTAL PENDAPATAN',
			value: `Rp ${formatRupiah(pendapatan)}`,
			color: brandDark,
			bg: [248, 250, 252] as [number, number, number],
			border: borderSlate
		},
		{
			title: 'TOTAL PENGELUARAN',
			value: `Rp ${formatRupiah(pengeluaran)}`,
			color: brandDark,
			bg: [248, 250, 252] as [number, number, number],
			border: borderSlate
		},
		{
			title: 'LABA KOTOR',
			value: `Rp ${formatRupiah(labaKotor)}`,
			color: labaKotor >= 0 ? brandDark : redLoss,
			bg: [248, 250, 252] as [number, number, number],
			border: borderSlate
		},
		{
			title: 'LABA BERSIH (NET)',
			value: `Rp ${formatRupiah(labaBersih)}`,
			color: labaBersih >= 0 ? greenProfit : redLoss,
			bg: [253, 242, 248] as [number, number, number], // Rose tint
			border: [244, 114, 182] as [number, number, number]
		}
	];

	kpiCards.forEach((card, idx) => {
		const cx = startX + idx * (cardW + cardGap);
		doc.setFillColor(...card.bg);
		doc.setDrawColor(...card.border);
		doc.setLineWidth(0.4);
		doc.roundedRect(cx, y, cardW, cardH, 2.5, 2.5, 'FD');

		// Judul Card
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(7.5);
		doc.setTextColor(...slate500);
		doc.text(card.title, cx + 4, y + 6.5);

		// Pembatas halus dalam card
		doc.setDrawColor(226, 232, 240);
		doc.setLineWidth(0.2);
		doc.line(cx + 4, y + 9.5, cx + cardW - 4, y + 9.5);

		// Nilai Nominal Prominen
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(11);
		doc.setTextColor(...card.color);
		doc.text(card.value, cx + 4, y + 16.5);
	});

	y += cardH + 9;

	// ─── 4. TABEL I: RINCIAN PEMASUKAN & ARUS KAS MASUK ────────────────────────
	y = renderSectionHeader(
		'I. RINCIAN PEMASUKAN & ARUS KAS MASUK',
		'Detail sumber omzet penjualan produk POS dan penerimaan kas lainnya (Tunai & Non-Tunai/QRIS)',
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

	// Sub-seksi A: Pendapatan Usaha (Penjualan Produk POS)
	pemasukanRows.push([
		{
			content: 'A. PENDAPATAN USAHA (PENJUALAN PRODUK / MENU POS)',
			colSpan: 6,
			styles: {
				fontStyle: 'bold',
				fillColor: [253, 242, 248],
				textColor: brandPrimary,
				fontSize: 8.5
			}
		}
	]);

	if (salesGrouped.length === 0) {
		pemasukanRows.push([
			{
				content: 'Tidak ada data transaksi penjualan menu/produk pada periode ini',
				colSpan: 6,
				styles: { fontStyle: 'italic', halign: 'center', textColor: slate500 }
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
			content: 'B. PEMASUKAN LAIN-LAIN / KAS MASUK TAMBAHAN',
			colSpan: 6,
			styles: {
				fontStyle: 'bold',
				fillColor: [248, 250, 252],
				textColor: brandDark,
				fontSize: 8.5
			}
		}
	]);

	if (otherIncomeGrouped.length === 0) {
		pemasukanRows.push([
			{
				content: 'Tidak ada transaksi pemasukan lain pada periode ini',
				colSpan: 6,
				styles: { fontStyle: 'italic', halign: 'center', textColor: slate500 }
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
		'TOTAL KESELURUHAN PEMASUKAN (A + B)',
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
				'Total Pemasukan (Rp)',
				'Porsi %'
			]
		],
		body: pemasukanRows as any,
		headStyles: {
			fillColor: brandPrimary,
			textColor: [255, 255, 255],
			fontStyle: 'bold',
			fontSize: 8.5,
			cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 }
		},
		bodyStyles: {
			fontSize: 8,
			textColor: brandDark,
			cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 },
			lineColor: [226, 232, 240],
			lineWidth: 0.25
		},
		columnStyles: {
			0: { cellWidth: 10, halign: 'center' },
			1: { cellWidth: 'auto' },
			2: { cellWidth: 32, halign: 'right' },
			3: { cellWidth: 32, halign: 'right' },
			4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
			5: { cellWidth: 18, halign: 'center' }
		},
		didParseCell: (data) => {
			const cellText = String(data.cell.raw ?? '');
			if (cellText.startsWith('Subtotal')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [248, 250, 252];
			} else if (cellText.startsWith('TOTAL KESELURUHAN')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [241, 245, 249];
				data.cell.styles.textColor = brandDark;
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 12;

	// ─── 5. TABEL II: RINCIAN PENGELUARAN & BEBAN OPERASIONAL ───────────────────
	if (y > 185) {
		doc.addPage();
		y = 20;
	}

	y = renderSectionHeader(
		'II. RINCIAN PENGELUARAN & BEBAN OPERASIONAL',
		'Detail pos belanja bahan baku, operasional toko, dan biaya non-operasional (Tunai & QRIS)',
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
				fillColor: [248, 250, 252],
				textColor: slate600,
				fontSize: 8.5
			}
		}
	]);

	if (expenseGrouped.length === 0) {
		pengeluaranRows.push([
			{
				content: 'Tidak ada data transaksi beban operasional pada periode ini',
				colSpan: 6,
				styles: { fontStyle: 'italic', halign: 'center', textColor: slate500 }
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
				fillColor: [248, 250, 252],
				textColor: brandDark,
				fontSize: 8.5
			}
		}
	]);

	if (otherExpenseGrouped.length === 0) {
		pengeluaranRows.push([
			{
				content: 'Tidak ada data beban lainnya pada periode ini',
				colSpan: 6,
				styles: { fontStyle: 'italic', halign: 'center', textColor: slate500 }
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
		'TOTAL KESELURUHAN PENGELUARAN (A + B)',
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
				'Total Pengeluaran (Rp)',
				'Porsi %'
			]
		],
		body: pengeluaranRows as any,
		headStyles: {
			fillColor: slate600,
			textColor: [255, 255, 255],
			fontStyle: 'bold',
			fontSize: 8.5,
			cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 }
		},
		bodyStyles: {
			fontSize: 8,
			textColor: brandDark,
			cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 },
			lineColor: [226, 232, 240],
			lineWidth: 0.25
		},
		columnStyles: {
			0: { cellWidth: 10, halign: 'center' },
			1: { cellWidth: 'auto' },
			2: { cellWidth: 32, halign: 'right' },
			3: { cellWidth: 32, halign: 'right' },
			4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
			5: { cellWidth: 18, halign: 'center' }
		},
		didParseCell: (data) => {
			const cellText = String(data.cell.raw ?? '');
			if (cellText.startsWith('Subtotal')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [248, 250, 252];
			} else if (cellText.startsWith('TOTAL KESELURUHAN')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [241, 245, 249];
				data.cell.styles.textColor = brandDark;
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 12;

	// ─── 6. TABEL III: REKAPITULASI LABA RUGI, PAJAK & SALDO AKHIR ─────────────
	if (y > 190) {
		doc.addPage();
		y = 20;
	}

	y = renderSectionHeader(
		'III. REKAPITULASI LABA RUGI, PAJAK & ARUS KAS AKHIR',
		'Perbandingan arus kas masuk, arus kas keluar, estimasi pajak, dan laba bersih usaha',
		y
	);

	const tunaiMasukTotal = reportGroups.totalTunaiPemasukan;
	const qrisMasukTotal = reportGroups.totalQrisPemasukan;
	const tunaiKeluarTotal = reportGroups.totalTunaiPengeluaran;
	const qrisKeluarTotal = reportGroups.totalQrisPengeluaran;

	const summaryRows: TableRow[] = [
		[
			'Total Arus Kas Masuk / Pemasukan (A)',
			`Rp ${formatRupiah(tunaiMasukTotal)}`,
			`Rp ${formatRupiah(qrisMasukTotal)}`,
			`Rp ${formatRupiah(tunaiMasukTotal + qrisMasukTotal)}`
		],
		[
			'Total Arus Kas Keluar / Pengeluaran (B)',
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
			summary?.taxLabel ? `Estimasi Pajak Usaha (${summary.taxLabel})` : 'Pajak Penghasilan UMKM',
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
			['Kategori Akuntansi & Arus Kas', 'Kas Tunai (Cash)', 'Non-Tunai / QRIS', 'Total Nominal']
		],
		body: summaryRows as any,
		headStyles: {
			fillColor: [30, 41, 59], // Slate-800
			textColor: [255, 255, 255],
			fontStyle: 'bold',
			fontSize: 8.5,
			cellPadding: { top: 3.5, bottom: 3.5, left: 3.5, right: 3.5 }
		},
		bodyStyles: {
			fontSize: 8,
			textColor: brandDark,
			cellPadding: { top: 3, bottom: 3, left: 3.5, right: 3.5 },
			lineColor: [226, 232, 240],
			lineWidth: 0.25
		},
		columnStyles: {
			0: { cellWidth: 76 },
			1: { cellWidth: 35, halign: 'right' },
			2: { cellWidth: 35, halign: 'right' },
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
				data.cell.styles.fillColor = [253, 242, 248];
				data.cell.styles.textColor = brandPrimary;
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 12;

	// ─── 7. TABEL IV: LOG TRANSAKSI BUKU KAS DETAIL ─────────────────────────────
	if (transactions.length > 0) {
		// Untuk log detail buku kas, berikan ruang yang lega (pindah halaman baru jika ruang sempit)
		if (y > 175) {
			doc.addPage();
			y = 20;
		}

		y = renderSectionHeader(
			`IV. LOG TRANSAKSI BUKU KAS DETAIL (${transactions.length} Transaksi)`,
			'Rekaman kronologis seluruh mutasi keuangan kas masuk dan keluar yang tercatat di sistem',
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
				['No', 'Tanggal/Waktu', 'Tipe', 'Kategori', 'Deskripsi / Keterangan', 'Metode', 'Nominal']
			],
			body: transactionRows,
			headStyles: {
				fillColor: [30, 41, 59], // Slate-800
				textColor: [255, 255, 255],
				fontStyle: 'bold',
				fontSize: 8.5,
				cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 }
			},
			bodyStyles: {
				fontSize: 7.8,
				textColor: brandDark,
				cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 },
				lineColor: [226, 232, 240],
				lineWidth: 0.25
			},
			columnStyles: {
				0: { cellWidth: 10, halign: 'center' },
				1: { cellWidth: 28 },
				2: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
				3: { cellWidth: 30 },
				4: { cellWidth: 'auto' },
				5: { cellWidth: 20, halign: 'center' },
				6: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
			},
			alternateRowStyles: {
				fillColor: [248, 250, 252]
			},
			didParseCell: (data) => {
				// Warnai kolom Tipe secara elegan (MASUK emerald, KELUAR rose)
				if (data.column.index === 2 && data.section === 'body') {
					const val = String(data.cell.raw);
					if (val === 'MASUK') {
						data.cell.styles.textColor = greenProfit;
					} else if (val === 'KELUAR') {
						data.cell.styles.textColor = redLoss;
					}
				}
			},
			margin: { left: 14, right: 14 }
		});

		y = getAutoTableFinalY(doc, y) + 12;
	}

	// ─── 8. LEMBAR PENGESAHAN (OFFICIAL APPROVAL SIGNATURES) ─────────────────────
	let signY = y + 4;

	// Pastikan kotak tanda tangan memiliki ruang cukup (tinggi butuh ~40mm)
	if (signY > 230) {
		doc.addPage();
		signY = 24;
	}

	// Kotak Tanda Tangan Kiri (Kasir / Staf Pembuat)
	doc.setFillColor(248, 250, 252);
	doc.setDrawColor(...borderSlate);
	doc.setLineWidth(0.4);
	doc.roundedRect(14, signY, 80, 36, 2.5, 2.5, 'FD');

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(8.5);
	doc.setTextColor(...brandDark);
	doc.text('Dibuat & Dilaporkan Oleh:', 19, signY + 7);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.setTextColor(...slate500);
	doc.text('Kasir / Staf Operasional Cabang', 19, signY + 11.5);

	doc.setDrawColor(203, 213, 225);
	doc.setLineWidth(0.3);
	doc.line(19, signY + 28, 89, signY + 28);

	doc.setFontSize(7.5);
	doc.setTextColor(...slate400);
	doc.text('( Tanda Tangan & Tanggal )', 19, signY + 32.5);

	// Kotak Tanda Tangan Kanan (Pemilik / Manajer Penyetuju)
	doc.setFillColor(253, 242, 248); // Soft rose tint
	doc.setDrawColor(244, 114, 182); // Pink border
	doc.setLineWidth(0.4);
	doc.roundedRect(116, signY, 80, 36, 2.5, 2.5, 'FD');

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(8.5);
	doc.setTextColor(...brandPrimary);
	doc.text('Diperiksa & Disetujui Oleh:', 121, signY + 7);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.setTextColor(...slate500);
	doc.text('Pemilik / Manajer Area Cabang', 121, signY + 11.5);

	doc.setDrawColor(244, 114, 182);
	doc.setLineWidth(0.3);
	doc.line(121, signY + 28, 191, signY + 28);

	doc.setFontSize(7.5);
	doc.setTextColor(...slate400);
	doc.text('( Tanda Tangan & Stempel Resmi )', 121, signY + 32.5);

	// ─── 9. RUNNING HEADER & RUNNING FOOTER DI SELURUH HALAMAN ───────────────────
	const totalPages = getTotalPdfPages(doc);
	const generatedTimestamp = new Date().toLocaleString('id-ID');

	for (let i = 1; i <= totalPages; i++) {
		doc.setPage(i);

		// Running Header untuk Halaman 2 ke atas
		if (i > 1) {
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(7.5);
			doc.setTextColor(...slate400);
			doc.text(`Zatiaras Juice — Laporan Keuangan Periode ${startDate} s/d ${endDate}`, 14, 8);
			doc.text(`Cabang: ${branchName.toUpperCase()}`, 196, 8, { align: 'right' });

			doc.setDrawColor(...borderSlate);
			doc.setLineWidth(0.3);
			doc.line(14, 11, 196, 11);
		}

		// Running Footer di Setiap Halaman
		doc.setDrawColor(...borderSlate);
		doc.setLineWidth(0.3);
		doc.line(14, 287, 196, 287);

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(7.5);
		doc.setTextColor(...slate400);
		doc.text(
			`ZatiarasPOS • Dokumen Keuangan Resmi • Dicetak pada ${generatedTimestamp}`,
			14,
			291.5
		);
		doc.text(`Halaman ${i} dari ${totalPages}`, 196, 291.5, { align: 'right' });
	}

	// ─── 10. SIMPAN PDF ──────────────────────────────────────────────────────────
	const cleanBranch = branchName.replace(/[^a-zA-Z0-9]/g, '_');
	const fileName = `Laporan_Keuangan_Zatiaras_${cleanBranch}_${startDate}_sd_${endDate}.pdf`;
	doc.save(fileName);
}
