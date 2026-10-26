import assert from 'node:assert/strict';
import { buildReceiptEscPos, buildReceiptTextEscPos } from '../lib/utils/escposBuilder.js';
import { VirtualMtp2, verifyJob, DOTS_PER_MM, patternGlyph } from '../lib/dev/printerSim/mtp2.js';
import {
	buildReceiptTextBlocks,
	LOGO_SIZE,
	logoRasterWidth,
	rasterizeReceiptText
} from '../lib/utils/receiptText.js';
import { buildSampleReceipt, DEFAULT_RECEIPT_SETTINGS } from '../lib/utils/receiptPrint.js';

function bitmap(width: number, height: number) {
	const bytes = new Uint8Array((width / 8) * height);
	for (let r = 0; r < height; r++) {
		// Ink rows with a 40-row blank gap in the middle, so the builder emits ESC J feeds too.
		if (r >= 100 && r < 140) continue;
		for (let i = 0; i < width / 8; i++) bytes[r * (width / 8) + i] = (r * 31 + i * 7) & 0xff;
	}
	return { width, height, bytes };
}

/** Runs the printer on a virtual clock until it has drained everything. */
function run(printer: VirtualMtp2, clock: { t: number }, ms: number) {
	for (let elapsed = 0; elapsed < ms; elapsed += 16) {
		clock.t += 16;
		printer.tick(16, clock.t);
	}
}

async function feedBlocking(printer: VirtualMtp2, bytes: Uint8Array, clock: { t: number }) {
	const pending = printer.receiveBlocking(bytes, () => clock.t);
	let done = false;
	void pending.then(() => (done = true));
	while (!done) {
		await Promise.resolve();
		clock.t += 16;
		printer.tick(16, clock.t);
	}
	run(printer, clock, 5000);
}

// Flow-controlled link: every burned dot equals the app's bitmap, no matter how small the buffer.
{
	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 1024 });
	const image = bitmap(384, 300);
	await feedBlocking(printer, buildReceiptEscPos(image), clock);
	const job = printer.jobs[0];
	const verdict = verifyJob(printer, job, image);
	assert.equal(verdict.mismatchedRows, 0);
	assert.equal(job.bytesDropped, 0);
	assert.equal(job.commands.get('GS V'), 1, 'cut is parsed and ignored');
	assert.ok(job.commands.get('ESC J'), 'blank gap is fed');
	assert.equal(job.finishedAt !== null, true);
	// Trailing 3 LF at 30 dots each after the image.
	assert.equal(printer.rows.length - job.firstRow, 300 + 90);
	// 90 fed dots = 11.25 mm clears a 10 mm tear bar.
	assert.equal(verdict.contentBelowTearRows, 0);
}

// Print time follows paper speed: 390 rows at 60 mm/s is ~0.8 s or more, never instant.
{
	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 64 * 1024 });
	printer.receiveDropping(buildReceiptEscPos(bitmap(384, 300)), 0);
	run(printer, clock, 500);
	assert.ok(printer.rows.length < 300, 'half a second cannot print the whole receipt');
	run(printer, clock, 5000);
	assert.equal(printer.rows.length, 390);
}

// Link without flow control: bytes beyond the buffer are lost and the paper shows it.
{
	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 2048 });
	const image = bitmap(384, 300);
	printer.receiveDropping(buildReceiptEscPos(image), 0);
	run(printer, clock, 5000);
	const job = printer.jobs[0];
	assert.ok(job.bytesDropped > 0);
	assert.ok(verifyJob(printer, job, image).mismatchedRows > 0);
	assert.ok(job.events.some((e) => e.kind === 'error' && e.message.startsWith('Buffer penuh')));
}

// An 80 mm raster is wider than the 384-dot head and is reported.
{
	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 64 * 1024 });
	printer.receiveDropping(buildReceiptEscPos(bitmap(576, 50)), 0);
	run(printer, clock, 3000);
	assert.ok(
		printer.jobs[0].events.some((e) => e.kind === 'error' && e.message.includes('576 dot'))
	);
}

// Paper runs out mid-receipt: printing stops and resumes after reloading.
{
	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 64 * 1024, paperMm: 10 });
	printer.receiveDropping(buildReceiptEscPos(bitmap(384, 300)), 0);
	run(printer, clock, 3000);
	assert.equal(printer.status, 'paper-out');
	assert.equal(printer.rows.length, 10 * DOTS_PER_MM);
	printer.reconfigure({ paperMm: 1000 });
	run(printer, clock, 5000);
	assert.equal(printer.rows.length, 390);
}

// A data gap while an image band is half received stops the motor and marks the restart.
{
	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 64 * 1024 });
	const bytes = buildReceiptEscPos(bitmap(384, 300));
	printer.receiveDropping(bytes.subarray(0, 3000), 0);
	run(printer, clock, 1000);
	assert.equal(printer.status, 'starved');
	printer.receiveDropping(bytes.subarray(3000), clock.t);
	run(printer, clock, 5000);
	assert.ok(printer.jobs[0].stalls >= 1);
	assert.ok(printer.rows.some((row) => row.restart));
}

// Tearing removes only what is above the tear bar.
{
	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 64 * 1024 });
	printer.receiveDropping(buildReceiptEscPos(bitmap(384, 300)), 0);
	run(printer, clock, 5000);
	const piece = printer.tear();
	assert.equal(piece.length, 390 - 10 * DOTS_PER_MM);
}

// Printer-font receipt: the virtual MTP-II parses the text commands and burns exactly the preview.
{
	const data = buildSampleReceipt(
		{
			...DEFAULT_RECEIPT_SETTINGS,
			alamat: 'Jl. Pahlawan No. 12, Samarinda',
			instagram: '@zatiarasjuice',
			ucapan: 'Terima kasih, sampai jumpa lagi!'
		},
		new Date('2026-10-25T02:30:00.000Z')
	);
	const blocks = buildReceiptTextBlocks(data, '58mm');
	const width = logoRasterWidth('58mm');
	const logo = { width, height: LOGO_SIZE, bytes: new Uint8Array((width / 8) * LOGO_SIZE) };
	for (let r = 0; r < LOGO_SIZE; r++)
		logo.bytes.fill(0xff, r * (width / 8) + 18, (r + 1) * (width / 8));
	const expected = rasterizeReceiptText(blocks, logo, '58mm', patternGlyph);
	const bytes = buildReceiptTextEscPos(blocks, logo);
	assert.ok(
		bytes.length < buildReceiptEscPos(expected).length / 4,
		'text mode sends far fewer bytes'
	);

	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 1024 });
	await feedBlocking(printer, bytes, clock);
	const job = printer.jobs[0];
	const verdict = verifyJob(printer, job, expected);
	assert.equal(verdict.mismatchedRows, 0, `first mismatch at row ${verdict.firstMismatch}`);
	assert.ok(!job.events.some((e) => e.kind === 'error'), 'no unknown byte or overflow');
	assert.ok(job.commands.get('teks')! > 10);
	assert.ok(job.commands.get('GS !'), 'store name and total are enlarged');
	assert.ok(job.commands.get('ESC E'), 'bold lines are sent as bold');
}

// A line wider than the head is reported instead of silently wrapping.
{
	const clock = { t: 0 };
	const printer = new VirtualMtp2({ bufferBytes: 4096 });
	const wide = new TextEncoder().encode('\x1b@' + 'X'.repeat(40) + '\n');
	printer.receiveDropping(wide, 0);
	run(printer, clock, 3000);
	assert.ok(
		printer.jobs[0].events.some((e) => e.kind === 'error' && e.message.includes('480 dot'))
	);
}

console.log('printer-sim tests passed');
