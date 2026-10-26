<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		buildSampleReceipt,
		DEFAULT_RECEIPT_SETTINGS,
		loadReceiptSettings
	} from '$lib/utils/receiptPrint';
	import { renderReceipt, romGlyph } from '$lib/utils/receiptRaster';
	import type { ReceiptData } from '$lib/utils/receiptLayout';
	import {
		disconnectBluetooth,
		testPrintUnified,
		type PaperSize,
		type PrinterMethod,
		type PrintMode,
		type AndroidPrinterApp
	} from '$lib/services/printerEngine';
	import {
		BYTES_PER_LINE,
		DOTS_PER_MM,
		MTP2_ASSUMPTIONS,
		VirtualMtp2,
		verifyJob,
		type JobVerdict,
		type Mtp2Job
	} from '$lib/dev/printerSim/mtp2';
	import {
		DEFAULT_LINK_SETTINGS,
		installPrinterSim,
		type LinkEvent,
		type LinkSettings,
		type LinkStats
	} from '$lib/dev/printerSim/transports';

	const PAPER_DOTS = 58 * DOTS_PER_MM;
	const MARGIN_DOTS = 5 * DOTS_PER_MM;
	const PAPER_RGB = [247, 245, 238];
	const INK_RGB = [26, 26, 36];

	const printer = new VirtualMtp2();
	// The app preview draws printer-font text with the same glyphs, so the dot check stays exact.
	printer.glyph = romGlyph;
	const settings: LinkSettings = $state(structuredClone(DEFAULT_LINK_SETTINGS));

	let method: PrinterMethod = $state('bluetooth');
	let androidApp: AndroidPrinterApp = $state('rawbt');
	let paperSize: PaperSize = $state('58mm');
	let printMode: PrintMode = $state('text');
	let disconnectKb: number | null = $state(null);
	let version = $state(0);
	let events: LinkEvent[] = $state([]);
	let stats: LinkStats | null = $state(null);
	let busy = $state(false);
	let appResult: { ok: boolean; message: string } | null = $state(null);
	let verdict: JobVerdict | null = $state(null);
	let runJobs: Mtp2Job[] = $state([]);
	let zoom = $state(1.5);
	let showDiff = $state(true);
	let torn: string[] = $state([]);
	let chooser: {
		kind: 'bluetooth' | 'usb';
		names: string[];
		resolve: (i: number | null) => void;
	} | null = $state(null);

	let paperCanvas: HTMLCanvasElement | undefined = $state();
	let paperScroll: HTMLDivElement | undefined = $state();
	let offscreen: HTMLCanvasElement | null = null;
	let offscreenBase = 0;
	let drawnRows = 0;
	let reference: { width: number; height: number; bytes: Uint8Array } | null = $state.raw(null);
	let runStart = 0;
	let jobsBefore = 0;
	let frame = 0;
	let uninstall: (() => void) | null = null;
	let savedConfig: string | null = null;

	const t0 = performance.now();
	const fmtTime = (at: number) => `${((at - t0) / 1000).toFixed(2)}s`;

	function log(event: Omit<LinkEvent, 'at'>) {
		events = [...events.slice(-300), { ...event, at: performance.now() }];
	}

	function hash(x: number, y: number) {
		let h = (x * 374761393 + y * 668265263) | 0;
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
	}

	/** Paints burned rows onto the paper texture; nothing is copied from the app's own image. */
	function paintRows(upTo: number) {
		if (!offscreen) {
			offscreen = document.createElement('canvas');
			offscreen.width = PAPER_DOTS;
			offscreen.height = 2048;
		}
		const needed = upTo - offscreenBase;
		if (needed > offscreen.height) {
			const grown = document.createElement('canvas');
			grown.width = PAPER_DOTS;
			grown.height = Math.max(needed, offscreen.height * 2);
			grown.getContext('2d')!.drawImage(offscreen, 0, 0);
			offscreen = grown;
		}
		const ctx = offscreen.getContext('2d')!;
		for (let r = drawnRows; r < upTo; r++) {
			const row = printer.rows[r];
			const image = ctx.createImageData(PAPER_DOTS, 1);
			for (let x = 0; x < PAPER_DOTS; x++) {
				const grain = 0.985 + hash(x, r) * 0.015;
				let ink = 0;
				const dot = x - MARGIN_DOTS;
				if (
					row.bits &&
					dot >= 0 &&
					dot < BYTES_PER_LINE * 8 &&
					row.bits[dot >> 3] & (0x80 >> (dot & 7))
				)
					ink = row.darkness * (0.82 + hash(r, x) * 0.18);
				// Motor restart: a faint grey band across the printable width.
				if (row.restart && dot >= 0 && dot < BYTES_PER_LINE * 8) ink = Math.max(ink, 0.1);
				const i = x * 4;
				for (let c = 0; c < 3; c++)
					image.data[i + c] = (PAPER_RGB[c] - (PAPER_RGB[c] - INK_RGB[c]) * ink) * grain;
				image.data[i + 3] = 255;
			}
			ctx.putImageData(image, 0, r - offscreenBase);
		}
		drawnRows = Math.max(drawnRows, upTo);
	}

	function render() {
		if (!paperCanvas) return;
		paintRows(printer.rows.length);
		const from = printer.tornAt;
		const to = printer.visibleRowEnd;
		const height = Math.max(1, to - from);
		if (paperCanvas.height !== height) {
			// Follow the paper as it comes out unless the viewer scrolled up to read it.
			const pinned =
				!paperScroll ||
				paperScroll.scrollHeight - paperScroll.scrollTop - paperScroll.clientHeight < 40;
			paperCanvas.height = height;
			if (pinned && paperScroll)
				queueMicrotask(() => paperScroll!.scrollTo({ top: paperScroll!.scrollHeight }));
		}
		paperCanvas.width = PAPER_DOTS;
		const ctx = paperCanvas.getContext('2d')!;
		ctx.fillStyle = `rgb(${PAPER_RGB.join(',')})`;
		ctx.fillRect(0, 0, PAPER_DOTS, height);
		if (offscreen && to > from)
			ctx.drawImage(
				offscreen,
				0,
				from - offscreenBase,
				PAPER_DOTS,
				to - from,
				0,
				0,
				PAPER_DOTS,
				to - from
			);
		const job = runJobs[0];
		if (showDiff && verdict && job) {
			ctx.fillStyle = 'rgba(220,38,38,0.35)';
			for (const r of verdict.mismatchRows) {
				const y = job.firstRow + r - from;
				if (y >= 0 && y < height) ctx.fillRect(MARGIN_DOTS, y, BYTES_PER_LINE * 8, 1);
			}
		}
	}

	function loop(last: number) {
		frame = requestAnimationFrame((now) => {
			printer.tick(Math.min(100, now - last), now);
			checkRun();
			version++;
			render();
			loop(now);
		});
	}

	function checkRun() {
		if (!busy && runStart === 0) return;
		runJobs = printer.jobs.slice(jobsBefore);
		const job = runJobs[0];
		if (!busy && job?.finishedAt !== null && job && reference && !verdict)
			verdict = verifyJob(printer, job, reference);
	}

	async function receiptData(): Promise<ReceiptData> {
		const stored = await loadReceiptSettings();
		return buildSampleReceipt(stored ?? DEFAULT_RECEIPT_SETTINGS);
	}

	let data: ReceiptData | null = $state.raw(null);

	async function print() {
		if (busy || !data) return;
		busy = true;
		appResult = null;
		verdict = null;
		runStart = performance.now();
		jobsBefore = printer.jobs.length;
		runJobs = [];
		stats = null;
		log({
			channel: 'App',
			level: 'info',
			message: `Cetak via ${method}${method === 'intent' ? ` (${androidApp})` : ''}, kertas ${paperSize}`
		});
		// The click's user activation must reach requestDevice untouched, so the app call goes first.
		const job = testPrintUnified(method, paperSize, data, androidApp, printMode);
		// The print-intent helper always prints the picture, exactly as executePrint decides.
		const htmlOnly = method === 'intent' && androidApp !== 'rawbt';
		reference = (await renderReceipt(data, paperSize, htmlOnly ? 'image' : printMode)).bitmap;
		try {
			await job;
			appResult = { ok: true, message: 'App melaporkan cetak terkirim tanpa error.' };
		} catch (error) {
			appResult = { ok: false, message: error instanceof Error ? error.message : String(error) };
			log({ channel: 'App', level: 'error', message: appResult.message });
		} finally {
			busy = false;
		}
	}

	function choose(kind: 'bluetooth' | 'usb', names: string[]) {
		return new Promise<number | null>((resolve) => (chooser = { kind, names, resolve }));
	}

	function pick(index: number | null) {
		chooser?.resolve(index);
		chooser = null;
	}

	function tear() {
		const piece = printer.tear();
		if (piece.length === 0 || !offscreen) return;
		const canvas = document.createElement('canvas');
		canvas.width = PAPER_DOTS;
		canvas.height = piece.length;
		const start = printer.tornAt - piece.length;
		canvas
			.getContext('2d')!
			.drawImage(
				offscreen,
				0,
				start - offscreenBase,
				PAPER_DOTS,
				piece.length,
				0,
				0,
				PAPER_DOTS,
				piece.length
			);
		torn = [canvas.toDataURL('image/png'), ...torn].slice(0, 6);
		// Drop torn rows from the texture so long sessions stay small.
		const kept = document.createElement('canvas');
		kept.width = PAPER_DOTS;
		kept.height = Math.max(2048, drawnRows - printer.tornAt);
		kept
			.getContext('2d')!
			.drawImage(
				offscreen,
				0,
				printer.tornAt - offscreenBase,
				PAPER_DOTS,
				drawnRows - printer.tornAt,
				0,
				0,
				PAPER_DOTS,
				drawnRows - printer.tornAt
			);
		offscreen = kept;
		offscreenBase = printer.tornAt;
	}

	function resetLink() {
		disconnectBluetooth();
	}

	$effect(() => {
		settings.faults.bleDisconnectAfterBytes =
			disconnectKb === null || Number.isNaN(disconnectKb) ? null : disconnectKb * 1024;
	});

	onMount(async () => {
		try {
			savedConfig = localStorage.getItem('pos_printer_config');
		} catch {
			savedConfig = null;
		}
		uninstall = installPrinterSim({
			printer,
			settings,
			choose,
			log,
			stats: (s) => (stats = { ...s })
		});
		data = await receiptData();
		loop(performance.now());
	});

	onDestroy(() => {
		cancelAnimationFrame(frame);
		disconnectBluetooth();
		uninstall?.();
		chooser?.resolve(null);
		// Pairing inside the simulator must not change the real printer choice.
		try {
			if (savedConfig === null) localStorage.removeItem('pos_printer_config');
			else localStorage.setItem('pos_printer_config', savedConfig);
		} catch {
			// Penyimpanan diblokir: tidak ada yang perlu dipulihkan.
		}
	});

	const live = $derived.by(() => {
		void version;
		const job = runJobs[0];
		const transferMs = stats?.endedAt ? stats.endedAt - stats.startedAt : null;
		const printMs = job?.lastRowAt ? job.lastRowAt - job.startedAt : null;
		return {
			status: printer.status,
			battery: printer.config.batteryPct,
			paperM: printer.config.paperMm / 1000,
			buffer: printer.bufferUsed,
			bufferSize: printer.config.bufferBytes,
			temp: printer.headTempC,
			job,
			transferMs,
			printMs,
			hiddenRows: printer.rows.length - printer.visibleRowEnd,
			visibleRows: printer.visibleRowEnd - printer.tornAt
		};
	});

	type Check = { level: 'ok' | 'warn' | 'fail' | 'wait'; text: string };
	const checks = $derived.by((): Check[] => {
		void version;
		const out: Check[] = [];
		if (appResult)
			out.push({ level: appResult.ok ? 'ok' : 'fail', text: `App: ${appResult.message}` });
		const job = runJobs[0];
		if (!job) {
			// Intent and server hand off and return at once; the helper starts sending later.
			const handingOff = appResult?.ok && performance.now() - runStart < 10_000;
			if (busy || handingOff) out.push({ level: 'wait', text: 'Menunggu data sampai di printer…' });
			else if (appResult)
				out.push({
					level: appResult.ok ? 'fail' : 'warn',
					text: 'Printer tidak menerima satu byte pun.'
				});
			return out;
		}
		if (runJobs.length > 1)
			out.push({
				level: 'fail',
				text: `Printer menerima ${runJobs.length} pekerjaan dari satu klik (cetak dobel).`
			});
		if (stats?.channel === 'BLE')
			out.push(
				stats.largestWrite <= 20 && stats.violations === 0
					? {
							level: 'ok',
							text: `BLE: ${stats.writes} tulis, terbesar ${stats.largestWrite} byte (≤ 20).`
						}
					: { level: 'fail', text: `BLE: ${stats.violations} tulis melebihi 20 byte.` }
			);
		const unknown = job.commands.get('tidak dikenal') ?? 0;
		const text = job.commands.get('teks') ?? 0;
		out.push(
			unknown || text
				? { level: 'fail', text: `${unknown} byte tak dikenal, ${text} byte teks mentah.` }
				: { level: 'ok', text: 'Semua byte adalah perintah ESC/POS yang dikenal MTP-II.' }
		);
		if (job.commands.get('GS V'))
			out.push({
				level: 'warn',
				text: 'GS V (potong) diabaikan: MTP-II tanpa pemotong, kertas disobek.'
			});
		for (const e of job.events.filter((e) => e.kind !== 'command').slice(0, 6))
			out.push({ level: e.kind === 'error' ? 'fail' : 'warn', text: e.message });
		out.push(
			job.bytesDropped
				? { level: 'fail', text: `${job.bytesDropped} byte hilang karena buffer penuh.` }
				: { level: 'ok', text: `Tidak ada byte hilang (${job.bytesReceived} byte diterima).` }
		);
		if (job.stalls)
			out.push({
				level: 'warn',
				text: `Motor berhenti-jalan ${job.stalls}× karena data telat; terlihat sebagai garis samar.`
			});
		if (!verdict) {
			out.push({
				level: 'wait',
				text: job.finishedAt === null ? 'Printer masih bekerja…' : 'Menghitung…'
			});
			return out;
		}
		out.push(
			verdict.mismatchedRows === 0
				? {
						level: 'ok',
						text: `Hasil kertas sama titik demi titik dengan gambar app (${verdict.matchedRows} baris).`
					}
				: {
						level: 'fail',
						text: `${verdict.mismatchedRows} baris berbeda dari gambar app, mulai baris ${verdict.firstMismatch} (${((verdict.firstMismatch ?? 0) / DOTS_PER_MM).toFixed(1)} mm).`
					}
		);
		if (verdict.fadedRows)
			out.push({ level: 'warn', text: `${verdict.fadedRows} baris pudar (baterai/panas).` });
		out.push(
			verdict.contentBelowTearRows
				? {
						level: 'fail',
						text: `Baris terakhir masih ${(verdict.contentBelowTearRows / DOTS_PER_MM).toFixed(1)} mm di bawah gigi sobek: ikut terpotong.`
					}
				: { level: 'ok', text: 'Isi struk sudah melewati gigi sobek saat selesai.' }
		);
		return out;
	});

	const ledClass = $derived(
		live.status === 'off'
			? 'bg-zinc-600'
			: live.status === 'paper-out' || live.status === 'overheat'
				? 'animate-pulse bg-orange-500'
				: live.status === 'printing' || live.status === 'starved'
					? 'bg-sky-400'
					: 'bg-emerald-400'
	);

	const STATUS_LABEL: Record<string, string> = {
		idle: 'Siap',
		printing: 'Mencetak',
		starved: 'Menunggu data',
		'paper-out': 'Kertas habis',
		overheat: 'Kepala panas',
		off: 'Mati'
	};

	const LEVEL_ICON = { ok: '✔', warn: '⚠', fail: '✖', wait: '…' };
