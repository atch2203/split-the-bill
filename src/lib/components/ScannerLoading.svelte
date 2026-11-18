<script lang="ts">
	import type { LoadProgress } from '$lib/ocr/client';

	interface Props {
		progress: LoadProgress | null;
		/** Light text on the dark camera view. */
		dark?: boolean;
	}
	let { progress, dark = false }: Props = $props();

	const mb = (n: number) => (n / 1e6).toFixed(1);
	const fraction = $derived(
		progress?.stage === 'download' && progress.total ? Math.min(progress.loaded / progress.total, 1) : null
	);
	const label = $derived(
		progress?.stage === 'starting'
			? 'Starting scanner…'
			: progress?.stage === 'download'
				? progress.total
					? `Loading scanner… ${mb(progress.loaded)} / ${mb(progress.total)} MB`
					: `Loading scanner… ${mb(progress.loaded)} MB`
				: 'Loading scanner…'
	);
</script>

<div class="w-full max-w-xs space-y-2" role="status" aria-live="polite">
	<p class="text-center text-sm {dark ? 'text-white/80' : 'text-gray-600'}">{label}</p>
	<div
		class="h-2 w-full overflow-hidden rounded-full {dark ? 'bg-white/20' : 'bg-gray-200'}"
		role="progressbar"
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
	>
		{#if fraction !== null}
			<div class="h-full rounded-full bg-blue-500 transition-[width] duration-150" style="width: {fraction * 100}%"></div>
		{:else}
			<!-- Unknown size, or the post-download startup: indeterminate. -->
			<div class="indeterminate h-full w-1/3 rounded-full bg-blue-500"></div>
		{/if}
	</div>
</div>

<style>
	.indeterminate {
		animation: slide 1.2s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}
</style>
