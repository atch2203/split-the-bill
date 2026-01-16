import type { ReceiptItem, Person, BillSettings, PersonTotal } from '$lib/types';
import { PERSON_COLORS } from '$lib/types';

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
	return newItem;
}

function removeItem(id: string): void {
	const index = items.findIndex((item) => item.id === id);
	if (index !== -1) {
		items.splice(index, 1);
	}
}

function updateItem(id: string, updates: Partial<Omit<ReceiptItem, 'id'>>): void {
	const item = items.find((item) => item.id === id);
	if (item) {
		Object.assign(item, updates);
	}
}

function setItems(newItems: ReceiptItem[]): void {
	items.length = 0;
	items.push(...newItems);
}

function addPerson(name: string): Person {
	const newPerson: Person = {
		id: generateId(),
		name,
		color: PERSON_COLORS[colorIndex % PERSON_COLORS.length]
	};
	colorIndex++;
	people.push(newPerson);
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
}

function updateSettings(updates: Partial<BillSettings>): void {
	Object.assign(settings, updates);
}

function setRawOcrText(text: string): void {
	rawOcrText = text;
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
	resetAll
};
