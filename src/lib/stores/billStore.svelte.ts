import type { ReceiptItem, Person, BillSettings, PersonTotal, PaymentMethod } from '$lib/types';
import { PERSON_COLORS } from '$lib/types';

// Generate unique IDs
function generateId(): string {
	return Math.random().toString(36).substring(2, 9);
}

// Callback for notifying peer store of state changes
let onStateChange: (() => void) | null = null;
// When true, mutations skip broadcasting (e.g., local-only tour sample data)
let notificationsPaused = false;

// Reactive state using Svelte 5 runes
let items = $state<ReceiptItem[]>([]);
let people = $state<Person[]>([]);
let settings = $state<BillSettings>({
	taxAmount: 0,
	tipPercent: 18,
	tipAmount: 0,
	cashBackPercent: 0,
	title: '',
	guestsCanAddItems: true,
	guestsCanEditItems: true,
	guestsCanEditSettings: true
});
let rawOcrText = $state<string>('');
let colorIndex = $state<number>(0);
let paymentMethods = $state<PaymentMethod[]>([]);

// Derived values
const subtotal = $derived(items.reduce((sum, item) => sum + item.price * item.quantity, 0));

const effectiveTipAmount = $derived(
	settings.tipAmount > 0 ? settings.tipAmount : (subtotal * settings.tipPercent) / 100
);

const effectiveCashBack = $derived((subtotal * settings.cashBackPercent) / 100);

const grandTotal = $derived(subtotal + settings.taxAmount + effectiveTipAmount - effectiveCashBack);

const unassignedItems = $derived(items.filter((item) => item.assignedTo.length === 0));

function getItemShare(item: ReceiptItem, personId: string): number {
	if (!item.assignedTo.includes(personId)) return 0;
	const itemTotal = item.price * item.quantity;
	if (item.isMultipart && item.portions) {
		const totalPortions = item.assignedTo.reduce(
			(sum, id) => sum + (item.portions?.[id] ?? 1),
			0
		);
		if (totalPortions <= 0) return 0;
		const personPortion = item.portions[personId] ?? 1;
		return itemTotal * (personPortion / totalPortions);
	}
	return itemTotal / item.assignedTo.length;
}