</script>

<svelte:head><title>Simulator MTP-II</title></svelte:head>

<div class="min-h-dvh bg-zinc-100 p-4 text-sm text-zinc-800">
	<h1 class="mb-1 text-lg font-bold">Simulator printer MTP-II</h1>
	<p class="mb-4 max-w-3xl text-xs text-zinc-500">
		Kode cetak asli app (testPrintUnified → renderReceipt → ESC/POS gambar atau teks → jalur kirim)
		berjalan apa adanya. Yang disimulasikan hanya perangkat keras: Bluetooth, USB, server lokal,
		aplikasi Android, dan printernya. Halaman ini hanya ada di mode dev.
	</p>

	<div class="grid gap-4 lg:grid-cols-[260px_1fr_340px]">
		<!-- Kontrol -->
		<section class="space-y-3 rounded-xl bg-white p-3 shadow-sm">
			<div>
				<div class="mb-1 text-xs font-semibold text-zinc-500 uppercase">Metode app</div>
				{#each [['bluetooth', 'Bluetooth (Web Bluetooth/BLE)'], ['usb', 'USB (WebUSB)'], ['intent', 'Aplikasi Android'], ['server', 'Server Lokal (PC)']] as [value, label] (value)}
					<label class="flex items-center gap-2 py-0.5">
						<input type="radio" bind:group={method} {value} onchange={resetLink} disabled={busy} />
						{label}
					</label>
				{/each}
				{#if method === 'intent'}
					<select class="mt-1 w-full rounded border p-1" bind:value={androidApp} disabled={busy}>
						<option value="rawbt">RawBT</option>
						<option value="print-intent">print-intent</option>
					</select>
				{/if}
			</div>
			<label class="block">
				Perangkat kasir
				<select class="w-full rounded border p-1" bind:value={settings.device} disabled={busy}>
					<option value="android">HP Android (Chrome)</option>
					<option value="pc">PC (Chrome)</option>
				</select>
			</label>
			<label class="block">
				Ukuran kertas di Pengaturan app
				<select class="w-full rounded border p-1" bind:value={paperSize} disabled={busy}>
					<option value="58mm">58 mm</option>
					<option value="80mm">80 mm (salah untuk MTP-II)</option>
				</select>
			</label>
			<label class="block">
				Mode cetak di Pengaturan app
				<select class="w-full rounded border p-1" bind:value={printMode} disabled={busy}>
					<option value="image">Gambar penuh</option>
					<option value="text">Teks printer + logo</option>
				</select>
			</label>
			<label class="block">
				Profil Bluetooth MTP-II
				<select
					class="w-full rounded border p-1"
					bind:value={settings.bleProfile}
					onchange={resetLink}
					disabled={busy}
				>
					<option value="ae00">BLE, service 0xAE00</option>
					<option value="unknown-uuid">BLE, service 0xFF00 (tak dikenal app)</option>
					<option value="spp-only">Bluetooth klasik saja (SPP)</option>
				</select>
			</label>

			<div class="border-t pt-2">
				<div class="mb-1 text-xs font-semibold text-zinc-500 uppercase">Kondisi printer</div>
				<label class="block"
					>Baterai {live.battery.toFixed(0)}%
					<input
						type="range"
						min="0"
						max="100"
						class="w-full"
						value={live.battery}
						oninput={(e) => printer.reconfigure({ batteryPct: Number(e.currentTarget.value) })}
					/>
				</label>
				<label class="block"
					>Sisa kertas (cm)
					<input
						type="number"
						min="0"
						class="w-full rounded border p-1"
						value={Math.round(live.paperM * 100)}
						onchange={(e) => printer.reconfigure({ paperMm: Number(e.currentTarget.value) * 10 })}
					/>
				</label>
				<label class="block"
					>Kecepatan {printer.config.speedMmS} mm/s
					<input
						type="range"
						min="50"
						max="80"
						class="w-full"
						value={printer.config.speedMmS}
						oninput={(e) => printer.reconfigure({ speedMmS: Number(e.currentTarget.value) })}
					/>
				</label>
				<label class="block"
					>Buffer masukan (KB, asumsi)
					<input
						type="number"
						min="1"
						max="64"
						class="w-full rounded border p-1"
						value={printer.config.bufferBytes / 1024}
						onchange={(e) =>
							printer.reconfigure({
								bufferBytes: Math.max(1, Number(e.currentTarget.value)) * 1024
							})}
					/>
				</label>
			</div>

			<div class="border-t pt-2">
				<div class="mb-1 text-xs font-semibold text-zinc-500 uppercase">Jalur (asumsi)</div>
				<label class="block"
					>Interval koneksi BLE (ms)
					<input
						type="number"
						min="7.5"
						max="100"
						step="2.5"
						class="w-full rounded border p-1"
						bind:value={settings.bleIntervalMs}
					/>
				</label>
				<label class="block"
					>Paket BLE per interval
					<input
						type="number"
						min="1"
						max="6"
						class="w-full rounded border p-1"
						bind:value={settings.blePacketsPerEvent}
					/>
				</label>
				<label class="block"
					>Kecepatan SPP (byte/detik)
					<input
						type="number"
						min="1000"
						step="1000"
						class="w-full rounded border p-1"
						bind:value={settings.sppBytesPerSecond}
					/>
				</label>
			</div>

			<div class="border-t pt-2">
				<div class="mb-1 text-xs font-semibold text-zinc-500 uppercase">Gangguan</div>
				<label class="block"
					>BLE putus setelah (KB, kosong = tidak)
					<input
						type="number"
						min="0"
						class="w-full rounded border p-1"
						bind:value={disconnectKb}
					/>
				</label>
				<label class="flex gap-2"
					><input type="checkbox" bind:checked={settings.faults.usbDriverLocked} /> Driver Windows menguasai
					USB</label
				>
				<label class="flex gap-2"
					><input type="checkbox" bind:checked={settings.faults.serverDown} /> RawBT Print Server mati</label
				>
				<label class="flex gap-2"
					><input type="checkbox" bind:checked={settings.faults.rawBtMissing} /> Aplikasi helper belum
					terpasang</label
				>
			</div>

			<button
				class="w-full rounded-lg bg-pink-600 py-2 font-bold text-white disabled:opacity-50"
				onclick={print}
				disabled={busy || !data}
			>
				{busy ? 'Mengirim…' : 'Cetak struk contoh'}
			</button>
			<p class="text-xs text-zinc-500">
				Data: struk contoh dengan header toko dari Pengaturan (sama dengan tombol Tes Cetak).
			</p>
		</section>

		<!-- Printer -->
		<section class="flex flex-col items-center rounded-xl bg-white p-3 shadow-sm">
			<div class="mb-2 flex w-full items-center justify-between text-xs">
				<label class="flex items-center gap-2"
					>Zoom
					<input type="range" min="0.5" max="3" step="0.25" bind:value={zoom} />
					{zoom}×
				</label>
				<label class="flex items-center gap-1"
					><input type="checkbox" bind:checked={showDiff} /> Tandai beda</label
				>
				<button class="rounded border px-2 py-1" onclick={tear} disabled={live.visibleRows === 0}
					>Sobek kertas</button
				>
			</div>
			<div
				bind:this={paperScroll}
				class="flex max-h-[65vh] w-full flex-col items-center overflow-auto pt-4"
			>
				<!-- Spacer keeps the paper on the printer without hiding its top when it overflows. -->
				<div class="flex-1"></div>
				<canvas
					bind:this={paperCanvas}
					class="block shadow-[0_0_6px_rgba(0,0,0,0.15)]"
					style="width: calc(58mm * {zoom}); height: calc({live.visibleRows /
						DOTS_PER_MM}mm * {zoom}); image-rendering: pixelated"
				></canvas>
				<!-- Gigi sobek + badan printer -->
				<div
					class="h-1.5 bg-zinc-500"
					style="width: calc(62mm * {zoom}); clip-path: polygon(0 100%, 2% 0, 4% 100%, 6% 0, 8% 100%, 10% 0, 12% 100%, 14% 0, 16% 100%, 18% 0, 20% 100%, 22% 0, 24% 100%, 26% 0, 28% 100%, 30% 0, 32% 100%, 34% 0, 36% 100%, 38% 0, 40% 100%, 42% 0, 44% 100%, 46% 0, 48% 100%, 50% 0, 52% 100%, 54% 0, 56% 100%, 58% 0, 60% 100%, 62% 0, 64% 100%, 66% 0, 68% 100%, 70% 0, 72% 100%, 74% 0, 76% 100%, 78% 0, 80% 100%, 82% 0, 84% 100%, 86% 0, 88% 100%, 90% 0, 92% 100%, 94% 0, 96% 100%, 98% 0, 100% 100%)"
				></div>
			</div>
			<div class="rounded-b-2xl bg-zinc-800 p-3 text-zinc-200" style="width: calc(78mm * {zoom})">
				<div class="flex items-center justify-between text-xs">
					<span class="font-bold tracking-wide">MTP-II</span>
					<span class="flex items-center gap-1.5"
						><span class="h-2.5 w-2.5 rounded-full {ledClass}"></span>{STATUS_LABEL[
							live.status
						]}</span
					>
				</div>
				<div class="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-400">
					<span>Baterai {live.battery.toFixed(1)}%</span>
					<span>Kertas {live.paperM.toFixed(2)} m</span>
					<span>Buffer {live.buffer}/{live.bufferSize} B</span>
					<span>Kepala {live.temp.toFixed(0)} °C</span>
				</div>
				<div class="mt-1 h-1 w-full rounded bg-zinc-700">
					<div
						class="h-1 rounded bg-sky-400"
						style="width: {(live.buffer / live.bufferSize) * 100}%"
					></div>
				</div>
				{#if live.hiddenRows > 0}
					<div class="mt-1 text-[11px] text-zinc-500">
						{(live.hiddenRows / DOTS_PER_MM).toFixed(1)} mm kertas masih di dalam printer (kepala → gigi
						sobek).
					</div>
				{/if}
			</div>
			{#if torn.length}
				<div class="mt-3 w-full border-t pt-2">
					<div class="mb-1 text-xs font-semibold text-zinc-500 uppercase">
						Struk yang sudah disobek
					</div>
					<div class="flex gap-2 overflow-x-auto">
						{#each torn as url, i (url)}
							<img src={url} alt="Struk sobekan {i + 1}" style="width: 58mm" class="shadow" />
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<!-- Hasil -->
		<section class="space-y-3 rounded-xl bg-white p-3 shadow-sm">
			<div>
				<div class="mb-1 text-xs font-semibold text-zinc-500 uppercase">Pemeriksaan</div>
				{#if checks.length === 0}
					<p class="text-xs text-zinc-500">Tekan "Cetak struk contoh".</p>
				{/if}
				<ul class="space-y-1 text-xs" data-testid="checks">
					{#each checks as check, i (i)}
						<li
							data-level={check.level}
							class="flex gap-1.5 {check.level === 'fail'
								? 'text-red-700'
								: check.level === 'warn'
									? 'text-amber-700'
									: check.level === 'ok'
										? 'text-emerald-700'
										: 'text-zinc-500'}"
						>
							<span>{LEVEL_ICON[check.level]}</span><span>{check.text}</span>
						</li>
					{/each}
				</ul>
			</div>
			{#if live.job}
				<div class="grid grid-cols-2 gap-1 text-xs">
					<span>Byte diterima</span><span class="font-mono">{live.job.bytesReceived}</span>
					{#if stats}<span>Tulis/potongan</span><span class="font-mono">{stats.writes}</span>{/if}
					<span>Lama transfer</span><span class="font-mono"
						>{live.transferMs !== null ? `${(live.transferMs / 1000).toFixed(1)} s` : '—'}</span
					>
					<span>Lama cetak</span><span class="font-mono"
						>{live.printMs !== null ? `${(live.printMs / 1000).toFixed(1)} s` : '—'}</span
					>
					<span>Panjang struk</span><span class="font-mono"
						>{reference ? `${(reference.height / DOTS_PER_MM).toFixed(0)} mm` : '—'}</span
					>
				</div>
			{/if}
			<div>
				<div class="mb-1 text-xs font-semibold text-zinc-500 uppercase">Log</div>
				<div
					class="h-64 overflow-auto rounded bg-zinc-900 p-2 font-mono text-[11px] leading-snug text-zinc-200"
				>
					{#each events.slice().reverse() as e, i (i)}
						<div
							class={e.level === 'error'
								? 'text-red-400'
								: e.level === 'warn'
									? 'text-amber-300'
									: ''}
						>
							{fmtTime(e.at)} [{e.channel}] {e.message}
						</div>
					{/each}
				</div>
			</div>
			<details>
				<summary class="cursor-pointer text-xs font-semibold text-zinc-500 uppercase"
					>Spesifikasi &amp; asumsi</summary
				>
				<table class="mt-1 w-full text-[11px]">
					<tbody>
						{#each MTP2_ASSUMPTIONS as a (a.name)}
							<tr class="border-t"
								><td class="pr-1">{a.name}</td><td class="pr-1">{a.value}</td><td
									class="text-zinc-500">{a.basis}</td
								></tr
							>
						{/each}
					</tbody>
				</table>
			</details>
		</section>
	</div>
</div>

{#if chooser}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="dialog"
		aria-modal="true"
		aria-labelledby="chooser-title"
	>
		<div class="w-80 rounded-lg bg-white p-4 shadow-xl">
			<h2 id="chooser-title" class="mb-2 font-semibold">
				{chooser.kind === 'bluetooth'
					? 'localhost ingin menyambung ke perangkat Bluetooth'
					: 'localhost ingin menyambung ke perangkat USB'}
			</h2>
			{#if chooser.names.length === 0}
				<p class="py-4 text-center text-xs text-zinc-500">
					Mencari perangkat… Tidak ada perangkat yang kompatibel ditemukan.
				</p>
			{/if}
			{#each chooser.names as name, i (name)}
				<button
					class="mb-1 block w-full rounded border p-2 text-left hover:bg-zinc-50"
					onclick={() => pick(i)}>{name}</button
				>
			{/each}
			<div class="mt-2 text-right">
				<button class="rounded px-3 py-1 text-zinc-600 hover:bg-zinc-100" onclick={() => pick(null)}
					>Batal</button
				>
			</div>
		</div>
	</div>
{/if}
