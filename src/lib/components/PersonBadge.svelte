<script lang="ts">
	import type { Person } from '$lib/types';

	interface Props {
		person: Person;
		selected?: boolean;
		showRemove?: boolean;
		onclick?: () => void;
		onremove?: () => void;
		ondone?: () => void; // When provided, shows a clickable done toggle
	}

	let { person, selected = false, showRemove = false, onclick, onremove, ondone }: Props = $props();
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
	{#if ondone}
		<span
			role="button"
			tabindex="0"
			class="ml-1 flex h-4 w-4 items-center justify-center rounded-full text-xs transition-colors {person.done
				? 'bg-green-500 text-white'
				: 'bg-black/10 text-gray-500 hover:bg-black/20'}"
			title={person.done ? `${person.name} is done selecting` : `Mark ${person.name} done`}
			onclick={(e) => {
				e.stopPropagation();
				ondone?.();
			}}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.stopPropagation();
					ondone?.();
				}
			}}
		>
			&#10003;
		</span>
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
