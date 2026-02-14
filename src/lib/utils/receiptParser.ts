import type { ReceiptItem } from '$lib/types';

interface ParsedLine {
	name: string;
	price: number;
	quantity: number;
}

interface PendingItem {
	name: string;
	quantity: number;
	unitPrice: number | null;
	lineTotal: number | null;
}

export interface ParseResult {
	items: ReceiptItem[];
	taxAmount: number | null;
	subtotal: number | null;
	total: number | null;
	tipAmount: number | null;
}

// Generate unique ID
function generateId(): string {
	return Math.random().toString(36).substring(2, 9);
}

// Normalize price string to handle OCR errors (missing decimal, missing dollar sign)
function normalizePrice(priceStr: string): number | null {
	if (!priceStr) return null;

	// Remove common OCR artifacts and whitespace
	let cleaned = priceStr
		.replace(/[$,\s]/g, '')
		.replace(/^[oO]/, '0') // O misread as 0
		.replace(/[lI]/g, '1') // l or I misread as 1
		.replace(/[oO]/g, '0') // O misread as 0
		.replace(/[sS]$/, '5') // trailing S misread as 5
		.trim();

	// Handle decimal point alternatives (space, comma acting as decimal)
	// e.g., "12 99" or "12,99" -> "12.99"
	cleaned = cleaned.replace(/(\d+)[,\s](\d{2})$/, '$1.$2');

	// If there's already a proper decimal, parse directly
	if (/^\d+\.\d{1,2}$/.test(cleaned)) {
		const value = parseFloat(cleaned);
		return isNaN(value) ? null : value;
	}

	// If it's just digits with 3+ chars and no decimal, assume last 2 are cents
	// e.g., "1299" -> 12.99, "599" -> 5.99
	if (/^\d{3,}$/.test(cleaned)) {
		const cents = cleaned.slice(-2);
		const dollars = cleaned.slice(0, -2) || '0';
		const value = parseFloat(`${dollars}.${cents}`);
		return isNaN(value) ? null : value;
	}

	// If it's 1-2 digits, treat as whole dollars
	if (/^\d{1,2}$/.test(cleaned)) {
		const value = parseFloat(cleaned);
		return isNaN(value) ? null : value;
	}

	// Try parsing as-is
	const value = parseFloat(cleaned);
	return isNaN(value) ? null : value;
}

// Patterns that indicate TAX line (we want to extract this value)
// Made more flexible to handle OCR errors (missing decimals, spaces, etc.)
const TAX_PATTERNS = [
	/^tax\s*:?\s*\$?([\d,.\s]+)/i,
	/^sales\s*tax\s*:?\s*\$?([\d,.\s]+)/i,
	/^hst\s*:?\s*\$?([\d,.\s]+)/i,
	/^gst\s*:?\s*\$?([\d,.\s]+)/i,
	/^pst\s*:?\s*\$?([\d,.\s]+)/i,
	/^vat\s*:?\s*\$?([\d,.\s]+)/i,
	/tax\s*\$?([\d,.\s]+)\s*$/i
];

// Label-only patterns (for multi-line detection where value is on next line)
const TAX_LABEL_PATTERNS = [/^(sales\s*)?tax\s*:?\s*$/i, /^hst\s*:?\s*$/i, /^gst\s*:?\s*$/i, /^pst\s*:?\s*$/i, /^vat\s*:?\s*$/i];

// Patterns that indicate SUBTOTAL line
const SUBTOTAL_PATTERNS = [
	/^sub\s*-?\s*total\s*:?\s*\$?([\d,.\s]+)/i,
	/^subtotal\s*:?\s*\$?([\d,.\s]+)/i,
	/^sub\s+\$?([\d,.\s]+)/i
];

const SUBTOTAL_LABEL_PATTERNS = [/^sub\s*-?\s*total\s*:?\s*$/i, /^subtotal\s*:?\s*$/i];

