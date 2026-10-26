import {
	buildReceiptLayout,
	receiptHtmlShell,
	RECEIPT_FONT,
	type ReceiptData,
	type ReceiptLayout
} from './receiptLayout.js';
import { LOGO_BASE64 } from './logoBase64.js';
import type { PaperSize, PrintMode } from './printerConfig.js';
import { buildReceiptEscPos, buildReceiptTextEscPos, type ReceiptBitmap } from './escposBuilder.js';
import {
	buildReceiptTextBlocks,
	LOGO_SIZE,
	logoRasterWidth,
	paperDots,
	rasterizeReceiptText,
	receiptTextContent,
	ROM_CELL_HEIGHT,
	ROM_CELL_WIDTH,
	type RomGlyph
} from './receiptText.js';

export interface RenderedReceipt {
	/** Tata letak mode gambar; mode teks hanya mengisi ukuran (nodes kosong). */
	layout: ReceiptLayout;
	/** Apa yang akan dibakar kepala printer, titik demi titik (mode teks: perkiraan font printer). */
	bitmap: ReceiptBitmap;
	imageUrl: string;
	html: string;
	/** Byte ESC/POS yang dikirim ke printer. */
	escpos: Uint8Array;
	/** Isi struk sebagai teks, untuk pembaca layar. */
	lines: string[];
}

/** Ambang tinggi menjaga tepi huruf anti-alias tetap hitam supaya goresan tipis tidak putus di kertas. */
function toMonochrome(ctx: CanvasRenderingContext2D, width: number, height: number): Uint8Array {
	const pixels = ctx.getImageData(0, 0, width, height);
	const bytes = new Uint8Array((width / 8) * height);
	for (let i = 0; i < pixels.data.length; i += 4) {
		const dark =
			pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114 < 210;
		if (dark) bytes[(i / 4) >> 3] |= 0x80 >> ((i / 4) & 7);
	}
	return bytes;
}

function drawingContext(width: number, height: number): CanvasRenderingContext2D {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx)
		throw new Error('Browser tidak dapat merender struk. Gunakan Chrome atau Edge terbaru.');
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, width, height);
	return ctx;
}

async function loadLogo(): Promise<HTMLImageElement> {
	const logo = new Image();
	logo.src = LOGO_BASE64;
	try {
		await logo.decode();
	} catch {
		throw new Error('Logo struk gagal dimuat. Muat ulang aplikasi sebelum mencetak.');
	}
	return logo;
}

