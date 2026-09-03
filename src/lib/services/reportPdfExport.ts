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

	// ─── 4. TABEL I: IKHTISAR LABA RUGI & ARUS KAS METODE BAYAR ─────────────────
	y = renderSectionHeader(
		'I. IKHTISAR LABA RUGI & REKONSILIASI KAS (TUNAI vs QRIS)',
		'Rekonsiliasi pergerakan dana kas masuk dan keluar berdasarkan metode pembayaran',
		y
	);

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
			'SALDO AKHIR KAS / LABA BERSIH (A - B - Pajak)',
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
			const rowIdx = data.row.index;
			// Highlight baris Total Pendapatan & Total Pengeluaran
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

	y = getAutoTableFinalY(doc, y) + 12;

	// ─── 5. TABEL II: RINCIAN PENJUALAN PRODUK & TOP MENU ───────────────────────
	const allSalesRecords = [...reportGroups.pemasukanUsahaTunai, ...reportGroups.pemasukanUsahaQris];
	const groupedSales = groupRecordsByName(allSalesRecords);

	if (groupedSales.length > 0) {
		// Evaluasi ruang halaman: jika sisa ruang sempit, pindah ke halaman baru
		if (y > 185) {
			doc.addPage();
			y = 20;
		}

		y = renderSectionHeader(
			'II. RINCIAN PENJUALAN PRODUK & KONTRIBUSI MENU',
			'Analisis menu terlaris beserta kontribusi persentase terhadap omzet',
			y
		);

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
				2: { cellWidth: 30, halign: 'right' },
				3: { cellWidth: 30, halign: 'right' },
				4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
				5: { cellWidth: 18, halign: 'center' }
			},
			alternateRowStyles: {
				fillColor: [253, 242, 248] // Soft rose zebra
			},
			margin: { left: 14, right: 14 }
		});

		y = getAutoTableFinalY(doc, y) + 12;
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
		// Evaluasi ruang halaman sebelum tabel beban
		if (y > 195) {
			doc.addPage();
			y = 20;
		}

		y = renderSectionHeader(
			'III. RINCIAN PENGELUARAN & BEBAN OPERASIONAL TOKO',
			'Klasifikasi pos belanja bahan baku, biaya operasional toko, dan beban non-operasional',
			y
		);

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
				2: { cellWidth: 30, halign: 'right' },
				3: { cellWidth: 30, halign: 'right' },
				4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
				5: { cellWidth: 18, halign: 'center' }
			},
			alternateRowStyles: {
				fillColor: [248, 250, 252] // Slate zebra
			},
			margin: { left: 14, right: 14 }
		});

		y = getAutoTableFinalY(doc, y) + 12;
	}

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
