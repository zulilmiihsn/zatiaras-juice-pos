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
		const isQris =
			(r.metode_bayar || '').toLowerCase().includes('qris') ||
			(r.metode_bayar || '').toLowerCase().includes('transfer') ||
			(r.metode_bayar || '').toLowerCase().includes('non-tunai');

		const cur = map.get(name) || { tunai: 0, qris: 0, total: 0 };
		if (isQris) {
			cur.qris += nom;
		} else {
			cur.tunai += nom;
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

	// Palette warna korporat Zatiaras Juice
	const brandPrimary: [number, number, number] = [190, 24, 93]; // Rose-700 (#be185d)
	const brandDark: [number, number, number] = [30, 41, 59]; // Slate-800 (#1e293b)
	const slate500: [number, number, number] = [100, 116, 139]; // Slate-500
	const slate400: [number, number, number] = [148, 163, 184]; // Slate-400
	const greenProfit: [number, number, number] = [16, 149, 103]; // Emerald-600
	const redLoss: [number, number, number] = [225, 29, 72]; // Rose-600

	const pendapatan = Number(summary?.pendapatan || 0);
	const pengeluaran = Number(summary?.pengeluaran || 0);
	const labaKotor = Number(summary?.labaKotor || pendapatan - pengeluaran);
	const pajak = Number(summary?.pajak || 0);
	const labaBersih = Number(
		summary?.labaBersih || (summary?.saldo ?? pendapatan - pengeluaran - pajak)
	);

	// ─── 1. TOP ACCENT BAR ───────────────────────────────────────────────────────
	doc.setFillColor(...brandPrimary);
	doc.rect(0, 0, 210, 4, 'F');

	// ─── 2. EXECUTIVE HEADER (DENGAN LOGO RESMI ZATIARAS) ───────────────────────
	let y = 8;

	// Logo Toko di Sisi Kiri
	try {
		if (LOGO_BASE64) {
			doc.addImage(LOGO_BASE64, 'PNG', 14, y, 19, 19);
		}
	} catch {
		// Fallback jika render image tidak didukung
	}

	// Brand Title & Tagline (Di samping Logo)
	const brandTextX = 36;
	doc.setTextColor(...brandPrimary);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(15);
	doc.text('ZATIARAS JUICE', brandTextX, y + 5);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(8.5);
	doc.setTextColor(...brandDark);
	doc.text('Sistem Manajemen Keuangan & Point of Sale (POS)', brandTextX, y + 9.5);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(...slate500);
	doc.text('Dokumen Laporan Keuangan, Arus Kas & Rekonsiliasi Transaksi', brandTextX, y + 13.5);
	doc.text(
		`Outlet: Cabang ${branchName.toUpperCase()} • Status: Sah & Terverifikasi`,
		brandTextX,
		y + 17.5
	);

	// Metadata Box di Kanan
	const metaBoxX = 120;
	const metaBoxY = 7;
	const metaBoxW = 76;
	const metaBoxH = 21;

	doc.setFillColor(253, 242, 248); // Soft pink tint
	doc.setDrawColor(244, 114, 182); // Pink border
	doc.roundedRect(metaBoxX, metaBoxY, metaBoxW, metaBoxH, 2, 2, 'FD');

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(8);
	doc.setTextColor(...brandPrimary);
	doc.text('DOKUMEN LAPORAN KEUANGAN', metaBoxX + 4, metaBoxY + 5);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(...brandDark);
	doc.text(`Cabang / Outlet  : ${branchName.toUpperCase()}`, metaBoxX + 4, metaBoxY + 9.5);
	doc.text(`Periode Laporan  : ${startDate} s/d ${endDate}`, metaBoxX + 4, metaBoxY + 13.5);
	doc.text(
		`Waktu Unduh     : ${new Date().toLocaleString('id-ID')}`,
		metaBoxX + 4,
		metaBoxY + 17.5
	);

	// Garis pembatas Header
	y = 31;
	doc.setDrawColor(226, 232, 240);
	doc.setLineWidth(0.4);
	doc.line(14, y, 196, y);

	// ─── 3. KPI STAT CARDS (4-GRID) ─────────────────────────────────────────────
	y += 4;
	const cardW = 43.5;
	const cardH = 16;
	const cardGap = 2.6;
	const startX = 14;

	const kpiCards = [
		{
			title: 'TOTAL PENDAPATAN',
			value: `Rp ${formatRupiah(pendapatan)}`,
			color: brandDark,
			bg: [248, 250, 252] as [number, number, number]
		},
		{
			title: 'TOTAL PENGELUARAN',
			value: `Rp ${formatRupiah(pengeluaran)}`,
			color: brandDark,
			bg: [248, 250, 252] as [number, number, number]
		},
		{
			title: 'LABA KOTOR',
			value: `Rp ${formatRupiah(labaKotor)}`,
			color: labaKotor >= 0 ? brandDark : redLoss,
			bg: [248, 250, 252] as [number, number, number]
		},
		{
			title: 'LABA BERSIH (NET)',
			value: `Rp ${formatRupiah(labaBersih)}`,
			color: labaBersih >= 0 ? greenProfit : redLoss,
			bg: [253, 242, 248] as [number, number, number] // Pink soft tint
		}
	];

	kpiCards.forEach((card, idx) => {
		const cx = startX + idx * (cardW + cardGap);
		doc.setFillColor(...card.bg);
		doc.setDrawColor(226, 232, 240);
		doc.roundedRect(cx, y, cardW, cardH, 2, 2, 'FD');

		// Judul Card
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(6.5);
		doc.setTextColor(...slate500);
		doc.text(card.title, cx + 3, y + 4.5);

		// Nilai Nominal
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(9);
		doc.setTextColor(...card.color);
		doc.text(card.value, cx + 3, y + 11.5);
	});

	y += cardH + 6;

	// ─── 4. TABEL I: IKHTISAR LABA RUGI & ARUS KAS METODE BAYAR ─────────────────
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9.5);
	doc.setTextColor(...brandDark);
	doc.text('I. IKHTISAR LABA RUGI & REKONSILIASI KAS (TUNAI vs QRIS)', 14, y);
	y += 2.5;

	const sumPemasukanUsaha =
		reportGroups.pemasukanUsahaTunai.reduce((a, b) => a + Number(b.nominal || 0), 0) +
		reportGroups.pemasukanUsahaQris.reduce((a, b) => a + Number(b.nominal || 0), 0);

	const sumPemasukanLain =
		reportGroups.pemasukanLainTunai.reduce((a, b) => a + Number(b.nominal || 0), 0) +
		reportGroups.pemasukanLainQris.reduce((a, b) => a + Number(b.nominal || 0), 0);

	const sumBebanUsaha =
		reportGroups.bebanUsahaTunai.reduce((a, b) => a + Number(b.nominal || 0), 0) +
		reportGroups.bebanUsahaQris.reduce((a, b) => a + Number(b.nominal || 0), 0);

	const sumBebanLain =
		reportGroups.bebanLainTunai.reduce((a, b) => a + Number(b.nominal || 0), 0) +
		reportGroups.bebanLainQris.reduce((a, b) => a + Number(b.nominal || 0), 0);

	const tunaiMasukTotal = reportGroups.totalTunaiPemasukan;
	const qrisMasukTotal = reportGroups.totalQrisPemasukan;
	const tunaiKeluarTotal = reportGroups.totalTunaiPengeluaran;
	const qrisKeluarTotal = reportGroups.totalQrisPengeluaran;

	const summaryRows = [
		[
			'Pendapatan Usaha (Penjualan Menu POS)',
			`Rp ${formatRupiah(reportGroups.pemasukanUsahaTunai.reduce((a, b) => a + Number(b.nominal || 0), 0))}`,
			`Rp ${formatRupiah(reportGroups.pemasukanUsahaQris.reduce((a, b) => a + Number(b.nominal || 0), 0))}`,
			`Rp ${formatRupiah(sumPemasukanUsaha)}`
		],
		[
			'Pendapatan Lain-lain (Modal Awal / Kas Tambahan)',
			`Rp ${formatRupiah(reportGroups.pemasukanLainTunai.reduce((a, b) => a + Number(b.nominal || 0), 0))}`,
			`Rp ${formatRupiah(reportGroups.pemasukanLainQris.reduce((a, b) => a + Number(b.nominal || 0), 0))}`,
			`Rp ${formatRupiah(sumPemasukanLain)}`
		],
		[
			'TOTAL PENDAPATAN / ARUS KAS MASUK (A)',
			`Rp ${formatRupiah(tunaiMasukTotal)}`,
			`Rp ${formatRupiah(qrisMasukTotal)}`,
			`Rp ${formatRupiah(tunaiMasukTotal + qrisMasukTotal)}`
		],
		[
			'Beban Usaha (Bahan Baku, Es Batu, Cup, Gaji Kasir)',
			`Rp ${formatRupiah(reportGroups.bebanUsahaTunai.reduce((a, b) => a + Number(b.nominal || 0), 0))}`,
			`Rp ${formatRupiah(reportGroups.bebanUsahaQris.reduce((a, b) => a + Number(b.nominal || 0), 0))}`,
			`Rp ${formatRupiah(sumBebanUsaha)}`
		],
		[
			'Beban Lainnya / Biaya Non-Operasional',
			`Rp ${formatRupiah(reportGroups.bebanLainTunai.reduce((a, b) => a + Number(b.nominal || 0), 0))}`,
			`Rp ${formatRupiah(reportGroups.bebanLainQris.reduce((a, b) => a + Number(b.nominal || 0), 0))}`,
			`Rp ${formatRupiah(sumBebanLain)}`
		],
		[
			'TOTAL PENGELUARAN / ARUS KAS KELUAR (B)',
			`Rp ${formatRupiah(tunaiKeluarTotal)}`,
			`Rp ${formatRupiah(qrisKeluarTotal)}`,
			`Rp ${formatRupiah(tunaiKeluarTotal + qrisKeluarTotal)}`
		],
		[
			summary?.taxLabel ? `Estimasi Pajak Usaha (${summary.taxLabel})` : 'Pajak Penghasilan UMKM',
			'-',
			'-',
			`Rp ${formatRupiah(pajak)}`
		],
		[
			'SALDO AKHIR KAS / LABA BERSIH PERIODE INI (A - B - Pajak)',
			`Rp ${formatRupiah(reportGroups.totalTunaiAll)}`,
			`Rp ${formatRupiah(reportGroups.totalQrisAll)}`,
			`Rp ${formatRupiah(labaBersih)}`
		]
	];

	autoTable(doc, {
		startY: y,
		theme: 'grid',
		head: [
			['Kategori Akuntansi & Arus Kas', 'Kas Tunai (Cash)', 'Non-Tunai / QRIS', 'Total Nominal']
		],
		body: summaryRows,
		headStyles: {
			fillColor: [30, 41, 59], // Slate-800
			textColor: [255, 255, 255],
			fontStyle: 'bold',
			fontSize: 7.5,
			cellPadding: 2
		},
		bodyStyles: {
			fontSize: 7,
			textColor: brandDark,
			cellPadding: 1.8
		},
		columnStyles: {
			0: { cellWidth: 80 },
			1: { cellWidth: 34, halign: 'right' },
			2: { cellWidth: 34, halign: 'right' },
			3: { cellWidth: 34, halign: 'right', fontStyle: 'bold' }
		},
		didParseCell: (data) => {
			const rowIdx = data.row.index;
			// Highlight baris Total Pendapatan & Total Beban
			if (rowIdx === 2 || rowIdx === 5) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [241, 245, 249];
			}
			// Highlight baris Laba Bersih
			if (rowIdx === 7) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.fillColor = [253, 242, 248];
				data.cell.styles.textColor = brandPrimary;
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 6;

	// ─── 5. TABEL II: RINCIAN PENJUALAN PRODUK & TOP MENU ───────────────────────
	const allSalesRecords = [...reportGroups.pemasukanUsahaTunai, ...reportGroups.pemasukanUsahaQris];
	const groupedSales = groupRecordsByName(allSalesRecords);

	if (groupedSales.length > 0) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(9.5);
		doc.setTextColor(...brandDark);
		doc.text('II. RINCIAN PENJUALAN PRODUK & KONTRIBUSI MENU', 14, y);
		y += 2.5;

		const salesTableRows = groupedSales.map((item, idx) => {
			const no = String(idx + 1);
			const percent =
				sumPemasukanUsaha > 0 ? `${((item.total / sumPemasukanUsaha) * 100).toFixed(1)}%` : '0.0%';
			return [
				no,
				item.name,
				`Rp ${formatRupiah(item.tunai)}`,
				`Rp ${formatRupiah(item.qris)}`,
				`Rp ${formatRupiah(item.total)}`,
				percent
			];
		});

		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [
				[
					'No',
					'Nama Menu / Item Penjualan',
					'Tunai (Rp)',
					'QRIS (Rp)',
					'Total Penjualan (Rp)',
					'Porsi %'
				]
			],
			body: salesTableRows,
			headStyles: {
				fillColor: [190, 24, 93], // Rose-700
				textColor: [255, 255, 255],
				fontStyle: 'bold',
				fontSize: 7.5,
				cellPadding: 2
			},
			bodyStyles: {
				fontSize: 7,
				textColor: brandDark,
				cellPadding: 1.8
			},
			columnStyles: {
				0: { cellWidth: 8, halign: 'center' },
				1: { cellWidth: 'auto' },
				2: { cellWidth: 28, halign: 'right' },
				3: { cellWidth: 28, halign: 'right' },
				4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
				5: { cellWidth: 16, halign: 'center' }
			},
			alternateRowStyles: {
				fillColor: [253, 242, 248]
			},
			margin: { left: 14, right: 14 }
		});

		y = getAutoTableFinalY(doc, y) + 6;
	}

	// ─── 6. TABEL III: RINCIAN PENGELUARAN & BEBAN OPERASIONAL ──────────────────
	const allExpenseRecords = [
		...reportGroups.bebanUsahaTunai,
		...reportGroups.bebanUsahaQris,
		...reportGroups.bebanLainTunai,
		...reportGroups.bebanLainQris
	];
	const groupedExpenses = groupRecordsByName(allExpenseRecords);

	if (groupedExpenses.length > 0) {
		// Periksa jika perlu halaman baru sebelum tabel beban
		if (y > 230) {
			doc.addPage();
			y = 14;
		}

		doc.setFont('helvetica', 'bold');
		doc.setFontSize(9.5);
		doc.setTextColor(...brandDark);
		doc.text('III. RINCIAN PENGELUARAN & BEBAN OPERASIONAL TOKO', 14, y);
		y += 2.5;

		const expenseTableRows = groupedExpenses.map((item, idx) => {
			const no = String(idx + 1);
			const totalExp = tunaiKeluarTotal + qrisKeluarTotal;
			const percent = totalExp > 0 ? `${((item.total / totalExp) * 100).toFixed(1)}%` : '0.0%';
			return [
				no,
				item.name,
				`Rp ${formatRupiah(item.tunai)}`,
				`Rp ${formatRupiah(item.qris)}`,
				`Rp ${formatRupiah(item.total)}`,
				percent
			];
		});

		autoTable(doc, {
			startY: y,
			theme: 'grid',
			head: [
				[
					'No',
					'Pos Pengeluaran / Deskripsi Beban',
					'Tunai (Rp)',
					'QRIS (Rp)',
					'Total Pengeluaran (Rp)',
					'Porsi %'
				]
			],
			body: expenseTableRows,
			headStyles: {
				fillColor: [71, 85, 105], // Slate-600
				textColor: [255, 255, 255],
				fontStyle: 'bold',
				fontSize: 7.5,
				cellPadding: 2
			},
			bodyStyles: {
				fontSize: 7,
				textColor: brandDark,
				cellPadding: 1.8
			},
			columnStyles: {
				0: { cellWidth: 8, halign: 'center' },
				1: { cellWidth: 'auto' },
				2: { cellWidth: 28, halign: 'right' },
				3: { cellWidth: 28, halign: 'right' },
				4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
				5: { cellWidth: 16, halign: 'center' }
			},
			alternateRowStyles: {
				fillColor: [248, 250, 252]
			},
			margin: { left: 14, right: 14 }
		});

		y = getAutoTableFinalY(doc, y) + 6;
	}

	// ─── 7. TABEL IV: LOG TRANSAKSI BUKU KAS DETAIL ─────────────────────────────
	// Log transaksi detail selalu diletakkan di halaman baru jika ruang tidak cukup
	if (y > 210) {
		doc.addPage();
		y = 14;
	}

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9.5);
	doc.setTextColor(...brandDark);
	doc.text(`IV. LOG TRANSAKSI BUKU KAS DETAIL (${transactions.length} Transaksi)`, 14, y);
	y += 2.5;

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
		body:
			transactionRows.length > 0
				? transactionRows
				: [['-', '-', '-', '-', 'Tidak ada transaksi pada periode ini', '-', '-']],
		headStyles: {
			fillColor: [30, 41, 59], // Slate-800
			textColor: [255, 255, 255],
			fontStyle: 'bold',
			fontSize: 7.5,
			cellPadding: 2
		},
		bodyStyles: {
			fontSize: 7,
			textColor: brandDark,
			cellPadding: 1.8
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
			// Warnai kolom Tipe (MASUK hijau, KELUAR merah)
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

	// ─── 8. LEMBAR PENGESAHAN (SIGNATURE APPROVAL BOX) ──────────────────────────
	const finalTableY = getAutoTableFinalY(doc, y);
	let signY = finalTableY + 12;

	// Cek apakah muat di halaman saat ini atau perlu halaman baru
	if (signY > 245) {
		doc.addPage();
		signY = 20;
	}

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.setTextColor(...brandDark);

	// Kotak Tanda Tangan Kiri (Kasir / Staf)
	doc.text('Dibuat & Diserahkan Oleh:', 24, signY);
	doc.text('Kasir / Staf Operasional,', 24, signY + 4);
	doc.line(24, signY + 22, 74, signY + 22);
	doc.setFontSize(7.5);
	doc.setTextColor(...slate400);
	doc.text('( Nama Terang & Tanggal )', 24, signY + 26);

	// Kotak Tanda Tangan Kanan (Pemilik / Supervisor)
	doc.setFontSize(8);
	doc.setTextColor(...brandDark);
	doc.text('Diperiksa & Disetujui Oleh:', 136, signY);
	doc.text('Pemilik / Manajer Cabang,', 136, signY + 4);
	doc.line(136, signY + 22, 186, signY + 22);
	doc.setFontSize(7.5);
	doc.setTextColor(...slate400);
	doc.text('( Nama Terang & Tanggal )', 136, signY + 26);

	// ─── 9. FOOTER NUMBERING UNTUK SELURUH HALAMAN ──────────────────────────────
	const totalPages = getTotalPdfPages(doc);
	const generatedTimestamp = new Date().toLocaleString('id-ID');

	for (let i = 1; i <= totalPages; i++) {
		doc.setPage(i);

		// Hairline pembatas footer
		doc.setDrawColor(226, 232, 240);
		doc.setLineWidth(0.3);
		doc.line(14, 287, 196, 287);

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(7);
		doc.setTextColor(...slate400);
		doc.text(
			`ZatiarasPOS • Laporan Resmi dicetak pada ${generatedTimestamp} • Cabang ${branchName.toUpperCase()}`,
			14,
			291
		);
		doc.text(`Halaman ${i} dari ${totalPages}`, 196, 291, { align: 'right' });
	}

	// ─── 10. SIMPAN PDF KE BROWSER ───────────────────────────────────────────────
	const cleanBranch = branchName.replace(/[^a-zA-Z0-9]/g, '_');
	const fileName = `Laporan_Keuangan_Zatiaras_${cleanBranch}_${startDate}_sd_${endDate}.pdf`;
	doc.save(fileName);
}
