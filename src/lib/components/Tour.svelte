<script lang="ts">
	import { onMount } from 'svelte';
	import { peerStore } from '$lib/stores/peerStore.svelte';
	import { syncedBillStore } from '$lib/stores/syncedBillStore.svelte';
	import { billStore } from '$lib/stores/billStore.svelte';
	import { identityStore } from '$lib/stores/identityStore.svelte';

	type Step = {
		selector: string;
		title: string;
		body: string;
		hideForGuest?: boolean;
		rootMargin?: string;
	};

	const DEFAULT_ROOT_MARGIN = '-30% 0px -30% 0px';

	const allSteps: Step[] = [
		{
			selector: '[data-tour="share"]',
			title: 'Share',
			body: 'Invite others to split this bill with you in real-time.',
			hideForGuest: true,
			// Header lives at top of page — use full viewport so the callout stays visible
			// longer instead of fading the moment user starts scrolling.
			rootMargin: '0px'
		},
		{
			selector: '[data-tour="parse"]',
			title: 'Parse receipt',
			body: 'Upload a receipt photo or paste OCR text — the parser extracts items, prices, tax, and tip automatically.',
			hideForGuest: true
		},
		{
			selector: '[data-tour="test-item"]',
			title: 'Item row',
			body: 'Each item: edit name/price/qty with the pencil. Tap "+ Me" to add yourself. "+ Other" to add someone else. The lines icon switches to portion-based split (e.g., someone ate 2x).'
		},
		{
			selector: '[data-tour="settings"]',
			title: 'Settings',
			body: 'Set tax, tip, and cashback here.',
			hideForGuest: true
		},
		{
			selector: '[data-tour="payments"]',
			title: 'Payment Methods',
			body: 'Host adds payment handles (Venmo, Cash App, Zelle, PayPal). Guests see "Pay $X" buttons that open Venmo / Cash App / PayPal pre-filled with the amount they owe.'
		},
		{
			selector: '[data-tour="summary"]',
			title: 'Summary',
			body: 'Per-person breakdown. Your card is highlighted with your color and a "You" tag. Your items list below shows what you owe for.'
		},
		{
			selector: '[data-tour="export"]',
			title: 'Export',
			body: 'Copy a text summary or export the bill data.',
			hideForGuest: true
		}
	];

	let { onClose }: { onClose: () => void } = $props();

	// Doc-coord rect (relative to document, not viewport) so labels scroll with page natively.
	type PageRect = { top: number; left: number; width: number; height: number; bottom: number };
	type Box = { step: Step; rect: PageRect; placeAbove: boolean };
	let boxes = $state<Box[]>([]);
	let viewportWidth = $state(0);
	let visibility = $state<Record<string, boolean>>({});
	let observers: IntersectionObserver[] = [];

	function setupObservers() {
		cleanupObservers();
		for (const step of allSteps) {
			if (step.hideForGuest && peerStore.isGuest) continue;
			const el = resolveElement(step);
			if (!el) continue;
			visibility = { ...visibility, [step.selector]: true };
			const obs = new IntersectionObserver(
				([entry]) => {
					visibility = { ...visibility, [step.selector]: entry.isIntersecting };
				},
				// Most steps use a shrunk middle band so callouts don't linger.
				// Steps that want a wider detection zone (e.g. the header) override rootMargin.
				{ threshold: 0, rootMargin: step.rootMargin ?? DEFAULT_ROOT_MARGIN }
			);
			obs.observe(el);
			observers.push(obs);
		}
	}

	function cleanupObservers() {
		for (const o of observers) o.disconnect();
		observers = [];
	}

	const LABEL_HEIGHT = 110;

	function firstVisible(els: NodeListOf<Element> | Element[]): Element | null {
		// Prefer an element with non-zero layout box (filters hidden duplicates,
		// e.g., a desktop-only header version coexisting with a mobile one).
		for (const el of els) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) return el;
		}
		return els[0] ?? null;
	}

	function resolveElement(step: Step): Element | null {
		if (step.selector === '[data-tour="test-item"]') {
			if (testItemId) {
				const row = document.querySelector(`[data-item-id="${testItemId}"]`);
				if (row) return row;
			}
			// Guest tour: ItemList renders a static demo row tagged with this id
			const demoRow = document.querySelector('[data-item-id="tour-demo"]');
			if (demoRow) return demoRow;
			return firstVisible(document.querySelectorAll('[data-tour="items"]'));
		}
		return firstVisible(document.querySelectorAll(step.selector));
	}

	function measure() {
		if (typeof window === 'undefined') return;
		viewportWidth = window.innerWidth;
		const next: Box[] = [];
		for (const step of allSteps) {
			if (step.hideForGuest && peerStore.isGuest) continue;
			const el = resolveElement(step);
			if (!el) continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const rect: PageRect = {
				top: r.top + window.scrollY,
				left: r.left + window.scrollX,
				width: r.width,
				height: r.height,
				bottom: r.bottom + window.scrollY
			};
			next.push({ step, rect, placeAbove: false });
		}
		boxes = next;
	}

	let testItemId: string | null = null;
	let testPersonId: string | null = null;
	let testPaymentMethodIds: string[] = [];
	let prevIdentityId: string | null = null;
	let swappedIdentity = false;

	let pausedHostBroadcast = false;

	onMount(() => {
		identityStore.setTourActive(true);
		// Host only: add a sample person + item + payment methods so users can see all parts
		// of the UI. Also temporarily set identity to the test person so the summary
		// self-highlight + "Your items" demo renders. Guests can't mutate state, so skip.
		if (!peerStore.isGuest) {
			// Install a broadcast filter so any state sent to guests has tour-only sample
			// data stripped. Then pause local mutation broadcasts so the tour-init churn
			// doesn't flood guests (they're all no-ops after filtering anyway, but
			// pausing keeps the wire quiet). Guest actions during the tour bypass the
			// pause via an explicit broadcast in ShareButton's onAction handler.
			peerStore.setStateFilter((s) => ({
				...s,
				items: s.items.filter((i) => i.id !== testItemId),
				people: s.people.filter((p) => p.id !== testPersonId),
				paymentMethods: (s.paymentMethods ?? []).filter(
					(pm) => !testPaymentMethodIds.includes(pm.id)
				)
			}));
			billStore.pauseNotifications();
			pausedHostBroadcast = true;

			const person = billStore.addPerson('Sample person (tour)');
			testPersonId = person?.id ?? null;
			const item = billStore.addItem('Sample burger (tour)', 12.5, 1);
			testItemId = item?.id ?? null;
			if (testItemId && testPersonId) {
				billStore.toggleAssignment(testItemId, testPersonId);
			}

			const venmo = billStore.addPaymentMethod('Venmo', '@sample-handle');
			if (venmo) testPaymentMethodIds.push(venmo.id);
			const zelle = billStore.addPaymentMethod('Zelle', '555-555-1234');
			if (zelle) testPaymentMethodIds.push(zelle.id);

			// Swap identity to sample person so summary self-highlight + payment buttons demo render
			if (testPersonId) {
				prevIdentityId = identityStore.currentPersonId;
				identityStore.setCurrentPerson(testPersonId);
				swappedIdentity = true;
			}
		}

		measure();
		setupObservers();
		// Re-measure after layout settles (DOM grows from added test item).
		// No scroll listener: labels live in document coordinates and scroll with the page.
		const t1 = setTimeout(() => {
			measure();
			setupObservers();
		}, 50);
		const t2 = setTimeout(() => {
			measure();
			setupObservers();
		}, 250);
		return () => {
			identityStore.setTourActive(false);
			cleanupObservers();
			clearTimeout(t1);
			clearTimeout(t2);
			// Restore identity before removing the person (else identity points at deleted id).
			if (swappedIdentity) {
				if (prevIdentityId) {
					identityStore.setCurrentPerson(prevIdentityId);
				} else {
					identityStore.clear();
				}
				swappedIdentity = false;
			}
			for (const pmId of testPaymentMethodIds) {
				billStore.removePaymentMethod(pmId);
			}
			testPaymentMethodIds = [];
			if (testItemId) {
				billStore.removeItem(testItemId);
				testItemId = null;
			}
			if (testPersonId) {
				billStore.removePerson(testPersonId);
				testPersonId = null;
			}
			// Resume broadcasts and clear the filter, then emit a single sync so guests get
			// the post-cleanup state (matches pre-tour state — tour data was removed).
			if (pausedHostBroadcast) {
				peerStore.setStateFilter(null);
				billStore.resumeNotifications(true);
				pausedHostBroadcast = false;
			} else {
				peerStore.setStateFilter(null);
			}
		};
	});

	function labelLeft(rect: PageRect): number {
		const labelWidth = 240;
		return Math.max(8, Math.min(rect.left, viewportWidth - labelWidth - 8));
	}