function bitmapImageUrl(bitmap: ReceiptBitmap): string {
	const ctx = drawingContext(bitmap.width, bitmap.height);
	const pixels = ctx.createImageData(bitmap.width, bitmap.height);
	for (let i = 0; i < bitmap.width * bitmap.height; i++) {
		const dark = bitmap.bytes[i >> 3] & (0x80 >> (i & 7));
		pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = dark ? 0 : 255;
		pixels.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(pixels, 0, 0);
	const imageUrl = ctx.canvas.toDataURL('image/png');
	if (!imageUrl.startsWith('data:image/png;base64,')) throw new Error('Gambar struk gagal dibuat.');
	return imageUrl;
}

const ROM_FONT = 'Consolas, "DejaVu Sans Mono", "Roboto Mono", "Courier New", monospace';
const glyphCache = new Map<number, Uint8Array>();

/**
 * Perkiraan font ROM printer (sel 12×24) dari font monospace browser. Bentuk huruf asli printer
 * sedikit berbeda; ukuran, posisi, dan jarak baris sama dengan yang dicetak.
 */
export const romGlyph: RomGlyph = (code, bold) => {
	const key = code * 2 + (bold ? 1 : 0);
	const cached = glyphCache.get(key);
	if (cached) return cached;
	const ctx = drawingContext(ROM_CELL_WIDTH, ROM_CELL_HEIGHT);
	ctx.fillStyle = 'black';
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'center';
	ctx.font = `${bold ? 'bold ' : ''}20px ${ROM_FONT}`;
	const character = String.fromCharCode(code);
	const width = ctx.measureText(character).width;
	if (width > ROM_CELL_WIDTH) {
		ctx.translate(ROM_CELL_WIDTH / 2, 0);
		ctx.scale(ROM_CELL_WIDTH / width, 1);
		ctx.fillText(character, 0, ROM_CELL_HEIGHT / 2 + 1);
	} else ctx.fillText(character, ROM_CELL_WIDTH / 2, ROM_CELL_HEIGHT / 2 + 1);
	const pixels = ctx.getImageData(0, 0, ROM_CELL_WIDTH, ROM_CELL_HEIGHT).data;
	const bits = new Uint8Array(ROM_CELL_HEIGHT * 2);
	for (let y = 0; y < ROM_CELL_HEIGHT; y++)
		for (let x = 0; x < ROM_CELL_WIDTH; x++)
			if (pixels[(y * ROM_CELL_WIDTH + x) * 4] < 140) bits[y * 2 + (x >> 3)] |= 0x80 >> (x & 7);
	// Huruf tebal printer mini dicetak dua kali bergeser satu titik ke kanan.
	if (bold)
		for (let y = 0; y < ROM_CELL_HEIGHT; y++) {
			const row = (bits[y * 2] << 8) | bits[y * 2 + 1];
			const thick = (row | (row >> 1)) & 0xfff0;
			bits[y * 2] = thick >> 8;
			bits[y * 2 + 1] = thick & 0xff;
		}
	glyphCache.set(key, bits);
	return bits;
};

async function renderImageReceipt(
	data: ReceiptData,
	paperSize: PaperSize
): Promise<RenderedReceipt> {
	const probe = drawingContext(1, 1);
	const layout = buildReceiptLayout(data, paperSize, (text, size, bold) => {
		probe.font = `${bold ? 'bold ' : ''}${size}px ${RECEIPT_FONT}`;
		return probe.measureText(text).width;
	});
	const ctx = drawingContext(layout.width, layout.height);
	const logo = await loadLogo();
	for (const node of layout.nodes) {
		if (node.type === 'logo') {
			ctx.drawImage(logo, node.x, node.y, node.size, node.size);
		} else if (node.type === 'divider') {
			ctx.strokeStyle = '#181818';
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo(node.x, node.y);
			ctx.lineTo(node.x + node.width, node.y);
			ctx.stroke();
		} else {
			ctx.fillStyle = '#181818';
			ctx.font = `${node.bold ? 'bold ' : ''}${node.size}px ${RECEIPT_FONT}`;
			ctx.textBaseline = 'top';
			ctx.textAlign = node.align;
			ctx.fillText(node.text, node.x, node.y);
		}
	}
	const bitmap = {
		width: layout.width,
		height: layout.height,
		bytes: toMonochrome(ctx, layout.width, layout.height)
	};
	return finish(
		bitmap,
		layout,
		buildReceiptEscPos(bitmap),
		layout.nodes.flatMap((node) => (node.type === 'text' ? [node.text] : []))
	);
}

async function renderTextReceipt(
	data: ReceiptData,
	paperSize: PaperSize
): Promise<RenderedReceipt> {
	const blocks = buildReceiptTextBlocks(data, paperSize);
	const width = logoRasterWidth(paperSize);
	const ctx = drawingContext(width, LOGO_SIZE);
	ctx.drawImage(await loadLogo(), width - LOGO_SIZE, 0, LOGO_SIZE, LOGO_SIZE);
	const logo = { width, height: LOGO_SIZE, bytes: toMonochrome(ctx, width, LOGO_SIZE) };
	const bitmap = rasterizeReceiptText(blocks, logo, paperSize, romGlyph);
	const layout: ReceiptLayout = {
		width: paperDots(paperSize),
		height: bitmap.height,
		paperSize,
		nodes: []
	};
	return finish(bitmap, layout, buildReceiptTextEscPos(blocks, logo), receiptTextContent(blocks));
}

function finish(
	bitmap: ReceiptBitmap,
	layout: ReceiptLayout,
	escpos: Uint8Array,
	lines: string[]
): RenderedReceipt {
	const imageUrl = bitmapImageUrl(bitmap);
	return {
		layout,
		bitmap,
		imageUrl,
		escpos,
		lines,
		html: receiptHtmlShell(
			`<img src="${imageUrl}" width="${bitmap.width}" height="${bitmap.height}" alt="Struk transaksi">`,
			layout
		)
	};
}

/** Pratinjau, acuan simulator, dan byte printer berasal dari satu render yang sama. */
export async function renderReceipt(
	data: ReceiptData,
	paperSize: PaperSize,
	printMode: PrintMode = 'image'
): Promise<RenderedReceipt> {
	return printMode === 'text'
		? renderTextReceipt(data, paperSize)
		: renderImageReceipt(data, paperSize);
}
