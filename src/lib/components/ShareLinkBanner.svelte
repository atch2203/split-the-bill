<script lang="ts">
	import { peerStore } from '$lib/stores/peerStore.svelte';

	let hidden = $state(false);
	let copied = $state(false);

	const shareUrl = $derived(peerStore.getShareUrl());

	function copyLink() {
		navigator.clipboard.writeText(shareUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

{#if peerStore.isHost && peerStore.peerId && !hidden}
	<div class="rounded-lg border border-blue-200 bg-blue-50 p-3">
		<div class="flex items-center justify-between gap-2">
			<div class="flex-1">
				<p class="mb-1 text-sm font-medium text-blue-800">Share this link with others:</p>
				<div class="flex items-center gap-2">
					<input
						type="text"
						readonly
						value={shareUrl}
						class="flex-1 rounded border border-blue-200 bg-white px-2 py-1 text-sm text-gray-700 outline-none"
						onclick={(e) => (e.target as HTMLInputElement).select()}
					/>
					<button
						onclick={copyLink}
						class="rounded-lg bg-blue-500 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-blue-600"
					>
						{copied ? 'Copied!' : 'Copy'}
					</button>
				</div>
			</div>
			<button
				onclick={() => (hidden = true)}
				class="self-start rounded p-1 text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-600"
				title="Hide"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	</div>
{/if}

{#if peerStore.isHost && peerStore.peerId && hidden}
	<div class="flex items-center gap-2">
		<button
			onclick={() => (hidden = false)}
			class="flex-1 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-600 transition-colors hover:bg-blue-100"
		>
			Show share link
		</button>
		<button
			onclick={copyLink}
			class="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
		>
			{copied ? 'Copied!' : 'Copy Link'}
		</button>
	</div>
{/if}
