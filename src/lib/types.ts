export interface ReceiptItem {
	id: string;
	name: string;
	price: number;
	quantity: number;
	assignedTo: string[]; // Person IDs
}

export interface Person {
	id: string;
	name: string;
	color: string; // For visual distinction
}

export interface BillSettings {
	taxAmount: number; // User input in dollars
	tipPercent: number; // User input (0-100)
	tipAmount: number; // Derived from percent or manual override
	cashBackPercent: number; // User input (0-100), applied to subtotal
}

export interface PersonTotal {
	personId: string;
	personName: string;
	itemsTotal: number; // Sum of assigned items
	taxShare: number; // Proportional tax
	tipShare: number; // Proportional tip
	cashBackShare: number; // Proportional cashback (subtracted)
	grandTotal: number; // Final amount owed
}

// Multiplayer types
export interface BillState {
	items: ReceiptItem[];
	people: Person[];
	settings: BillSettings;
	rawOcrText: string;
	colorIndex: number;
}

export interface StateUpdate {
	action: string;
	data: unknown;
}

export interface Peer {
	peerId: string;
}

// Color palette for person badges
export const PERSON_COLORS = [
	'#f87171', // red-400
	'#fb923c', // orange-400
	'#facc15', // yellow-400
	'#4ade80', // green-400
	'#22d3ee', // cyan-400
	'#818cf8', // indigo-400
	'#e879f9', // fuchsia-400
	'#fb7185' // rose-400
];