// Patterns that indicate TOTAL line
const TOTAL_PATTERNS = [
	/^total\s*:?\s*\$?([\d,.\s]+)/i,
	/^grand\s*total\s*:?\s*\$?([\d,.\s]+)/i,
	/^amount\s*due\s*:?\s*\$?([\d,.\s]+)/i,
	/^balance\s*due\s*:?\s*\$?([\d,.\s]+)/i
];

const TOTAL_LABEL_PATTERNS = [/^(grand\s*)?total\s*:?\s*$/i, /^amount\s*due\s*:?\s*$/i, /^balance\s*due\s*:?\s*$/i];

// Patterns that indicate TIP line
const TIP_PATTERNS = [
	/^tip\s*:?\s*\$?([\d,.\s]+)/i,
	/^gratuity\s*:?\s*\$?([\d,.\s]+)/i
];

const TIP_LABEL_PATTERNS = [/^tip\s*:?\s*$/i, /^gratuity\s*:?\s*$/i];

// Common words/patterns to skip (not actual menu items)
const SKIP_PATTERNS = [
	// Totals and calculations
	/^(sub)?total/i,
	/^grand\s*total/i,
	/^tax/i,
	/^tip/i,
	/^gratuity/i,
	/^service\s*(charge|fee)/i,
	/^delivery\s*(charge|fee)/i,
	/^discount/i,
	/^coupon/i,
	/^promo/i,
	/^savings/i,

	// Payment related
	/^balance/i,
	/^change/i,
	/^cash\s*(back|tend|paid)?/i,
	/^card/i,
	/^visa/i,
	/^master\s*card/i,
	/^amex/i,
	/^discover/i,
	/^credit/i,
	/^debit/i,
	/^payment/i,
	/^paid/i,
	/^amount\s*(due|paid|tend)/i,
	/^tender/i,
	/^chip/i,
	/^swipe/i,
	/^contactless/i,
	/^apple\s*pay/i,
	/^google\s*pay/i,

	// Receipt metadata
	/^thank\s*you/i,
	/^receipt/i,
	/^invoice/i,
	/^order\s*(#|no|num)/i,
	/^table\s*(#|no|num)?/i,
	/^server/i,
	/^cashier/i,
	/^host/i,
	/^guest/i,
	/^check\s*(#|no|num)?/i,
	/^ticket/i,
	/^trans(action)?/i,
	/^ref(erence)?/i,
	/^auth(orization)?/i,
	/^approval/i,
	/^seq(uence)?/i,
	/^batch/i,
	/^terminal/i,
	/^store\s*(#|no|num)?/i,
	/^register/i,
	/^pos/i,

	// Date/time
	/^date/i,
	/^time/i,
	/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i, // Dates like 01/15/2024
	/^\d{1,2}:\d{2}/i, // Times like 12:30

	// Contact info
	/^tel/i,
	/^phone/i,
	/^fax/i,
	/^address/i,
	/^www\./i,
	/^http/i,
	/^@/i,
	/^\d{3}[.\-\s]?\d{3}[.\-\s]?\d{4}/, // Phone numbers

	// Addresses and zip codes
	/\d{5}(-\d{4})?\s*$/, // US zip code at end of line (12345 or 12345-6789)
	/[A-Z]\d[A-Z]\s*\d[A-Z]\d\s*$/i, // Canadian postal code at end (A1A 1A1)
	/^\d+\s+(N\.?|S\.?|E\.?|W\.?|North|South|East|West)?\s*\w+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place)\b/i, // Street addresses
	/,\s*[A-Z]{2}\s+\d{5}/i, // City, ST 12345 pattern

	// Misc
	/^qty/i,
	/^quantity/i,
	/^item/i,
	/^description/i,
	/^price/i,
	/^amount/i,
	/^#\d+/i, // Item numbers like #1, #2
	/^\*+$/i, // Lines of asterisks
	/^-+$/i, // Lines of dashes
	/^=+$/i, // Lines of equals
	/^_+$/i, // Lines of underscores
	/^[*\-=_\s]+$/i, // Separator lines
	/^page\s*\d/i,
	/^reprint/i,
	/^copy/i,
	/^duplicate/i,
	/^void/i,
	/^refund/i,
	/^return/i,
	/^exchange/i,
	/^member/i,
	/^loyalty/i,
	/^points/i,
	/^rewards/i,
	/^earn(ed)?/i
];

function shouldSkipLine(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < 2) return true;
	// Skip lines that are mostly numbers/symbols
	const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
	if (letterCount < 2) return true;
	return SKIP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function extractPrice(text: string): number | null {
	// Try standard format first
	const match = text.match(/\$?([\d,]+\.\d{2})/);
	if (match) {
		return parseFloat(match[1].replace(/,/g, ''));
	}
	// Try normalizing for OCR errors
	const priceMatch = text.match(/\$?([\d,.\s]+)\s*$/);
	if (priceMatch) {
		return normalizePrice(priceMatch[1]);
	}
	return null;
}

// Extract price-like pattern from end of string (handles OCR errors)
// Matches: $12.99, 12.99, 1299, 12 99, etc.
const PRICE_PATTERN = /[$]?([\d]{1,3}[,.]?[\d]{0,3}[\s]?[\d]{2}|\d+\.\d{2}|\d{3,})\s*$/;

// Parse a single line trying different patterns
function parseLine(line: string): ParsedLine | null {
	const trimmed = line.trim();
	if (!trimmed || shouldSkipLine(trimmed)) return null;

	// Pattern 1: "2x Item Name $12.99" or "2 Item Name 1299" (qty at start, x/@ optional)
	// Price is divided by quantity to get per-unit price
	const qtyFirstMatch = trimmed.match(/^(\d{1,2})\s*[x@]?\s+(.+?)\s+[$]?([\d,.\s]+)\s*$/i);
	if (qtyFirstMatch) {
		const quantity = parseInt(qtyFirstMatch[1], 10);
		const name = qtyFirstMatch[2].trim();
		const totalPrice = normalizePrice(qtyFirstMatch[3]);
		if (name && totalPrice !== null && totalPrice > 0 && totalPrice < 1000 && quantity > 0 && !shouldSkipLine(name)) {
			// Divide by quantity to get per-unit price
			const price = Math.round((totalPrice / quantity) * 100) / 100;
			return { name, price, quantity };
		}
	}

	// Pattern 2: "Item Name 2 @ $5.99" or "Item Name x2 599" (requires x or @)
	// Price is divided by quantity to get per-unit price
	const qtyAfterMatch = trimmed.match(/^(.+?)\s+(?:x\s*(\d+)|(\d+)\s*[@x])\s*[$]?([\d,.\s]+)\s*$/i);
	if (qtyAfterMatch) {
		const name = qtyAfterMatch[1].trim();
		const quantity = parseInt(qtyAfterMatch[2] || qtyAfterMatch[3], 10);
		const totalPrice = normalizePrice(qtyAfterMatch[4]);
		if (name && totalPrice !== null && totalPrice > 0 && totalPrice < 1000 && quantity > 0 && !shouldSkipLine(name)) {
			// Divide by quantity to get per-unit price
			const price = Math.round((totalPrice / quantity) * 100) / 100;
			return { name, price, quantity };
		}
	}

	// Pattern 3: "Item Name    $12.99" or "Item Name    1299" (with dollar sign or 2+ spaces)
	const spacedMatch = trimmed.match(/^(.+?)\s{2,}[$]?([\d,.\s]+)\s*$/);
	if (spacedMatch) {
		const name = spacedMatch[1].trim();
		const price = normalizePrice(spacedMatch[2]);
		if (name && price !== null && price > 0 && price < 1000 && !shouldSkipLine(name)) {
			return { name, price, quantity: 1 };
		}
	}

	// Pattern 4: "Item Name $12.99" (with dollar sign, any spacing)
	const dollarMatch = trimmed.match(/^(.+?)\s+\$([\d,.\s]+)\s*$/);
	if (dollarMatch) {
		const name = dollarMatch[1].trim();
		const price = normalizePrice(dollarMatch[2]);
		if (name && price !== null && price > 0 && price < 1000 && !shouldSkipLine(name)) {
			return { name, price, quantity: 1 };
		}
	}

	// Pattern 5: "Item Name 12.90" (decimal price without dollar sign)
	const decimalMatch = trimmed.match(/^(.+?)\s+(\d+\.\d{2})\s*$/);
	if (decimalMatch) {
		const name = decimalMatch[1].trim();
		const price = normalizePrice(decimalMatch[2]);
		if (
			name &&
			name.length >= 2 &&
			price !== null &&
			price > 0 &&
			price < 500 &&
			!shouldSkipLine(name)
		) {
			return { name, price, quantity: 1 };
		}
	}

	// Pattern 6: "Item Name 1299" or other OCR-damaged prices at end of line
	const simpleMatch = trimmed.match(/^(.+?)\s+([\d,.\s]{3,})\s*$/);
	if (simpleMatch) {
		const name = simpleMatch[1].trim();
		const price = normalizePrice(simpleMatch[2]);
		// Be more strict here - name should be reasonable
		if (
			name &&
			name.length >= 2 &&
			price !== null &&
			price > 0 &&
			price < 500 &&
			!shouldSkipLine(name)
		) {
			return { name, price, quantity: 1 };
		}
	}

	return null;
}

// Check if a line is just a price (for multi-line item detection)
function isJustPrice(line: string): number | null {
	const trimmed = line.trim();
	// Match lines that are only a price: $12.99, 12.99, 1299, etc.
	const priceOnlyMatch = trimmed.match(/^[$]?([\d,.\s]+)$/);
	if (priceOnlyMatch) {
		const price = normalizePrice(priceOnlyMatch[1]);
		if (price !== null && price > 0 && price < 1000) {
			return price;
		}
	}
	return null;
}

// Check if a line looks like an item name without a price, with optional quantity
function isNameWithoutPrice(line: string): { name: string; quantity: number } | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.length < 2) return null;
	if (shouldSkipLine(trimmed)) return null;

	// Has at least 2 letters and doesn't end with a price pattern
	const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
	if (letterCount < 2) return null;

	// Check it doesn't already have a price at the end
	const hasPrice = /[$]?[\d,.\s]{3,}\s*$/.test(trimmed) || /\d+\.\d{2}\s*$/.test(trimmed);
	if (hasPrice) return null;

	// Check for quantity prefix: "2x Item Name" or "2 Item Name"
	const qtyPrefixMatch = trimmed.match(/^(\d{1,2})\s*[x@]?\s+(.+)$/i);
	if (qtyPrefixMatch) {
		const quantity = parseInt(qtyPrefixMatch[1], 10);
		const name = qtyPrefixMatch[2].trim();
		if (quantity > 0 && quantity <= 20 && name.length >= 2 && !shouldSkipLine(name)) {
			return { name, quantity };
		}
	}

	return { name: trimmed, quantity: 1 };
}

// Helper to check for multi-line special field (label on one line, value on next)
function checkMultiLineField(
	trimmed: string,
	nextLine: string | undefined,
	labelPatterns: RegExp[]
): number | null {
	for (const pattern of labelPatterns) {
		if (pattern.test(trimmed) && nextLine !== undefined) {
			const price = isJustPrice(nextLine);
			if (price !== null) {
				return price;
			}
		}
	}
	return null;
}

// Matches a line that is just a bare positive integer (standalone quantity, e.g. "2")
function isQtyOnlyLine(line: string): number | null {
	const trimmed = line.trim();
	const match = trimmed.match(/^(\d{1,3})$/);
	if (!match) return null;
	const qty = parseInt(match[1], 10);
	return qty > 0 && qty <= 99 ? qty : null;
}

// Matches lines of the form "N @ $X.XX" or "Nx $X.XX" (quantity + unit price, no name)
function isQtyUnitLine(line: string): { quantity: number; unitPrice: number } | null {
	const trimmed = line.trim();
	const match = trimmed.match(/^(\d{1,3})\s*[@x]\s*\$?([\d,.\s]+)\s*$/i);
	if (!match) return null;
	const quantity = parseInt(match[1], 10);
	const unitPrice = normalizePrice(match[2]);
	if (quantity > 0 && quantity <= 99 && unitPrice !== null && unitPrice > 0 && unitPrice < 1000) {
		return { quantity, unitPrice };
	}
	return null;
}

// Build a ReceiptItem from a completed PendingItem, or null if price is missing
function buildItem(pending: PendingItem): ReceiptItem | null {
	let price: number | null = null;
	if (pending.unitPrice !== null) {
		price = pending.unitPrice;
	} else if (pending.lineTotal !== null) {
		price = Math.round((pending.lineTotal / pending.quantity) * 100) / 100;
	}
	if (price === null || price <= 0) return null;
	return {
		id: generateId(),
		name: pending.name,
		price,
		quantity: pending.quantity,
		assignedTo: []
	};
}

export function parseReceiptText(text: string): ParseResult {
	// Normalize multiple newlines to single newline
	const normalizedText = text.replace(/\n{2,}/g, '\n');
	const lines = normalizedText.split('\n');
	const items: ReceiptItem[] = [];
	let taxAmount: number | null = null;
	let subtotal: number | null = null;
	let total: number | null = null;
	let tipAmount: number | null = null;
	let pending: PendingItem | null = null;
	let qtyStash: number | null = null;

	function flushPending() {
		if (pending !== null) {
			const item = buildItem(pending);
			if (item) {
				console.log('[Parser] Emitting pending item:', item.name, 'qty:', item.quantity, 'price:', item.price);
				items.push(item);
			}
			pending = null;
		}
	}

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : undefined;
		i++;

		if (!trimmed) continue;

		// Check for tax (same line)
		if (taxAmount === null) {
			let matched = false;
			for (const pattern of TAX_PATTERNS) {
				const match = trimmed.match(pattern);
				if (match) {
					const value = normalizePrice(match[1]);
					if (value !== null && value > 0 && value < 1000) {
						taxAmount = value;
						flushPending();
						console.log('[Parser] Found tax:', taxAmount, 'from line:', trimmed);
					}
					matched = true;
					break;
				}
			}
			// Check for tax (multi-line)
			if (!matched) {
				const multiLineValue = checkMultiLineField(trimmed, nextLine, TAX_LABEL_PATTERNS);
				if (multiLineValue !== null) {
					taxAmount = multiLineValue;
					flushPending();
					i++;
					console.log('[Parser] Found multi-line tax:', taxAmount);
					continue;
				}
			}
		}

		// Check for subtotal (same line)
		if (subtotal === null) {
			let matched = false;
			for (const pattern of SUBTOTAL_PATTERNS) {
				const match = trimmed.match(pattern);
				if (match) {
					const value = normalizePrice(match[1]);
					if (value !== null && value > 0) {
						subtotal = value;
						flushPending();
						console.log('[Parser] Found subtotal:', subtotal, 'from line:', trimmed);
					}
					matched = true;
					break;
				}
			}
			// Check for subtotal (multi-line)
			if (!matched) {
				const multiLineValue = checkMultiLineField(trimmed, nextLine, SUBTOTAL_LABEL_PATTERNS);
				if (multiLineValue !== null) {
					subtotal = multiLineValue;
					flushPending();
					i++;
					console.log('[Parser] Found multi-line subtotal:', subtotal);
					continue;
				}
			}
		}

		// Check for total (same line)
		if (total === null) {
			let matched = false;
			for (const pattern of TOTAL_PATTERNS) {
				const match = trimmed.match(pattern);
				if (match) {
					const value = normalizePrice(match[1]);
					if (value !== null && value > 0) {
						total = value;
						flushPending();
						console.log('[Parser] Found total:', total, 'from line:', trimmed);
					}
					matched = true;
					break;
				}
			}
			// Check for total (multi-line)
			if (!matched) {
				const multiLineValue = checkMultiLineField(trimmed, nextLine, TOTAL_LABEL_PATTERNS);
				if (multiLineValue !== null) {
					total = multiLineValue;
					flushPending();
					i++;
					console.log('[Parser] Found multi-line total:', total);
					continue;
				}
			}
		}

		// Check for tip (same line)
		if (tipAmount === null) {
			let matched = false;
			for (const pattern of TIP_PATTERNS) {
				const match = trimmed.match(pattern);
				if (match) {
					const value = normalizePrice(match[1]);
					if (value !== null && value > 0 && value < 1000) {
						tipAmount = value;
						flushPending();
						console.log('[Parser] Found tip:', tipAmount, 'from line:', trimmed);
					}
					matched = true;
					break;
				}
			}
			// Check for tip (multi-line)
			if (!matched) {
				const multiLineValue = checkMultiLineField(trimmed, nextLine, TIP_LABEL_PATTERNS);
				if (multiLineValue !== null) {
					tipAmount = multiLineValue;
					flushPending();
					i++;
					console.log('[Parser] Found multi-line tip:', tipAmount);
					continue;
				}
			}
		}

		// 1. Try full single-line item parse first
		const parsed = parseLine(line);
		if (parsed) {
			flushPending();
			items.push({
				id: generateId(),
				name: parsed.name,
				price: parsed.price,
				quantity: parsed.quantity,
				assignedTo: []
			});
			continue;
		}

		// 2. Qty @ unitPrice line (e.g. "1 @ $7.99", "2x $5.00") — attaches to pending item
		const qtyUnit = isQtyUnitLine(trimmed);
		if (qtyUnit !== null) {
			if (pending !== null) {
				pending.quantity = qtyUnit.quantity;
				pending.unitPrice = qtyUnit.unitPrice;
				console.log('[Parser] Updated pending qty:', pending.quantity, 'unitPrice:', pending.unitPrice);
			}
			continue;
		}

		// 2.5. Bare integer line (e.g. "2") — quantity, not a price.
		// Use lookahead: if the next line is a name, this qty belongs to that next item;
		// otherwise attach it to the current pending item (or stash it).
		const qtyOnly = isQtyOnlyLine(trimmed);
		if (qtyOnly !== null) {
			const nextIsName = nextLine !== undefined && isNameWithoutPrice(nextLine) !== null;
			if (nextIsName) {
				// Qty precedes a new item name → flush incomplete pending and stash
				flushPending();
				qtyStash = qtyOnly;
			} else if (pending !== null) {
				pending.quantity = qtyOnly;
			} else {
				qtyStash = qtyOnly;
			}
			continue;
		}

		// 3. Price-only line (e.g. "$7.99") — completes the pending item
		const priceOnly = isJustPrice(trimmed);
		if (priceOnly !== null) {
			if (pending !== null) {
				pending.lineTotal = priceOnly;
				flushPending();
			}
			continue;
		}

		// 4. Name-only line — append to name if pending has no price yet, otherwise start fresh
		const nameResult = isNameWithoutPrice(line);
		if (nameResult !== null) {
			if (qtyStash !== null || pending === null) {
				// A stashed qty signals a new item block, or there's simply no pending item
				flushPending();
				pending = { name: nameResult.name, quantity: qtyStash ?? nameResult.quantity, unitPrice: null, lineTotal: null };
				qtyStash = null;
			} else {
				// Pending item exists but has no price yet — this is a continuation of the name
				pending.name += ' ' + nameResult.name;
			}
			console.log('[Parser] Item name now:', pending.name);
			continue;
		}

		// 5. Unrecognized line — leave pending intact to tolerate noise between name and price
	}

	flushPending();
	console.log('[Parser] Parsed', items.length, 'items, tax:', taxAmount, 'subtotal:', subtotal, 'total:', total, 'tip:', tipAmount);

	return { items, taxAmount, subtotal, total, tipAmount };
}

// Utility to format price for display
export function formatPrice(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

// Utility to parse price from string input
export function parsePrice(input: string): number {
	const cleaned = input.replace(/[$,\s]/g, '');
	const parsed = parseFloat(cleaned);
	return isNaN(parsed) ? 0 : Math.max(0, parsed);
}
