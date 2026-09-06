/**
 * 📊 ZatiarasPOS - Executive Financial PDF Generator
 * Menghasilkan Laporan Keuangan & Arus Kas standar korporat & akuntansi resmi (Minimalist, Clean, Audit-Ready).
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

export type TableCell =
	| string
	| number
	| {
			content: string;
			colSpan?: number;
			rowSpan?: number;
			styles?: Record<string, unknown>;
	  };

export type TableRow = TableCell[];

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

/** Mengekstrak teks sel pertama untuk mengecek tipe baris (Subtotal / Total / Label) */
function getRowFirstCellText(data: { row: { raw: unknown } }): string {
	if (Array.isArray(data.row.raw)) {
		const first = data.row.raw[0];
		if (typeof first === 'object' && first !== null && 'content' in first) {
			return String((first as { content: unknown }).content ?? '');
		}
		return String(first ?? '');
	}
	return '';
}

/** Mengelompokkan transaksi berdasarkan nama item/keterangan */
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

interface CashFlowSectionParams {
	titleA: string;
	emptyTextA: string;
	recordsTunaiA: BukuKasRecord[];
	recordsQrisA: BukuKasRecord[];
	subtotalLabelA: string;
	titleB: string;
	emptyTextB: string;
	recordsTunaiB: BukuKasRecord[];
	recordsQrisB: BukuKasRecord[];
	subtotalLabelB: string;
	grandTotalTunai: number;
	grandTotalQris: number;
	grandTotalNominal: number;
	grandTotalLabel: string;
	colDark: [number, number, number];
	colMuted: [number, number, number];
}

/** Builder baris tabel arus kas 2-level (Usaha & Lain-lain) - Prinsip DRY */
function buildCashFlowSectionRows(params: CashFlowSectionParams): TableRow[] {
	const {
		titleA,
		emptyTextA,
		recordsTunaiA,
		recordsQrisA,
		subtotalLabelA,
		titleB,
		emptyTextB,
		recordsTunaiB,
		recordsQrisB,
		subtotalLabelB,
		grandTotalTunai,
		grandTotalQris,
		grandTotalNominal,
		grandTotalLabel,
		colDark,
		colMuted
	} = params;

	const rows: TableRow[] = [];

	// ─── Sub-seksi A ───
	rows.push([
		{
			content: titleA,
			colSpan: 5,
			styles: {
				fontStyle: 'bold',
				textColor: colDark,
				fontSize: 7.5
			}
		}
	]);

	const groupedA = groupRecordsByName([...recordsTunaiA, ...recordsQrisA]);
	const tunaiA = recordsTunaiA.reduce((sum, r) => sum + Number(r.nominal || 0), 0);
	const qrisA = recordsQrisA.reduce((sum, r) => sum + Number(r.nominal || 0), 0);
	const sumA = tunaiA + qrisA;

	if (groupedA.length === 0) {
		rows.push([
			{
				content: emptyTextA,
				colSpan: 5,
				styles: { fontStyle: 'italic', halign: 'center', textColor: colMuted, fontSize: 7 }
			}
		]);
	} else {
		groupedA.forEach((item) => {
			const percent =
				grandTotalNominal > 0 ? `${((item.total / grandTotalNominal) * 100).toFixed(1)}%` : '0.0%';
			rows.push([
				`  • ${item.name}`,
				`Rp ${formatRupiah(item.tunai)}`,
				`Rp ${formatRupiah(item.qris)}`,
				`Rp ${formatRupiah(item.total)}`,
				percent
			]);
		});
	}

	rows.push([
		subtotalLabelA,
		`Rp ${formatRupiah(tunaiA)}`,
		`Rp ${formatRupiah(qrisA)}`,
		`Rp ${formatRupiah(sumA)}`,
		grandTotalNominal > 0 ? `${((sumA / grandTotalNominal) * 100).toFixed(1)}%` : '0.0%'
	]);

	// ─── Sub-seksi B ───
	rows.push([
		{
			content: titleB,
			colSpan: 5,
			styles: {
				fontStyle: 'bold',
				textColor: colDark,
				fontSize: 7.5
			}
		}
	]);

	const groupedB = groupRecordsByName([...recordsTunaiB, ...recordsQrisB]);
	const tunaiB = recordsTunaiB.reduce((sum, r) => sum + Number(r.nominal || 0), 0);
	const qrisB = recordsQrisB.reduce((sum, r) => sum + Number(r.nominal || 0), 0);
	const sumB = tunaiB + qrisB;

	if (groupedB.length === 0) {
		rows.push([
			{
				content: emptyTextB,
				colSpan: 5,
				styles: { fontStyle: 'italic', halign: 'center', textColor: colMuted, fontSize: 7 }
			}
		]);
	} else {
		groupedB.forEach((item) => {
			const percent =
				grandTotalNominal > 0 ? `${((item.total / grandTotalNominal) * 100).toFixed(1)}%` : '0.0%';
			rows.push([
				`  • ${item.name}`,
				`Rp ${formatRupiah(item.tunai)}`,
				`Rp ${formatRupiah(item.qris)}`,
				`Rp ${formatRupiah(item.total)}`,
				percent
			]);
		});
	}

	rows.push([
		subtotalLabelB,
		`Rp ${formatRupiah(tunaiB)}`,
		`Rp ${formatRupiah(qrisB)}`,
		`Rp ${formatRupiah(sumB)}`,
		grandTotalNominal > 0 ? `${((sumB / grandTotalNominal) * 100).toFixed(1)}%` : '0.0%'
	]);

	// ─── Grand Total ───
	rows.push([
		grandTotalLabel,
		`Rp ${formatRupiah(grandTotalTunai)}`,
		`Rp ${formatRupiah(grandTotalQris)}`,
		`Rp ${formatRupiah(grandTotalNominal)}`,
		'100.0%'
	]);

	return rows;
}

