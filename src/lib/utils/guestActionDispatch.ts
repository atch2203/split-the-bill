import { billStore } from '$lib/stores/billStore.svelte';

// Host-side validator + dispatcher for actions received from guests via P2P.
// Guests cannot be trusted: validate every action name, every argument type,
// every range, and enforce host-controlled guest permission flags.

const MAX_NAME = 100;
const MAX_TITLE = 200;
const MAX_LABEL = 60;
const MAX_VALUE = 200;
const MAX_PRICE = 1_000_000;
const MAX_QTY = 9999;
const MAX_PORTION = 99;
const MAX_PERCENT = 100;

const ITEM_UPDATE_KEYS = new Set([
	'name',
	'price',
	'quantity',
	'assignedTo',
	'isMultipart',
	'portions'
]);

// Settings keys a guest is allowed to touch (when guestsCanEditSettings is true).
// Notably excludes guest-permission flags so a malicious guest can't escalate.
const SETTINGS_GUEST_KEYS = new Set([
	'taxAmount',
	'tipPercent',
	'tipAmount',
	'cashBackPercent',
	'title'
]);

function isStr(x: unknown, max: number): x is string {
	return typeof x === 'string' && x.length <= max;
}
function isFiniteNum(x: unknown): x is number {
	return typeof x === 'number' && Number.isFinite(x);
}
function trunc(x: unknown, max: number): string {
	return typeof x === 'string' ? x.slice(0, max) : '';
}
function isItemId(id: unknown): id is string {
	return typeof id === 'string' && billStore.items.some((i) => i.id === id);
}
function isPersonId(id: unknown): id is string {
	return typeof id === 'string' && billStore.people.some((p) => p.id === id);
}
function clampInt(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, Math.floor(n)));
}
function clampNum(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

export function handleGuestAction(action: string, rawArgs: unknown): void {
	// Guard: args must be an array (peerStore sends action.args, but verify shape anyway).
	if (!Array.isArray(rawArgs)) return;
	const args = rawArgs;

	const s = billStore.settings;
	const canAdd = s.guestsCanAddItems !== false;
	const canEdit = s.guestsCanEditItems !== false;
	const canSettings = s.guestsCanEditSettings !== false;

	switch (action) {
		case 'addPerson': {
			// Allowed for any guest (creating their identity). Restrict name length.
			if (!isStr(args[0], MAX_LABEL)) return;
			const name = trunc(args[0], MAX_LABEL).trim();
			if (!name) return;
			billStore.addPerson(name);
			return;
		}

		case 'setPersonDone': {
			// Allowed for any guest — marking done is part of the selection flow.
			// UI only exposes the toggle for the guest's own identity; the host can
			// override anyone. Either way we only need a valid personId + boolean.
			if (!isPersonId(args[0]) || typeof args[1] !== 'boolean') return;
			billStore.setPersonDone(args[0], args[1]);
			return;
		}

		case 'toggleAssignment': {
			// Allowed for any guest — they need to assign themselves to items.
			if (!isItemId(args[0]) || !isPersonId(args[1])) return;
			billStore.toggleAssignment(args[0], args[1]);
			return;
		}

		case 'setPortion': {
			// Allowed for any guest — portion adjustment is part of the assignment flow,
			// not "editing the item" itself.
			if (!isItemId(args[0]) || !isPersonId(args[1]) || !isFiniteNum(args[2])) return;
			billStore.setPortion(args[0], args[1], clampInt(args[2], 1, MAX_PORTION));
			return;
		}

		case 'toggleMultipart': {
			// Allowed for any guest — switching split mode is part of the assignment flow.
			if (!isItemId(args[0])) return;
			billStore.toggleMultipart(args[0]);
			return;
		}

		case 'addItem': {
			if (!canAdd) return;
			const name = (trunc(args[0], MAX_NAME).trim() || 'New Item').slice(0, MAX_NAME);
			const price = isFiniteNum(args[1]) ? clampNum(args[1], 0, MAX_PRICE) : 0;
			const qty = isFiniteNum(args[2]) ? clampInt(args[2], 1, MAX_QTY) : 1;
			billStore.addItem(name, price, qty);
			return;
		}

		case 'removeItem': {
			if (!canEdit) return;
			if (!isItemId(args[0])) return;
			billStore.removeItem(args[0]);
			return;
		}

		case 'updateItem': {
			if (!canEdit) return;
			if (!isItemId(args[0])) return;
			const item = billStore.items.find((i) => i.id === args[0]);
			if (!item) return;
			const updates = args[1];
			if (!updates || typeof updates !== 'object') return;
			const safe: Record<string, unknown> = {};
			// First pass: collect assignedTo (we need final list to validate portions).
			let finalAssignedTo: string[] = item.assignedTo;
			if (
				'assignedTo' in updates &&
				Array.isArray((updates as Record<string, unknown>).assignedTo)
			) {
				const arr = (updates as Record<string, unknown[]>).assignedTo;
				finalAssignedTo = arr.filter((id): id is string => isPersonId(id));
				safe.assignedTo = finalAssignedTo;
			}
			for (const [k, v] of Object.entries(updates as Record<string, unknown>)) {
				if (!ITEM_UPDATE_KEYS.has(k)) continue;
				if (k === 'assignedTo') continue; // already handled
				if (k === 'name') safe[k] = trunc(v, MAX_NAME);
				else if (k === 'price')
					safe[k] = isFiniteNum(v) ? clampNum(v, 0, MAX_PRICE) : 0;
				else if (k === 'quantity')
					safe[k] = isFiniteNum(v) ? clampInt(v, 1, MAX_QTY) : 1;
				else if (k === 'isMultipart') safe[k] = !!v;
				else if (k === 'portions') {
					if (v && typeof v === 'object') {
						const cleaned: Record<string, number> = {};
						const allowedSet = new Set(finalAssignedTo);
						for (const [pid, pv] of Object.entries(v as Record<string, unknown>)) {
							// Only keep entries for people actually assigned to this item.
							if (allowedSet.has(pid) && isFiniteNum(pv)) {
								cleaned[pid] = clampInt(pv, 1, MAX_PORTION);
							}
						}
						safe[k] = cleaned;
					}
				}
			}
			if (Object.keys(safe).length === 0) return;
			billStore.updateItem(args[0], safe as Parameters<typeof billStore.updateItem>[1]);
			return;
		}

		case 'updateSettings': {
			if (!canSettings) return;
			const updates = args[0];
			if (!updates || typeof updates !== 'object') return;
			const safe: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(updates as Record<string, unknown>)) {
				if (!SETTINGS_GUEST_KEYS.has(k)) continue;
				if (k === 'title') {
					if (typeof v === 'string') safe[k] = v.slice(0, MAX_TITLE);
				} else if (k === 'cashBackPercent' || k === 'tipPercent') {
					if (isFiniteNum(v)) safe[k] = clampNum(v, 0, MAX_PERCENT);
				} else if (isFiniteNum(v)) {
					safe[k] = clampNum(v, 0, MAX_PRICE);
				}
			}
			if (Object.keys(safe).length === 0) return;
			billStore.updateSettings(safe);
			return;
		}

		// Explicitly host-only — silently drop:
		// removePerson, setPersonPaid, setItems, setState, getState, setOnStateChange,
		// setRawOcrText, resetAll, addPaymentMethod, removePaymentMethod, updatePaymentMethod.
		// Unknown identifiers: drop.
		default:
			return;
	}
}

// Whitelist for guest-side `sendAction` — keeps malformed/forbidden actions off the wire.
// Mirrors the dispatcher; the dispatcher is the trust boundary, this is just a hint.
export const ALLOWED_GUEST_ACTIONS = new Set([
	'addPerson',
	'setPersonDone',
	'toggleAssignment',
	'setPortion',
	'toggleMultipart',
	'addItem',
	'removeItem',
	'updateItem',
	'updateSettings'
]);
