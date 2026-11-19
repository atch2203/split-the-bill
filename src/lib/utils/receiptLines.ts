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
	const match = trimmed.match(/^(\d{1,3})\s*[@x]\s*\$?([\d,.\s]+)\s*$/i);
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

export type SummaryField = 'tax' | 'subtotal' | 'total' | 'tip';

/** What one receipt line is, on its own. `parseReceiptText` combines these. */
export type ReceiptLine =
	/** Tax/subtotal/total/tip; `value` null = label only (value may be on the next line). */
	| { kind: 'summary'; field: SummaryField; value: number | null }
	/** A complete item; `price` is the unit price. */
	| { kind: 'item'; name: string; quantity: number; price: number }
	/** "3 @ 0.25": quantity and unit price for the item above. */
	| { kind: 'qtyUnit'; quantity: number; unitPrice: number }
	/** A bare quantity ("2"). */
	| { kind: 'qty'; quantity: number }
	/** A price alone (an item code before it is allowed). */
	| { kind: 'price'; price: number }
	/** An item name (or part of one) without a price. */
	| { kind: 'name'; name: string; quantity: number }
	/** Blank, header/footer noise, or unrecognized. */
	| { kind: 'other' };

const SUMMARY: { field: SummaryField; patterns: RegExp[]; labels: RegExp[]; max?: number }[] = [
	{ field: 'tax', patterns: TAX_PATTERNS, labels: TAX_LABEL_PATTERNS, max: 1000 },
	{ field: 'subtotal', patterns: SUBTOTAL_PATTERNS, labels: SUBTOTAL_LABEL_PATTERNS },
	{ field: 'total', patterns: TOTAL_PATTERNS, labels: TOTAL_LABEL_PATTERNS },
	{ field: 'tip', patterns: TIP_PATTERNS, labels: TIP_LABEL_PATTERNS, max: 1000 }
];

export function classifyLine(raw: string): ReceiptLine {
	const trimmed = raw.trim();
	if (!trimmed) return { kind: 'other' };

	for (const { field, patterns, labels, max } of SUMMARY) {
		const m = patterns.map((p) => trimmed.match(p)).find((x) => x);
		if (m) {
			const value = normalizePrice(m[1]);
			if (value !== null && value > 0 && (max === undefined || value < max)) {
				return { kind: 'summary', field, value };
			}
			continue;
		}
		if (labels.some((p) => p.test(trimmed))) return { kind: 'summary', field, value: null };
	}

	const line = stripItemCodes(trimmed);
	if (!line) return { kind: 'other' };
	const item = parseLine(line);
	if (item) return { kind: 'item', name: item.name, quantity: item.quantity, price: item.price };
	const qtyUnit = isQtyUnitLine(line);
	if (qtyUnit) return { kind: 'qtyUnit', ...qtyUnit };
	const qty = isQtyOnlyLine(line);
	if (qty !== null) return { kind: 'qty', quantity: qty };
	const price = isJustPrice(line);
	if (price !== null) return { kind: 'price', price };
	const name = isNameWithoutPrice(line);
	if (name) return { kind: 'name', ...name };
	return { kind: 'other' };
}
