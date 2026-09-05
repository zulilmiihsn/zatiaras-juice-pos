<script lang="ts">
	let {
		src = '',
		open = $bindable(false),
		aspect = 1,
		onDone,
		onCancel
	}: {
		src?: string;
		open?: boolean;
		aspect?: number;
		onDone?: (data: { cropped: string }) => void;
		onCancel?: () => void;
	} = $props();

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let img = new window.Image();
	let dragging = $state(false);
	let startX = $state(0),
		startY = $state(0);
	let offset = $state({ x: 0, y: 0 });
	let lastOffset = $state({ x: 0, y: 0 });
	let zoom = $state(1);
	let minZoom = $state(1);
	let maxZoom = $state(4);
	let preview = $state('');
	const csize = 300;
	const cropSize = 240; // frame crop persegi di tengah

	$effect(() => {
		if (src) {
			img.src = src;
			img.onload = () => {
				// [CATATAN]: Hitung minZoom agar gambar fit (bukan cover) di frame crop
				const scaleX = cropSize / img.width;
				const scaleY = cropSize / img.height;
				minZoom = Math.max(scaleX, scaleY);
				maxZoom = Math.max(4, minZoom * 2);
				zoom = minZoom;
				// [CATATAN]: Offset agar gambar tengah di frame crop
				offset.x = 0;
				offset.y = 0;
				lastOffset.x = 0;
				lastOffset.y = 0;
				preview = '';
				draw();
			};
		}
	});

	function updatePreview() {
		// [CATATAN]: Perhitungan crop area yang benar
		const drawW = img.width * zoom;
		const drawH = img.height * zoom;
		// [CATATAN]: Rumus baru: posisi crop frame terhadap gambar
		const sx = ((csize - cropSize) / 2 - offset.x + (drawW - csize) / 2) / zoom;
		const sy = ((csize - cropSize) / 2 - offset.y + (drawH - csize) / 2) / zoom;
		const temp = document.createElement('canvas');
		temp.width = cropSize;
		temp.height = cropSize;
		const ctx = temp.getContext('2d');
		if (ctx) {
			ctx.drawImage(img, sx, sy, cropSize / zoom, cropSize / zoom, 0, 0, cropSize, cropSize);
			preview = temp.toDataURL('image/jpeg', 0.92);
		}
	}

	function draw() {
		if (!canvasEl || !img.complete) return;
		const ctx = canvasEl.getContext('2d');
		if (ctx) {
			ctx.clearRect(0, 0, csize, csize);
			// [CATATAN]: Hitung ukuran gambar setelah zoom
			const drawW = img.width * zoom;
			const drawH = img.height * zoom;
			// [CATATAN]: Pusatkan gambar di canvas + offset
			const centerX = csize / 2 + offset.x;
			const centerY = csize / 2 + offset.y;
			ctx.save();
			ctx.beginPath();
			ctx.rect((csize - cropSize) / 2, (csize - cropSize) / 2, cropSize, cropSize);
			ctx.clip();
			ctx.drawImage(img, centerX - drawW / 2, centerY - drawH / 2, drawW, drawH);
			ctx.restore();
			// [CATATAN]: Overlay gelap di luar area crop
			ctx.save();
			ctx.globalAlpha = 0.5;
			ctx.fillStyle = '#000';
			ctx.beginPath();
			ctx.rect(0, 0, csize, csize);
			ctx.rect((csize - cropSize) / 2, (csize - cropSize) / 2, cropSize, cropSize);
			ctx.fill('evenodd');
			ctx.restore();
			// [CATATAN]: Border crop
			ctx.strokeStyle = '#ff5fa2';
			ctx.lineWidth = 2;
			ctx.strokeRect((csize - cropSize) / 2, (csize - cropSize) / 2, cropSize, cropSize);
			updatePreview();
		}
	}

	function getPointerPosition(e: TouchEvent | MouseEvent) {
		if ('touches' in e && e.touches.length > 0) {
			return { x: e.touches[0].clientX, y: e.touches[0].clientY };
		} else if ('clientX' in e) {
			return { x: e.clientX, y: e.clientY };
		}
		return { x: 0, y: 0 };
	}
	function onPointerDown(e: TouchEvent | MouseEvent) {
		e.preventDefault();
		dragging = true;
		const pos = getPointerPosition(e);
		startX = pos.x;
		startY = pos.y;
		lastOffset = { ...offset };
	}
	function onPointerMove(e: TouchEvent | MouseEvent) {
		if (!dragging) return;
		e.preventDefault();
		const pos = getPointerPosition(e);
		const dx = pos.x - startX;
		const dy = pos.y - startY;
		offset.x = lastOffset.x + dx;
		offset.y = lastOffset.y + dy;
		// [CATATAN]: Batasan agar cropper tidak keluar area crop
		const drawW = img.width * zoom;
		const drawH = img.height * zoom;
		const _minX = (cropSize - drawW) / 2;
		const maxX = (drawW - cropSize) / 2;
		const _minY = (cropSize - drawH) / 2;
		const maxY = (drawH - cropSize) / 2;
		offset.x = Math.max(-maxX, Math.min(offset.x, maxX));
		offset.y = Math.max(-maxY, Math.min(offset.y, maxY));
		draw();
	}
	function onPointerUp(e: TouchEvent | MouseEvent) {
		dragging = false;
	}
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = e.deltaY < 0 ? 0.05 : -0.05;
		zoom = Math.max(minZoom, Math.min(zoom + delta, maxZoom));
		draw();
	}
	function onZoomInput(e: Event) {
		const target = e.target as HTMLInputElement;
		zoom = parseFloat(target.value);
		draw();
	}

	function handleOk() {
		// [CATATAN]: preview sudah selalu update, cukup dispatch
		if (onDone) onDone({ cropped: preview });
		open = false;
	}
	function handleCancel() {
		if (onCancel) onCancel();
		open = false;
	}

	let lastCanvasEl: HTMLCanvasElement | null = null;

	$effect(() => {
		if (canvasEl && open) {
			// [CATATAN]: Jika canvasEl berubah, detach dari yang lama
			if (lastCanvasEl && lastCanvasEl !== canvasEl) {
				lastCanvasEl.removeEventListener('touchstart', onPointerDown);
				lastCanvasEl.removeEventListener('touchmove', onPointerMove);
				lastCanvasEl.removeEventListener('touchend', onPointerUp);
				lastCanvasEl.removeEventListener('wheel', onWheel);
			}
			canvasEl.addEventListener('touchstart', onPointerDown, { passive: false });
			canvasEl.addEventListener('touchmove', onPointerMove, { passive: false });
			canvasEl.addEventListener('touchend', onPointerUp, { passive: false });
			canvasEl.addEventListener('wheel', onWheel, { passive: false });
			lastCanvasEl = canvasEl;
			draw();
		} else if (lastCanvasEl) {
			lastCanvasEl.removeEventListener('touchstart', onPointerDown);
			lastCanvasEl.removeEventListener('touchmove', onPointerMove);
			lastCanvasEl.removeEventListener('touchend', onPointerUp);
			lastCanvasEl.removeEventListener('wheel', onWheel);
			lastCanvasEl = null;
			dragging = false;
		}
	});
