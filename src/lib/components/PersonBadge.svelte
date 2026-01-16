<script lang="ts">
	import type { Person } from '$lib/types';

	interface Props {
		person: Person;
		selected?: boolean;
		showRemove?: boolean;
		onclick?: () => void;
		onremove?: () => void;
	}

	let { person, selected = false, showRemove = false, onclick, onremove }: Props = $props();
</script>

<button
	type="button"
	class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium transition-all"
	style="background-color: {selected ? person.color : person.color + '40'}; color: {selected
		? 'white'
		: 'inherit'}; border: 2px solid {person.color};"
	{onclick}
>
	<span>{person.name}</span>
	{#if selected}
		<span class="text-xs">&#10003;</span>
	{/if}
	{#if showRemove && onremove}
		<span
			role="button"
			tabindex="0"
			class="ml-1 cursor-pointer rounded-full p-0.5 transition-colors hover:bg-black/20"
			onclick={(e) => {
				e.stopPropagation();
				onremove?.();
			}}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.stopPropagation();
					onremove?.();
				}
			}}
			title="Remove {person.name}"
		>
			&#x2715;
		</span>
	{/if}
</button>