</script>

<svelte:window onresize={measure} />

<!-- Backdrop dimmer (always solid during the tour; click to dismiss) -->
<button
	onclick={onClose}
	aria-label="Close tour"
	class="fixed inset-0 z-40 bg-black/30"
></button>

<!-- Labels in document flow so they scroll natively with the page -->
<div class="pointer-events-none absolute inset-0 top-0 left-0 z-50">
	{#each boxes as { step, rect } (step.selector + '-spot')}
		{@const isVisible = visibility[step.selector] !== false}
		<!-- Brighten target above dimmed backdrop -->
		<div
			class="absolute rounded-lg transition-opacity duration-300"
			style="top: {rect.top - 6}px; left: {rect.left - 6}px; width: {rect.width + 12}px; height: {rect.height + 12}px; backdrop-filter: brightness(1.3); -webkit-backdrop-filter: brightness(1.3); opacity: {isVisible ? 1 : 0};"
		></div>
	{/each}
	{#each boxes as { step, rect, placeAbove } (step.selector)}
		{@const isVisible = visibility[step.selector] !== false}
		<!-- Label with arrow -->
		<div
			class="absolute w-[240px] rounded-lg border-2 border-yellow-500 bg-yellow-50 p-2.5 shadow-xl transition-opacity duration-300"
			style="top: {placeAbove ? rect.top - 12 - LABEL_HEIGHT : rect.bottom + 12}px; left: {labelLeft(rect)}px; opacity: {isVisible ? 1 : 0}; pointer-events: {isVisible ? 'auto' : 'none'};"
		>
			<!-- Arrow -->
			<div
				class="absolute h-0 w-0"
				style="left: {Math.min(rect.left + rect.width / 2 - labelLeft(rect) - 8, 220)}px; {placeAbove
					? 'bottom: -10px; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 10px solid #eab308;'
					: 'top: -10px; border-left: 10px solid transparent; border-right: 10px solid transparent; border-bottom: 10px solid #eab308;'}"
			></div>
			<p class="text-xs font-bold text-gray-900">{step.title}</p>
			<p class="mt-0.5 text-xs leading-snug text-gray-700">{step.body}</p>
		</div>
	{/each}
</div>

<!-- Close button (fixed; always reachable) -->
<button
	onclick={onClose}
	class="fixed left-4 top-4 z-50 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-lg transition-colors hover:bg-gray-100"
>
	✕ Close tour
</button>