const personTotals = $derived.by(() => {
	const totals: PersonTotal[] = [];

	for (const person of people) {
		// Calculate this person's share of items
		let itemsTotal = 0;
		for (const item of items) {
			itemsTotal += getItemShare(item, person.id);
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
function notifyStateChange(): void {
	if (notificationsPaused) return;
	if (onStateChange) {
		onStateChange();
	}
}

function pauseNotifications(): void {
	notificationsPaused = true;
}

function resumeNotifications(emit: boolean = true): void {
	notificationsPaused = false;
	if (emit && onStateChange) onStateChange();
}

function addItem(name: string = 'New Item', price: number = 0, quantity: number = 1): ReceiptItem {
	const newItem: ReceiptItem = {
		id: generateId(),
		name,
		price,
		quantity,
		assignedTo: [],
		isMultipart: false,
		portions: {}
	};
	items.push(newItem);
	notifyStateChange();
	return newItem;
}

function removeItem(id: string): void {
	const index = items.findIndex((item) => item.id === id);
	if (index !== -1) {
		const removed = items[index];
		items.splice(index, 1);
		clearDoneForPeople(removed.assignedTo);
		notifyStateChange();
	}
}

function updateItem(id: string, updates: Partial<Omit<ReceiptItem, 'id'>>): void {
	const item = items.find((item) => item.id === id);
	if (item) {
		const before = item.assignedTo;
		Object.assign(item, updates);
		if (updates.assignedTo) {
			// Anyone added to or removed from this item had their share change.
			clearDoneForPeople([...new Set([...before, ...updates.assignedTo])]);
		}
		notifyStateChange();
	}
}

function setItems(newItems: ReceiptItem[]): void {
	items.length = 0;
	items.push(...newItems);
	notifyStateChange();
}

function addPerson(name: string): Person {
	const newPerson: Person = {
		id: generateId(),
		name,
		color: PERSON_COLORS[colorIndex % PERSON_COLORS.length]
	};
	colorIndex++;
	people.push(newPerson);
	notifyStateChange();
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
	notifyStateChange();
}

// Clear the `done` flag for the given people (their selection changed).
function clearDoneForPeople(ids: string[]): void {
	for (const person of people) {
		if (person.done && ids.includes(person.id)) {
			person.done = false;
		}
	}
}

function toggleAssignment(itemId: string, personId: string): void {
	const item = items.find((item) => item.id === itemId);
	if (!item) return;

	const index = item.assignedTo.indexOf(personId);
	if (index === -1) {
		item.assignedTo.push(personId);
		if (item.isMultipart) {
			if (!item.portions) item.portions = {};
			item.portions[personId] = 1;
		}
	} else {
		item.assignedTo.splice(index, 1);
		if (item.portions && personId in item.portions) {
			delete item.portions[personId];
		}
	}
	clearDoneForPeople([personId]);
	notifyStateChange();
}

function setPersonDone(personId: string, done: boolean): void {
	const person = people.find((p) => p.id === personId);
	if (!person) return;
	person.done = done;
	notifyStateChange();
}

function setPersonPaid(personId: string, paid: boolean): void {
	const person = people.find((p) => p.id === personId);
	if (!person) return;
	person.paid = paid;
	notifyStateChange();
}

function toggleMultipart(itemId: string): void {
	const item = items.find((item) => item.id === itemId);
	if (!item) return;
	if (item.isMultipart) {
		item.isMultipart = false;
		item.portions = {};
	} else {
		item.isMultipart = true;
		const portions: Record<string, number> = {};
		for (const personId of item.assignedTo) {
			portions[personId] = item.portions?.[personId] ?? 1;
		}
		item.portions = portions;
	}
	clearDoneForPeople(item.assignedTo);
	notifyStateChange();
}

function setPortion(itemId: string, personId: string, portion: number): void {
	const item = items.find((item) => item.id === itemId);
	if (!item || !item.isMultipart) return;
	if (!item.assignedTo.includes(personId)) return;
	if (!item.portions) item.portions = {};
	item.portions[personId] = Math.max(1, Math.floor(portion));
	clearDoneForPeople([personId]);
	notifyStateChange();
}

function updateSettings(updates: Partial<BillSettings>): void {
	Object.assign(settings, updates);
	notifyStateChange();
}

function addPaymentMethod(label: string = '', value: string = ''): PaymentMethod {
	const pm: PaymentMethod = { id: generateId(), label, value };
	paymentMethods.push(pm);
	notifyStateChange();
	return pm;
}

function removePaymentMethod(id: string): void {
	const idx = paymentMethods.findIndex((p) => p.id === id);
	if (idx !== -1) {
		paymentMethods.splice(idx, 1);
		notifyStateChange();
	}
}

function updatePaymentMethod(id: string, updates: Partial<Omit<PaymentMethod, 'id'>>): void {
	const pm = paymentMethods.find((p) => p.id === id);
	if (pm) {
		Object.assign(pm, updates);
		notifyStateChange();
	}
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
	settings.title = '';
	settings.guestsCanAddItems = true;
	settings.guestsCanEditItems = true;
	settings.guestsCanEditSettings = true;
	rawOcrText = '';
	colorIndex = 0;
	paymentMethods.length = 0;
	notifyStateChange();
}

// State sync functions for peer communication
function getState() {
	return {
		items: JSON.parse(JSON.stringify(items)),
		people: JSON.parse(JSON.stringify(people)),
		settings: JSON.parse(JSON.stringify(settings)),
		colorIndex,
		paymentMethods: JSON.parse(JSON.stringify(paymentMethods))
	};
}

function setState(state: {
	items: ReceiptItem[];
	people: Person[];
	settings: BillSettings;
	colorIndex: number;
	paymentMethods?: PaymentMethod[];
}): void {
	items.length = 0;
	items.push(...state.items);
	people.length = 0;
	people.push(...state.people);
	Object.assign(settings, state.settings);
	colorIndex = state.colorIndex;
	paymentMethods.length = 0;
	if (state.paymentMethods) paymentMethods.push(...state.paymentMethods);
}

function setOnStateChange(callback: (() => void) | null): void {
	onStateChange = callback;
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
	get paymentMethods() {
		return paymentMethods;
	},

	// Actions
	addItem,
	removeItem,
	updateItem,
	setItems,
	addPerson,
	removePerson,
	setPersonDone,
	setPersonPaid,
	toggleAssignment,
	toggleMultipart,
	setPortion,
	updateSettings,
	addPaymentMethod,
	removePaymentMethod,
	updatePaymentMethod,
	setRawOcrText,
	resetAll,

	// Peer sync functions
	getState,
	setState,
	setOnStateChange,
	pauseNotifications,
	resumeNotifications
};