</script>

{#if open}
	<div
		class="z-dialog fixed inset-0 flex items-center justify-center bg-black/40"
		role="dialog"
		aria-modal="true"
	>
		<div class="flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-4 shadow-xl">
			<div
				class="relative mb-4 aspect-square w-full overflow-hidden rounded-xl bg-gray-100"
				style="height:300px;"
			>
				<canvas
					bind:this={canvasEl}
					width={csize}
					height={csize}
					onmousedown={onPointerDown}
					onmousemove={onPointerMove}
					onmouseup={onPointerUp}
					onmouseleave={onPointerUp}
					style="width:100%;height:100%;touch-action:none;cursor:grab;"
				></canvas>
			</div>
			<input
				type="range"
				min={minZoom}
				max={maxZoom}
				step="0.01"
				bind:value={zoom}
				oninput={onZoomInput}
				class="mb-2 w-full accent-pink-500"
			/>
			<div class="mt-2 flex w-full gap-2">
				<button
					class="flex-1 rounded-xl bg-pink-500 px-4 py-2 text-base font-bold text-white shadow-md transition-colors hover:bg-pink-600"
					type="button"
					onclick={handleOk}>Gunakan</button
				>
				<button
					class="flex-1 rounded-xl border border-gray-300 px-4 py-2 text-base font-medium text-gray-700 transition-colors hover:bg-gray-50"
					type="button"
					onclick={handleCancel}>Batal</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	.aspect-square {
		aspect-ratio: 1 / 1;
	}
	input[type='range'].accent-pink-500::-webkit-slider-thumb {
		background: #ff5fa2;
	}
</style>
