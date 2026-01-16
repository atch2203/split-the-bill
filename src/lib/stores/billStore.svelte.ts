import type { ReceiptItem, Person, BillSettings, PersonTotal, BillState, StateUpdate } from '$lib/types';
import { PERSON_COLORS } from '$lib/types';

// Sync state
let isSyncing = false;
let broadcastFn: ((update: StateUpdate) => void) | null = null;

// Generate unique IDs
function generateId(): string {
	return Math.random().toString(36).substring(2, 9);
}

// Reactive state using Svelte 5 runes
let items = $state<ReceiptItem[]>([]);
let people = $state<Person[]>([]);
let settings = $state<BillSettings>({
	taxAmount: 0,
	tipPercent: 18,
	tipAmount: 0,
	cashBackPercent: 0
});
let rawOcrText = $state<string>('');
let colorIndex = $state<number>(0);

// Derived values
const subtotal = $derived(items.reduce((sum, item) => sum + item.price * item.quantity, 0));

const effectiveTipAmount = $derived(
	settings.tipAmount > 0 ? settings.tipAmount : (subtotal * settings.tipPercent) / 100
);

const effectiveCashBack = $derived((subtotal * settings.cashBackPercent) / 100);

const grandTotal = $derived(subtotal + settings.taxAmount + effectiveTipAmount - effectiveCashBack);

const unassignedItems = $derived(items.filter((item) => item.assignedTo.length === 0));

const personTotals = $derived.by(() => {
	const totals: PersonTotal[] = [];

	for (const person of people) {
		// Calculate this person's share of items
		let itemsTotal = 0;
		for (const item of items) {
			if (item.assignedTo.includes(person.id)) {
				// Split item cost among all assigned people
				const splitAmount = (item.price * item.quantity) / item.assignedTo.length;
				itemsTotal += splitAmount;
			}
		}

		// Calculate proportional shares
		const proportion = subtotal > 0 ? itemsTotal / subtotal : 0;
		const taxShare = settings.taxAmount * proportion;
		const tipShare = effectiveTipAmount * proportion;
		const cashBackShare = effectiveCashBack * proportion;

		totals.push({
			personId: person.id,
			personName: person.name,
			itemsTotal,
			taxShare,
			tipShare,
			cashBackShare,
			grandTotal: itemsTotal + taxShare + tipShare - cashBackShare
		});
	}

	return totals;
});

// Actions
function addItem(name: string = 'New Item', price: number = 0, quantity: number = 1): ReceiptItem {
	const newItem: ReceiptItem = {
		id: generateId(),
		name,
		price,
		quantity,
		assignedTo: []
	};
	items.push(newItem);
	if (!isSyncing && broadcastFn) {
		broadcastFn({ action: 'addItem', data: newItem });
	}
	return newItem;
}

function removeItem(id: string): void {
	const index = items.findIndex((item) => item.id === id);
	if (index !== -1) {
		items.splice(index, 1);
		if (!isSyncing && broadcastFn) {
			broadcastFn({ action: 'removeItem', data: id });
		}
	}
}

function updateItem(id: string, updates: Partial<Omit<ReceiptItem, 'id'>>): void {
	const item = items.find((item) => item.id === id);
	if (item) {
		Object.assign(item, updates);
		if (!isSyncing && broadcastFn) {
			broadcastFn({ action: 'updateItem', data: { id, updates } });
		}
	}
}

function setItems(newItems: ReceiptItem[]): void {
	items.length = 0;
	items.push(...newItems);
	if (!isSyncing && broadcastFn) {
		broadcastFn({ action: 'setItems', data: newItems });
	}
}

function addPerson(name: string): Person {
	const newPerson: Person = {
		id: generateId(),
		name,
		color: PERSON_COLORS[colorIndex % PERSON_COLORS.length]
	};
	colorIndex++;
	people.push(newPerson);
	if (!isSyncing && broadcastFn) {
		broadcastFn({ action: 'addPerson', data: { person: newPerson, colorIndex } });
	}
	return newPerson;
}

function removePerson(id: string): void {
	// Remove person from the list
	const index = people.findIndex((person) => person.id === id);
	if (index !== -1) {
		people.splice(index, 1);
	}
	// Also remove them from all item assignments
	for (const item of items) {
		const assignmentIndex = item.assignedTo.indexOf(id);
		if (assignmentIndex !== -1) {
			item.assignedTo.splice(assignmentIndex, 1);
		}
	}
	if (!isSyncing && broadcastFn) {
		broadcastFn({ action: 'removePerson', data: id });
	}
}

