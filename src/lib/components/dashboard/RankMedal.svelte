<script lang="ts">
	interface Props {
		rank: number; // 1-indexed (1, 2, 3, ...)
		size?: number; // default 30
	}

	let { rank, size = 30 }: Props = $props();
</script>

{#if rank === 1}
	<!-- Gold Medal with Rose/Red Ribbon & Embossed 1 -->
	<svg
		width={size}
		height={Math.round((size * 36) / 30)}
		viewBox="0 0 30 36"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		class="shrink-0 drop-shadow-xs"
		aria-label="Medali Emas Juara 1"
	>
		<!-- Ribbon Left -->
		<path d="M5 2L12 2L15 16L8 16L5 2Z" fill="#E11D48" />
		<path d="M7.5 2L9.5 2L12.5 16L10.5 16L7.5 2Z" fill="#FFE4E6" />

		<!-- Ribbon Right -->
		<path d="M25 2L18 2L15 16L22 16L25 2Z" fill="#BE123C" />
		<path d="M22.5 2L20.5 2L17.5 16L19.5 16L22.5 2Z" fill="#FFE4E6" />

		<!-- Ribbon Fold Shadow -->
		<path d="M9 16L15 18.5L21 16L15 20.5L9 16Z" fill="#881337" opacity="0.35" />

		<!-- Medal Coin Outer -->
		<circle cx="15" cy="23" r="10" fill="url(#goldGrad)" stroke="#B45309" stroke-width="1.2" />
		<!-- Medal Coin Inner Inset -->
		<circle
			cx="15"
			cy="23"
			r="7.5"
			stroke="#FDE68A"
			stroke-width="0.9"
			stroke-dasharray="1.5 1.2"
			fill="#F59E0B"
		/>

		<!-- Embossed 1 Number -->
		<text
			x="15"
			y="26.8"
			font-family="system-ui, -apple-system, sans-serif"
			font-size="10.5"
			font-weight="900"
			fill="#FFFBEB"
			stroke="#92400E"
			stroke-width="0.6"
			text-anchor="middle"
		>
			1
		</text>

		<defs>
			<linearGradient id="goldGrad" x1="8" y1="13" x2="22" y2="33" gradientUnits="userSpaceOnUse">
				<stop offset="0%" stop-color="#FEF08A" />
				<stop offset="45%" stop-color="#F59E0B" />
				<stop offset="100%" stop-color="#D97706" />
			</linearGradient>
		</defs>
	</svg>
{:else if rank === 2}
	<!-- Silver Medal with Blue/Navy Ribbon & Embossed 2 -->
	<svg
		width={size}
		height={Math.round((size * 36) / 30)}
		viewBox="0 0 30 36"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		class="shrink-0 drop-shadow-xs"
		aria-label="Medali Perak Juara 2"
	>
		<!-- Ribbon Left -->
		<path d="M5 2L12 2L15 16L8 16L5 2Z" fill="#3B82F6" />
		<path d="M7.5 2L9.5 2L12.5 16L10.5 16L7.5 2Z" fill="#DBEAFE" />

		<!-- Ribbon Right -->
		<path d="M25 2L18 2L15 16L22 16L25 2Z" fill="#1D4ED8" />
		<path d="M22.5 2L20.5 2L17.5 16L19.5 16L22.5 2Z" fill="#DBEAFE" />

		<!-- Ribbon Fold Shadow -->
		<path d="M9 16L15 18.5L21 16L15 20.5L9 16Z" fill="#1E3A8A" opacity="0.3" />

		<!-- Medal Coin Outer -->
		<circle cx="15" cy="23" r="10" fill="url(#silverGrad)" stroke="#64748B" stroke-width="1.2" />
		<!-- Medal Coin Inner Inset -->
		<circle
			cx="15"
			cy="23"
			r="7.5"
			stroke="#F1F5F9"
			stroke-width="0.9"
			stroke-dasharray="1.5 1.2"
			fill="#94A3B8"
		/>

		<!-- Embossed 2 Number -->
		<text
			x="15"
			y="26.8"
			font-family="system-ui, -apple-system, sans-serif"
			font-size="10.5"
			font-weight="900"
			fill="#FFFFFF"
			stroke="#334155"
			stroke-width="0.6"
			text-anchor="middle"
		>
			2
		</text>

		<defs>
			<linearGradient id="silverGrad" x1="8" y1="13" x2="22" y2="33" gradientUnits="userSpaceOnUse">
				<stop offset="0%" stop-color="#F8FAFC" />
				<stop offset="45%" stop-color="#CBD5E1" />
				<stop offset="100%" stop-color="#94A3B8" />
			</linearGradient>
		</defs>
	</svg>
{:else if rank === 3}
	<!-- Bronze Medal with Warm Amber Ribbon & Embossed 3 -->
	<svg
		width={size}
		height={Math.round((size * 36) / 30)}
		viewBox="0 0 30 36"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		class="shrink-0 drop-shadow-xs"
		aria-label="Medali Perunggu Juara 3"
	>
		<!-- Ribbon Left -->
		<path d="M5 2L12 2L15 16L8 16L5 2Z" fill="#D97706" />
		<path d="M7.5 2L9.5 2L12.5 16L10.5 16L7.5 2Z" fill="#FEF3C7" />

		<!-- Ribbon Right -->
		<path d="M25 2L18 2L15 16L22 16L25 2Z" fill="#B45309" />
		<path d="M22.5 2L20.5 2L17.5 16L19.5 16L22.5 2Z" fill="#FEF3C7" />

		<!-- Ribbon Fold Shadow -->
		<path d="M9 16L15 18.5L21 16L15 20.5L9 16Z" fill="#78350F" opacity="0.35" />

		<!-- Medal Coin Outer -->
		<circle cx="15" cy="23" r="10" fill="url(#bronzeGrad)" stroke="#9A3412" stroke-width="1.2" />
		<!-- Medal Coin Inner Inset -->
		<circle
			cx="15"
			cy="23"
			r="7.5"
			stroke="#FED7AA"
			stroke-width="0.9"
			stroke-dasharray="1.5 1.2"
			fill="#C2410C"
		/>

		<!-- Embossed 3 Number -->
		<text
			x="15"
			y="26.8"
			font-family="system-ui, -apple-system, sans-serif"
			font-size="10.5"
			font-weight="900"
			fill="#FFF7ED"
			stroke="#7C2D12"
			stroke-width="0.6"
			text-anchor="middle"
		>
			3
		</text>

		<defs>
			<linearGradient id="bronzeGrad" x1="8" y1="13" x2="22" y2="33" gradientUnits="userSpaceOnUse">
				<stop offset="0%" stop-color="#FED7AA" />
				<stop offset="45%" stop-color="#EA580C" />
				<stop offset="100%" stop-color="#9A3412" />
			</linearGradient>
		</defs>
	</svg>
{:else}
	<!-- Rank 4+ Minimal Pill -->
	<span
		class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500"
	>
		#{rank}
	</span>
{/if}
