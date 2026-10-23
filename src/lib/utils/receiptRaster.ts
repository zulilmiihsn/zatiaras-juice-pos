import {
	buildReceiptLayout,
	receiptHtmlShell,
	RECEIPT_FONT,
	type ReceiptData,
	type ReceiptLayout
} from './receiptLayout.js';
import { LOGO_BASE64 } from './logoBase64.js';
import type { PaperSize } from './printerConfig.js';
import type { ReceiptBitmap } from './escposBuilder.js';

export interface RenderedReceipt {
	layout: ReceiptLayout;
	bitmap: ReceiptBitmap;
	imageUrl: string;
	html: string;
}

/** A single monochrome image is sent to every method, avoiding printer fonts and code pages. */
export async function renderReceipt(
	data: ReceiptData,
	paperSize: PaperSize
): Promise<RenderedReceipt> {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx)
		throw new Error('Browser tidak dapat merender struk. Gunakan Chrome atau Edge terbaru.');
	const layout = buildReceiptLayout(data, paperSize, (text, size, bold) => {
		ctx.font = `${bold ? 'bold ' : ''}${size}px ${RECEIPT_FONT}`;
		return ctx.measureText(text).width;
	});
	canvas.width = layout.width;
	canvas.height = layout.height;
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	const logo = new Image();
	logo.src = LOGO_BASE64;
	try {
		await logo.decode();
	} catch {
		throw new Error('Logo struk gagal dimuat. Muat ulang aplikasi sebelum mencetak.');
	}
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
	const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const bytesPerRow = canvas.width / 8;
	const bytes = new Uint8Array(bytesPerRow * canvas.height);
	for (let i = 0; i < pixels.data.length; i += 4) {
		const dark =
			pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114 < 180;
		if (dark) bytes[(i / 4) >> 3] |= 0x80 >> ((i / 4) & 7);
		pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = dark ? 0 : 255;
		pixels.data[i + 3] = 255;
	}
	ctx.putImageData(pixels, 0, 0);
	const imageUrl = canvas.toDataURL('image/png');
	if (!imageUrl.startsWith('data:image/png;base64,')) throw new Error('Gambar struk gagal dibuat.');
	return {
		layout,
		bitmap: { width: canvas.width, height: canvas.height, bytes },
		imageUrl,
		html: receiptHtmlShell(
			`<img src="${imageUrl}" width="${canvas.width}" height="${canvas.height}" alt="Struk transaksi">`,
			layout
		)
	};
}