function toggleAssignment(itemId: string, personId: string): void {
	const item = items.find((item) => item.id === itemId);
	if (!item) return;

	const index = item.assignedTo.indexOf(personId);
	if (index === -1) {
		item.assignedTo.push(personId);
	} else {
		item.assignedTo.splice(index, 1);
	}
	if (!isSyncing && broadcastFn) {
		broadcastFn({ action: 'toggleAssignment', data: { itemId, personId } });
	}
}

function updateSettings(updates: Partial<BillSettings>): void {
	Object.assign(settings, updates);
	if (!isSyncing && broadcastFn) {
		broadcastFn({ action: 'updateSettings', data: updates });
	}
}

function setRawOcrText(text: string): void {
	rawOcrText = text;
	if (!isSyncing && broadcastFn) {
		broadcastFn({ action: 'setRawOcrText', data: text });
	}
}

// Sync methods for multiplayer
function getSnapshot(): BillState {
	return {
		items: items.map((item) => ({ ...item, assignedTo: [...item.assignedTo] })),
		people: people.map((person) => ({ ...person })),
		settings: { ...settings },
		rawOcrText,
		colorIndex
	};
}

function applySnapshot(state: BillState): void {
	isSyncing = true;
	try {
		items.length = 0;
		items.push(...state.items);
		people.length = 0;
		people.push(...state.people);
		Object.assign(settings, state.settings);
		rawOcrText = state.rawOcrText;
		colorIndex = state.colorIndex;
	} finally {
		isSyncing = false;
	}
}

function applyUpdate(update: StateUpdate): void {
	isSyncing = true;
	try {
		switch (update.action) {
			case 'addItem':
				items.push(update.data as ReceiptItem);
				break;
			case 'removeItem': {
				const idx = items.findIndex((i) => i.id === update.data);
				if (idx !== -1) items.splice(idx, 1);
				break;
			}
			case 'updateItem': {
				const { id, updates } = update.data as { id: string; updates: Partial<ReceiptItem> };
				const item = items.find((i) => i.id === id);
				if (item) Object.assign(item, updates);
				break;
			}
			case 'setItems':
				items.length = 0;
				items.push(...(update.data as ReceiptItem[]));
				break;
			case 'addPerson': {
				const { person, colorIndex: newColorIndex } = update.data as {
					person: Person;
					colorIndex: number;
				};
				people.push(person);
				colorIndex = newColorIndex;
				break;
			}
			case 'removePerson': {
				const personId = update.data as string;
				const personIdx = people.findIndex((p) => p.id === personId);
				if (personIdx !== -1) people.splice(personIdx, 1);
				for (const item of items) {
					const assignmentIdx = item.assignedTo.indexOf(personId);
					if (assignmentIdx !== -1) item.assignedTo.splice(assignmentIdx, 1);
				}
				break;
			}
			case 'toggleAssignment': {
				const { itemId, personId } = update.data as { itemId: string; personId: string };
				const targetItem = items.find((i) => i.id === itemId);
				if (targetItem) {
					const assignIdx = targetItem.assignedTo.indexOf(personId);
					if (assignIdx === -1) {
						targetItem.assignedTo.push(personId);
					} else {
						targetItem.assignedTo.splice(assignIdx, 1);
					}
				}
				break;
			}
			case 'updateSettings':
				Object.assign(settings, update.data as Partial<BillSettings>);
				break;
			case 'setRawOcrText':
				rawOcrText = update.data as string;
				break;
		}
	} finally {
		isSyncing = false;
	}
}

function setBroadcastFunction(fn: ((update: StateUpdate) => void) | null): void {
	broadcastFn = fn;
}

function resetAll(): void {
	items.length = 0;
	people.length = 0;
	settings.taxAmount = 0;
	settings.tipPercent = 18;
	settings.tipAmount = 0;
	settings.cashBackPercent = 0;
	rawOcrText = '';
	colorIndex = 0;
}

// Export reactive getters and actions
export const billStore = {
	// Reactive state getters (use $derived in components)
	get items() {
		return items;
	},
	get people() {
		return people;
	},
	get settings() {
		return settings;
	},
	get rawOcrText() {
		return rawOcrText;
	},
	get subtotal() {
		return subtotal;
	},
	get effectiveTipAmount() {
		return effectiveTipAmount;
	},
	get effectiveCashBack() {
		return effectiveCashBack;
	},
	get grandTotal() {
		return grandTotal;
	},
	get unassignedItems() {
		return unassignedItems;
	},
	get personTotals() {
		return personTotals;
	},

	// Actions
	addItem,
	removeItem,
	updateItem,
	setItems,
	addPerson,
	removePerson,
	toggleAssignment,
	updateSettings,
	setRawOcrText,
	resetAll,

	// Sync methods for multiplayer
	getSnapshot,
	applySnapshot,
	applyUpdate,
	setBroadcastFunction
};
