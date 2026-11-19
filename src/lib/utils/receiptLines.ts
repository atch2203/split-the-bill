import { levenshtein } from '../ocr/text';
// Line-level receipt analysis: price repair, summary/skip patterns, and
// classifying one line into a kind that parseReceiptText combines.

interface ParsedLine {
	name: string;
	price: number;
	quantity: number;
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

	// 1-2 digits are whole dollars only with a "$"; a bare "44" is usually a
	// register/table number, not a price.
	if (/^\d{1,2}$/.test(cleaned)) {
		if (!priceStr.includes('$')) return null;
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
	/^sub\s*-?\s*total\s*\(\d+\)\s*:?\s*\$?([\d,.\s]+)/i, // "Subtotal (7)  60.83" (item count)
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
	/^balance\s*due\s*:?\s*\$?([\d,.\s]+)/i,
	/^balance\s*:?\s*\$?([\d,.\s]+)/i
];

const TOTAL_LABEL_PATTERNS = [/^(grand\s*)?total\s*:?\s*$/i, /^amount\s*due\s*:?\s*$/i, /^balance\s*due\s*:?\s*$/i];

// Patterns that indicate TIP line
const TIP_PATTERNS = [
	/^tip\s*:?\s*\$?([\d,.\s]+)/i,
	/^gratuity\s*:?\s*\$?([\d,.\s]+)/i,
	// Service charges added in place of a tip: "Charge(20%): $30.32", "Large Party (18.00%) $14.90".
	/^(?:service\s*charge|charge|large\s*party|auto\s*grat\w*)\b.*?\s\$?(\d+[.,]\d{2})$/i
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

// A number followed by one of these is a size ("6 pc", "12 oz"), not a quantity.
const SIZE_UNIT = String.raw`(?:pcs?|pieces?|ct|pk|packs?|oz|lbs?|g|kg|ml|l|in)\b`;
// "2 Burger 25.98", "3x Taco 9.00" — but not "6 pc nuggets 7.99".
const QTY_FIRST_ITEM = new RegExp(
	String.raw`^(\d{1,2})\s*[x@]?\s+(?!${SIZE_UNIT})(.+?)\s+[$]?([\d,.\s]+)\s*$`,
	'i'
);
// "2 Iced Tea", "2x Iced Tea" — but not "6 pc nuggets".
const QTY_FIRST_NAME = new RegExp(String.raw`^(\d{1,2})\s*[x@]?\s+(?!${SIZE_UNIT})(.+)$`, 'i');

// Parse a single line trying different patterns
function parseLine(line: string): ParsedLine | null {
	const trimmed = line.trim();
	if (!trimmed || shouldSkipLine(trimmed)) return null;

	// Pattern 1: "2x Item Name $12.99" or "2 Item Name 1299" (qty at start, x/@ optional)
	// Price is divided by quantity to get per-unit price
	const qtyFirstMatch = trimmed.match(QTY_FIRST_ITEM);
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
	// A price alone on its line must show cents or a "$": a bare "1403" is
	// more likely a suite number or other header noise than a price.
	if (!/[.,]\d{2}\s*$/.test(trimmed) && !trimmed.startsWith('$')) return null;
	// Match lines that are only a price: $12.99, 12.99, $12, etc.
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
	const qtyPrefixMatch = trimmed.match(QTY_FIRST_NAME);
	if (qtyPrefixMatch) {
		const quantity = parseInt(qtyPrefixMatch[1], 10);
		const name = qtyPrefixMatch[2].trim();
		if (quantity > 0 && quantity <= 20 && name.length >= 2 && !shouldSkipLine(name)) {
			return { name, quantity };
		}
	}

	return { name: trimmed, quantity: 1 };
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
	// "3 @ 0.25", or with the line total after it: "2 @ $2.50   $5.00".
	const match =
		trimmed.match(/^(\d{1,3})\s*[@x]\s*\$?(\d+[.,]\d{2})\s+\$?\d+[.,]\d{2}\s*$/i) ??
		trimmed.match(/^(\d{1,3})\s*[@x]\s*\$?([\d,.\s]+)\s*$/i);
	if (!match) return null;
	const quantity = parseInt(match[1], 10);
	const unitPrice = normalizePrice(match[2]);
	if (quantity > 0 && quantity <= 99 && unitPrice !== null && unitPrice > 0 && unitPrice < 1000) {
		return { quantity, unitPrice };
	}
	return null;
}

/**
 * Removes item codes (UPC/SKU: 5+ digits, no decimal point) anywhere except the
 * last token, which is where a price (possibly OCR-damaged, like "1299") sits.
 * Whitespace runs are kept so "name   price" spacing survives.
 */
export function stripItemCodes(line: string): string {
	const parts = line.split(/(\s+)/);
	let last = parts.length - 1;
	while (last >= 0 && !parts[last].trim()) last--;
	for (let i = 0; i < last; i++) {
		if (/^\d{5,}$/.test(parts[i])) parts[i] = '';
	}
	return parts.join('').trim();
}

/** A 1–2 letter tax/department flag after the price ("3.48 N", "12.49 TX"), or one digit (an "S" misread as "5"). */
const TRAILING_FLAG = /(\d[.,]\d{2})\s+(?:[A-Z]{1,2}|\d)$/;
/** Two prices at the end ("Price  You Pay", "unit  total"): the last one is what's paid. */
const TWO_PRICES = /(\$?\d+[.,]\d{2})\s+(\$?\d+[.,]\d{2})$/;

/** Drops a trailing flag, then keeps only the last of two trailing prices. */
export function cleanPriceTail(line: string): string {
	const flagless = line.replace(TRAILING_FLAG, '$1');
	// "2 @ $2.50  $5.00" keeps both: the unit price is the one that matters there.
	return /\d\s*@\s*\$?\d/.test(flagless) ? flagless : flagless.replace(TWO_PRICES, '  $2');
}

/** Dates, times, percentages and asterisks before a summary label. */
const SUMMARY_PREFIX = /^(?:[\d/:.,%*()#-]+(?:[ap]m?)?\s*)+(?=[a-z])/i;

/** A menu number after the optional quantity: "M5", "C13.", "H21a.", "A19.", "99." */
const MENU_CODE = /^(\d{1,2}\s+)?(?:[A-Z]{1,2}\d{1,3}[a-z]?\.?|\d{1,3}\.)(?=\s|[A-Za-z])\s*/;

/** Removes a menu number ("2 99.BBQ Pork" → "2 BBQ Pork", "M5 Tofu" → "Tofu"). */
export function stripMenuCode(line: string): string {
	return line.replace(MENU_CODE, '$1').trim();
}

/** The line starts with a quantity (not a size like "6 pc"). */
const QTY_PREFIX = new RegExp(String.raw`^\d{1,2}\s*[x@]?\s+(?!${SIZE_UNIT})\D`, 'i');
/** Quantity, at most a 2-character scrap, then a price: "1 M5   16.95" after code removal. */
const QTY_PRICE = /^(\d{1,2})\s+(?:(?![@x]\s)\S{1,2}\s+)?\$?(\d+[.,]\d{2})$/i;

/** Add-on prefixes: "+ Oat Milk", "Add Bacon", "w/ Cream Cheese"; "- No Onion" (free). */
const MODIFIER = /^(?:(\+|add\b|w\/)|(-)(?=\s*[a-z]))\s*(.+)$/i;

function parseModifier(line: string): ReceiptLine | null {
	const m = line.match(MODIFIER);
	if (!m) return null;
	const sign = m[2] ? '-' : '+';
	const rest = m[3].trim();
	const priced = rest.match(/^(.+?)\s+\$?(\d+[.,]\d{2})$/);
	const name = (priced ? priced[1] : rest).trim();
	if ((name.match(/[a-z]/gi) ?? []).length < 2) return null;
	const price = priced ? normalizePrice(priced[2]) : null;
	return { kind: 'modifier', sign, name, price };
}

export type SummaryField = 'tax' | 'subtotal' | 'total' | 'tip';

/** What one receipt line is, on its own. `parseReceiptText` combines these. */
export type ReceiptLine =
	/** Tax/subtotal/total/tip; `value` null = label only (value may be on the next line). */
	| { kind: 'summary'; field: SummaryField; value: number | null }
	/** A complete item; `price` is the unit price. `hasQty`: the line starts with a quantity. */
	| { kind: 'item'; name: string; quantity: number; price: number; hasQty: boolean }
	/** "1 M5   16.95": quantity and line total, the name is on the next line. */
	| { kind: 'qtyPrice'; quantity: number; price: number }
	/** "3 @ 0.25": quantity and unit price for the item above. */
	| { kind: 'qtyUnit'; quantity: number; unitPrice: number }
	/** A bare quantity ("2"). */
	| { kind: 'qty'; quantity: number }
	/** A price alone (an item code before it is allowed). */
	| { kind: 'price'; price: number }
	/** An item name (or part of one) without a price. */
	| { kind: 'name'; name: string; quantity: number; hasQty: boolean }
	/** "+ Oat Milk 0.75", "- No Onion": belongs to the item above. `price` null = free. */
	| { kind: 'modifier'; sign: '+' | '-'; name: string; price: number | null }
	/** Blank, header/footer noise, or unrecognized. */
	| { kind: 'other' };

const SUMMARY: { field: SummaryField; patterns: RegExp[]; labels: RegExp[]; max?: number }[] = [
	{ field: 'tax', patterns: TAX_PATTERNS, labels: TAX_LABEL_PATTERNS, max: 1000 },
	{ field: 'subtotal', patterns: SUBTOTAL_PATTERNS, labels: SUBTOTAL_LABEL_PATTERNS },
	{ field: 'total', patterns: TOTAL_PATTERNS, labels: TOTAL_LABEL_PATTERNS },
	{ field: 'tip', patterns: TIP_PATTERNS, labels: TIP_LABEL_PATTERNS, max: 1000 }
];

/**
 * "1Thunderbird" (glued) and "I Pad Thai" / "l Gumbo" (1 misread) at the start
 * of a line become "1 Thunderbird", "1 Pad Thai".
 */
export function fixQtyMisreads(line: string): string {
	return line.replace(/^(\d)(?=[A-Z][a-z])/, '$1 ').replace(/^[Il|]\s+(?=[A-Z])/, '1 ');
}

const SUMMARY_WORDS: { word: string; field: SummaryField; maxDist: number }[] = [
	{ word: 'subtotal', field: 'subtotal', maxDist: 2 },
	{ word: 'total', field: 'total', maxDist: 1 }
];

/** "SubTural:  69.55", "TOTAI  12.00": a label OCR garbled, followed by a price. */
function fuzzySummary(label: string): ReceiptLine | null {
	const m = label.match(/^([a-z ]{4,12}):?\s+\$?(\d+[.,]\d{2})$/i);
	if (!m) return null;
	const word = m[1].replace(/\s/g, '').toLowerCase();
	for (const s of SUMMARY_WORDS) {
		if (levenshtein(word, s.word) <= s.maxDist) {
			const value = normalizePrice(m[2]);
			return value !== null && value > 0 ? { kind: 'summary', field: s.field, value } : null;
		}
	}
	return null;
}

export function classifyLine(raw: string): ReceiptLine {
	const trimmed = raw.trim();
	if (!trimmed) return { kind: 'other' };

	// "07/04 21:17 TOTAL: 463.45", "18% TIP 70.70", "**** BALANCE 49.23"
	const label = trimmed.replace(SUMMARY_PREFIX, '');
	for (const { field, patterns, labels, max } of SUMMARY) {
		const m = patterns.map((p) => label.match(p)).find((x) => x);
		if (m) {
			const value = normalizePrice(m[1]);
			if (value !== null && value > 0 && (max === undefined || value < max)) {
				return { kind: 'summary', field, value };
			}
			continue;
		}
		if (labels.some((p) => p.test(label))) return { kind: 'summary', field, value: null };
	}

	const fuzzy = fuzzySummary(label);
	if (fuzzy) return fuzzy;

	const line = fixQtyMisreads(stripMenuCode(stripItemCodes(cleanPriceTail(trimmed))));
	if (!line) return { kind: 'other' };
	const hasQty = QTY_PREFIX.test(line);
	const qp = line.match(QTY_PRICE);
	if (qp) {
		const total = normalizePrice(qp[2]);
		const quantity = parseInt(qp[1], 10);
		if (total !== null && total > 0 && quantity > 0) return { kind: 'qtyPrice', quantity, price: total };
	}
	const modifier = parseModifier(line);
	if (modifier) return modifier;
	const item = parseLine(line);
	if (item) return { kind: 'item', name: item.name, quantity: item.quantity, price: item.price, hasQty };
	const qtyUnit = isQtyUnitLine(line);
	if (qtyUnit) return { kind: 'qtyUnit', ...qtyUnit };
	const qty = isQtyOnlyLine(line);
	if (qty !== null) return { kind: 'qty', quantity: qty };
	const price = isJustPrice(line);
	if (price !== null) return { kind: 'price', price };
	const name = isNameWithoutPrice(line);
	if (name) return { kind: 'name', ...name, hasQty };
	return { kind: 'other' };
}