export function generateLaporanPdf(options: GeneratePdfOptions): void {
	const doc = new jsPDF({
		orientation: 'portrait',
		unit: 'mm',
		format: 'a4'
	});

	const { branchName, startDate, endDate, summary, reportGroups, transactions } = options;

	// Palette Warna Dokumen Keuangan Minimalis Resmi
	const colDark: [number, number, number] = [17, 24, 39]; // Gray-900 (Teks Utama)
	const colMuted: [number, number, number] = [75, 85, 99]; // Gray-600 (Keterangan/Subteks)
	const colNegative: [number, number, number] = [185, 28, 28]; // Red-700 (Jika Rugi/Keluar)

	const pendapatan = Number(summary?.pendapatan || 0);
	const pengeluaran = Number(summary?.pengeluaran || 0);
	const labaKotor = Number(summary?.labaKotor || pendapatan - pengeluaran);
	const pajak = Number(summary?.pajak || 0);
	const labaBersih = Number(
		summary?.labaBersih || (summary?.saldo ?? pendapatan - pengeluaran - pajak)
	);

	// Styling standar AutoTable
	const baseHeadStyles = {
		fillColor: false as const,
		textColor: colDark,
		fontStyle: 'bold' as const,
		fontSize: 7.5,
		cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
		lineWidth: { top: 0.3, bottom: 0.3 },
		lineColor: [31, 41, 55] as [number, number, number]
	};

	const baseBodyStyles = {
		fontSize: 7.5,
		textColor: colDark,
		cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 },
		lineWidth: { bottom: 0.1 },
		lineColor: [243, 244, 246] as [number, number, number]
	};

	// Helper Render Judul Seksi Minimalis (Tanpa balok warna)
	function renderSectionHeader(title: string, subcaption: string, currentY: number): number {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(8.5);
		doc.setTextColor(...colDark);
		doc.text(title, 14, currentY + 4);

		if (subcaption) {
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(7);
			doc.setTextColor(...colMuted);
			doc.text(subcaption, 14, currentY + 8);
			return currentY + 11;
		}

		return currentY + 7;
	}

	// ─── 1. KOP SURAT RESMI (LETTERHEAD) ─────────────────────────────────────────
	let y = 14;

	// Logo Usaha (Kiri)
	try {
		if (LOGO_BASE64) {
			doc.addImage(LOGO_BASE64, 'PNG', 14, y, 13, 13);
		}
	} catch {}

	const headerTextX = 30;

	// Nama Usaha & Subjudul
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(13);
	doc.setTextColor(...colDark);
	doc.text('ZATIARAS JUICE', headerTextX, y + 4);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(8.5);
	doc.setTextColor(...colMuted);
	doc.text('LAPORAN KEUANGAN & REKONSILIASI KAS', headerTextX, y + 8.5);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(...colMuted);
	doc.text(`Cabang: ${branchName.toUpperCase()}`, headerTextX, y + 12.5);

	// Blok Metadata Kanan
	const metaX = 140;
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(...colMuted);
	doc.text('Periode', metaX, y + 4);
	doc.text(':', metaX + 15, y + 4);
	doc.setFont('helvetica', 'bold');
	doc.setTextColor(...colDark);
	doc.text(`${startDate} s/d ${endDate}`, metaX + 18, y + 4);

	doc.setFont('helvetica', 'normal');
	doc.setTextColor(...colMuted);
	doc.text('Dicetak', metaX, y + 8.5);
	doc.text(':', metaX + 15, y + 8.5);
	doc.text(`${new Date().toLocaleString('id-ID')}`, metaX + 18, y + 8.5);

	doc.text('Status', metaX, y + 12.5);
	doc.text(':', metaX + 15, y + 12.5);
	doc.text('Sah & Terverifikasi', metaX + 18, y + 12.5);

	// Garis Pembatas Kop Surat
	y = 30;
	doc.setDrawColor(31, 41, 55);
	doc.setLineWidth(0.35);
	doc.line(14, y, 196, y);

	// ─── 2. IKHTISAR KEUANGAN (MINIMALIST FINANCIAL SUMMARY) ─────────────────────
	y += 4;
	const statW = 182 / 4;
	doc.setFillColor(249, 250, 251);
	doc.rect(14, y, 182, 13, 'F');
	doc.setDrawColor(229, 231, 235);
	doc.setLineWidth(0.2);
	doc.rect(14, y, 182, 13, 'S');

	const statCols = [
		{ label: 'TOTAL PENDAPATAN', value: `Rp ${formatRupiah(pendapatan)}`, isNeg: false },
		{ label: 'TOTAL PENGELUARAN', value: `Rp ${formatRupiah(pengeluaran)}`, isNeg: false },
		{ label: 'LABA KOTOR', value: `Rp ${formatRupiah(labaKotor)}`, isNeg: labaKotor < 0 },
		{ label: 'LABA BERSIH (NET)', value: `Rp ${formatRupiah(labaBersih)}`, isNeg: labaBersih < 0 }
	];

	statCols.forEach((col, idx) => {
		const cx = 14 + idx * statW;
		if (idx > 0) {
			doc.setDrawColor(229, 231, 235);
			doc.setLineWidth(0.2);
			doc.line(cx, y + 2, cx, y + 11);
		}

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(6.5);
		doc.setTextColor(...colMuted);
		doc.text(col.label, cx + statW / 2, y + 4.2, { align: 'center' });

		doc.setFont('helvetica', 'bold');
		doc.setFontSize(8.5);
		doc.setTextColor(...(col.isNeg ? colNegative : colDark));
		doc.text(col.value, cx + statW / 2, y + 9.8, { align: 'center' });
	});

	y += 18;

	// ─── 3. TABEL I: RINCIAN PENDAPATAN & ARUS KAS MASUK ────────────────────────
	y = renderSectionHeader(
		'1. PENDAPATAN & PENERIMAAN KAS',
		'Rincian penerimaan kas dari penjualan produk POS dan sumber kas masuk lainnya',
		y
	);

	const totalPemasukan = reportGroups.totalTunaiPemasukan + reportGroups.totalQrisPemasukan;
	const pemasukanRows = buildCashFlowSectionRows({
		titleA: 'A. Pendapatan Usaha (Penjualan Produk POS)',
		emptyTextA: 'Tidak ada transaksi penjualan produk pada periode ini',
		recordsTunaiA: reportGroups.pemasukanUsahaTunai,
		recordsQrisA: reportGroups.pemasukanUsahaQris,
		subtotalLabelA: 'Subtotal Pendapatan Usaha',
		titleB: 'B. Pemasukan Lain-lain',
		emptyTextB: 'Tidak ada penerimaan kas lain pada periode ini',
		recordsTunaiB: reportGroups.pemasukanLainTunai,
		recordsQrisB: reportGroups.pemasukanLainQris,
		subtotalLabelB: 'Subtotal Pemasukan Lainnya',
		grandTotalTunai: reportGroups.totalTunaiPemasukan,
		grandTotalQris: reportGroups.totalQrisPemasukan,
		grandTotalNominal: totalPemasukan,
		grandTotalLabel: 'TOTAL PENERIMAAN KAS (A + B)',
		colDark,
		colMuted
	});

	autoTable(doc, {
		startY: y,
		theme: 'plain',
		head: [
			[
				'Keterangan / Sumber Penerimaan',
				'Kas Tunai (Rp)',
				'QRIS / Non-Tunai (Rp)',
				'Total (Rp)',
				'Porsi'
			]
		],
		body: pemasukanRows as any,
		headStyles: baseHeadStyles,
		bodyStyles: baseBodyStyles,
		columnStyles: {
			0: { cellWidth: 'auto' },
			1: { cellWidth: 34, halign: 'right' },
			2: { cellWidth: 34, halign: 'right' },
			3: { cellWidth: 36, halign: 'right', fontStyle: 'bold' },
			4: { cellWidth: 16, halign: 'right' }
		},
		didParseCell: (data) => {
			const label = getRowFirstCellText(data);
			if (label.startsWith('Subtotal')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.lineWidth = { top: 0.2, bottom: 0.2 };
				data.cell.styles.lineColor = [209, 213, 219];
			} else if (label.startsWith('TOTAL PENERIMAAN')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.lineWidth = { top: 0.3, bottom: 0.6 };
				data.cell.styles.lineColor = [31, 41, 55];
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 7;

	// ─── 4. TABEL II: RINCIAN PENGELUARAN & BEBAN OPERASIONAL ───────────────────
	if (y > 215) {
		doc.addPage();
		y = 16;
	}

	y = renderSectionHeader(
		'2. PENGELUARAN & BEBAN OPERASIONAL',
		'Rincian belanja bahan baku, operasional toko, dan biaya kas keluar lainnya',
		y
	);

	const totalPengeluaran = reportGroups.totalTunaiPengeluaran + reportGroups.totalQrisPengeluaran;
	const pengeluaranRows = buildCashFlowSectionRows({
		titleA: 'A. Beban Usaha (Operasional & Bahan Baku)',
		emptyTextA: 'Tidak ada data beban operasional pada periode ini',
		recordsTunaiA: reportGroups.bebanUsahaTunai,
		recordsQrisA: reportGroups.bebanUsahaQris,
		subtotalLabelA: 'Subtotal Beban Usaha',
		titleB: 'B. Beban Lain-lain / Non-Operasional',
		emptyTextB: 'Tidak ada data beban lainnya pada periode ini',
		recordsTunaiB: reportGroups.bebanLainTunai,
		recordsQrisB: reportGroups.bebanLainQris,
		subtotalLabelB: 'Subtotal Beban Lainnya',
		grandTotalTunai: reportGroups.totalTunaiPengeluaran,
		grandTotalQris: reportGroups.totalQrisPengeluaran,
		grandTotalNominal: totalPengeluaran,
		grandTotalLabel: 'TOTAL PENGELUARAN KAS (A + B)',
		colDark,
		colMuted
	});

	autoTable(doc, {
		startY: y,
		theme: 'plain',
		head: [
			[
				'Keterangan / Pos Pengeluaran',
				'Kas Tunai (Rp)',
				'QRIS / Non-Tunai (Rp)',
				'Total (Rp)',
				'Porsi'
			]
		],
		body: pengeluaranRows as any,
		headStyles: baseHeadStyles,
		bodyStyles: baseBodyStyles,
		columnStyles: {
			0: { cellWidth: 'auto' },
			1: { cellWidth: 34, halign: 'right' },
			2: { cellWidth: 34, halign: 'right' },
			3: { cellWidth: 36, halign: 'right', fontStyle: 'bold' },
			4: { cellWidth: 16, halign: 'right' }
		},
		didParseCell: (data) => {
			const label = getRowFirstCellText(data);
			if (label.startsWith('Subtotal')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.lineWidth = { top: 0.2, bottom: 0.2 };
				data.cell.styles.lineColor = [209, 213, 219];
			} else if (label.startsWith('TOTAL PENGELUARAN')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.lineWidth = { top: 0.3, bottom: 0.6 };
				data.cell.styles.lineColor = [31, 41, 55];
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 7;

	// ─── 5. TABEL III: REKAPITULASI LABA RUGI & SALDO AKHIR ─────────────────────
	if (y > 220) {
		doc.addPage();
		y = 16;
	}

	y = renderSectionHeader(
		'3. REKAPITULASI LABA RUGI & SALDO AKHIR KAS',
		'Perhitungan penerimaan kas, pengeluaran kas, pajak penghasilan, dan saldo akhir',
		y
	);

	const tunaiMasukTotal = reportGroups.totalTunaiPemasukan;
	const qrisMasukTotal = reportGroups.totalQrisPemasukan;
	const tunaiKeluarTotal = reportGroups.totalTunaiPengeluaran;
	const qrisKeluarTotal = reportGroups.totalQrisPengeluaran;

	const summaryRows: TableRow[] = [
		[
			'Total Penerimaan Kas (A)',
			`Rp ${formatRupiah(tunaiMasukTotal)}`,
			`Rp ${formatRupiah(qrisMasukTotal)}`,
			`Rp ${formatRupiah(tunaiMasukTotal + qrisMasukTotal)}`
		],
		[
			'Total Pengeluaran Kas (B)',
			`Rp ${formatRupiah(tunaiKeluarTotal)}`,
			`Rp ${formatRupiah(qrisKeluarTotal)}`,
			`Rp ${formatRupiah(tunaiKeluarTotal + qrisKeluarTotal)}`
		],
		[
			'Laba (Rugi) Kotor (A - B)',
			`Rp ${formatRupiah(tunaiMasukTotal - tunaiKeluarTotal)}`,
			`Rp ${formatRupiah(qrisMasukTotal - qrisKeluarTotal)}`,
			`Rp ${formatRupiah(labaKotor)}`
		],
		[
			summary?.taxLabel ? `Pajak Penghasilan (${summary.taxLabel})` : 'Pajak Penghasilan (0,5%)',
			'-',
			'-',
			`Rp ${formatRupiah(pajak)}`
		]
	];

	if (summary?.taxBreakdown && summary.taxBreakdown.length > 1) {
		summary.taxBreakdown.forEach((tb) => {
			summaryRows.push([
				`  • ${tb.nama} (${tb.persentase}%)`,
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
		theme: 'plain',
		head: [
			[
				'Kategori Akuntansi & Arus Kas',
				'Kas Tunai (Rp)',
				'Non-Tunai / QRIS (Rp)',
				'Total Nominal (Rp)'
			]
		],
		body: summaryRows as any,
		headStyles: baseHeadStyles,
		bodyStyles: {
			...baseBodyStyles,
			cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 }
		},
		columnStyles: {
			0: { cellWidth: 'auto' },
			1: { cellWidth: 34, halign: 'right' },
			2: { cellWidth: 34, halign: 'right' },
			3: { cellWidth: 36, halign: 'right', fontStyle: 'bold' }
		},
		didParseCell: (data) => {
			const label = getRowFirstCellText(data);
			if (label.startsWith('Total Penerimaan') || label.startsWith('Laba (Rugi) Kotor')) {
				data.cell.styles.fontStyle = 'bold';
				if (label.startsWith('Laba (Rugi) Kotor') && labaKotor < 0) {
					data.cell.styles.textColor = colNegative;
				}
			}
			if (label.startsWith('SALDO AKHIR KAS')) {
				data.cell.styles.fontStyle = 'bold';
				data.cell.styles.lineWidth = { top: 0.3, bottom: 0.6 };
				data.cell.styles.lineColor = [31, 41, 55];
				if (labaBersih < 0) {
					data.cell.styles.textColor = colNegative;
				}
			}
		},
		margin: { left: 14, right: 14 }
	});

	y = getAutoTableFinalY(doc, y) + 7;

	// ─── 6. TABEL IV: LOG TRANSAKSI BUKU KAS DETAIL ─────────────────────────────
	if (transactions.length > 0) {
		if (y > 200) {
			doc.addPage();
			y = 16;
		}

		y = renderSectionHeader(
			`4. MUTASI BUKU KAS DETAIL (${transactions.length} Transaksi)`,
			'Catatan kronologis seluruh penerimaan dan pengeluaran kas yang tercatat',
			y
		);

		const transactionRows = transactions.map((t) => {
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

			return [formattedDate, tipeText, kategoriText, deskripsi, metode, nominal];
		});

		autoTable(doc, {
			startY: y,
			theme: 'plain',
			head: [
				['Tanggal/Waktu', 'Tipe', 'Kategori', 'Deskripsi / Keterangan', 'Metode', 'Nominal (Rp)']
			],
			body: transactionRows,
			headStyles: baseHeadStyles,
			bodyStyles: {
				...baseBodyStyles,
				fontSize: 7.2
			},
			columnStyles: {
				0: { cellWidth: 26 },
				1: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
				2: { cellWidth: 28 },
				3: { cellWidth: 'auto' },
				4: { cellWidth: 18, halign: 'center' },
				5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }
			},
			didParseCell: (data) => {
				if (data.column.index === 1 && data.section === 'body') {
					const val = String(data.cell.raw);
					if (val === 'KELUAR') {
						data.cell.styles.textColor = colNegative;
					}
				}
			},
			margin: { left: 14, right: 14 }
		});

		y = getAutoTableFinalY(doc, y) + 7;
	}

	// ─── 7. LEMBAR PENGESAHAN (OFFICIAL APPROVAL SIGNATURES) ─────────────────────
	let signY = y + 4;

	if (signY > 240) {
		doc.addPage();
		signY = 20;
	}

	const signColW = 75;

	// Kolom Kiri: Dibuat Oleh
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(...colMuted);
	doc.text('Dibuat & Dilaporkan Oleh,', 20, signY);
	doc.text('Kasir / Staf Operasional', 20, signY + 4);

	doc.setDrawColor(209, 213, 219);
	doc.setLineWidth(0.25);
	doc.line(20, signY + 22, 20 + signColW, signY + 22);

	doc.setFontSize(7);
	doc.text('( ................................................................ )', 20, signY + 26);

	// Kolom Kanan: Disetujui Oleh
	const rightSignX = 120;
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(...colMuted);
	doc.text('Mengetahui & Menyetujui,', rightSignX, signY);
	doc.text('Pemilik / Pimpinan Cabang', rightSignX, signY + 4);

	doc.setDrawColor(209, 213, 219);
	doc.setLineWidth(0.25);
	doc.line(rightSignX, signY + 22, rightSignX + signColW, signY + 22);

	doc.setFontSize(7);
	doc.text(
		'( ................................................................ )',
		rightSignX,
		signY + 26
	);

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
			doc.text(`Zatiaras Juice — Laporan Keuangan (${branchName.toUpperCase()})`, 14, 8);
			doc.text(`Periode: ${startDate} s/d ${endDate}`, 196, 8, { align: 'right' });

			doc.setDrawColor(229, 231, 235);
			doc.setLineWidth(0.2);
			doc.line(14, 10, 196, 10);
		}

		// Running Footer di Setiap Halaman
		doc.setDrawColor(229, 231, 235);
		doc.setLineWidth(0.2);
		doc.line(14, 287, 196, 287);

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(7);
		doc.setTextColor(...colMuted);
		doc.text(`ZatiarasPOS • Dokumen Keuangan Resmi • Dicetak: ${generatedTimestamp}`, 14, 291);
		doc.text(`Halaman ${i} dari ${totalPages}`, 196, 291, { align: 'right' });
	}

	// ─── 9. SIMPAN PDF ───────────────────────────────────────────────────────────
	const cleanBranch = branchName.replace(/[^a-zA-Z0-9]/g, '_');
	const fileName = `Laporan_Keuangan_Zatiaras_${cleanBranch}_${startDate}_sd_${endDate}.pdf`;
	doc.save(fileName);
}
