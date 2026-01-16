import { billStore } from './billStore.svelte';
import { peerStore } from './peerStore.svelte';
import type { ReceiptItem, BillSettings } from '$lib/types';

// Create proxied actions that route to host when connected as guest
function createSyncedAction<T extends unknown[], R>(
	actionName: string,
	localAction: (...args: T) => R
): (...args: T) => R | undefined {
	return (...args: T): R | undefined => {
		if (peerStore.isGuest) {
			// Send action to host instead of executing locally
			peerStore.sendAction(actionName, args);
			return undefined;
		}
		// Execute locally (host or solo mode)
		return localAction(...args);
	};
}

// Synced actions for peer communication
export const syncedBillStore = {
	// Reactive state getters (read-only, always from local store)
	get items() { return billStore.items; },
	get people() { return billStore.people; },
	get settings() { return billStore.settings; },
	get rawOcrText() { return billStore.rawOcrText; },
	get subtotal() { return billStore.subtotal; },
	get effectiveTipAmount() { return billStore.effectiveTipAmount; },
	get effectiveCashBack() { return billStore.effectiveCashBack; },
	get grandTotal() { return billStore.grandTotal; },
	get unassignedItems() { return billStore.unassignedItems; },
	get personTotals() { return billStore.personTotals; },

	// Synced actions - these route through peer when connected as guest
	addItem: createSyncedAction('addItem', billStore.addItem) as (name?: string, price?: number, quantity?: number) => ReceiptItem | undefined,
	removeItem: createSyncedAction('removeItem', billStore.removeItem),
	updateItem: createSyncedAction('updateItem', billStore.updateItem) as (id: string, updates: Partial<Omit<ReceiptItem, 'id'>>) => void,
	setItems: createSyncedAction('setItems', billStore.setItems),
	addPerson: createSyncedAction('addPerson', billStore.addPerson),
	removePerson: createSyncedAction('removePerson', billStore.removePerson),
	toggleAssignment: createSyncedAction('toggleAssignment', billStore.toggleAssignment),
	updateSettings: createSyncedAction('updateSettings', billStore.updateSettings) as (updates: Partial<BillSettings>) => void,

	// Host-only actions (not synced to guests)
	setRawOcrText: billStore.setRawOcrText,
	resetAll: billStore.resetAll,

	// Direct access to underlying store for sync operations
	getState: billStore.getState,
	setState: billStore.setState,
	setOnStateChange: billStore.setOnStateChange
};
