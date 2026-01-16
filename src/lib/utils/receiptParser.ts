import type { ReceiptItem } from '$lib/types';

interface ParsedLine {
	name: string;
	price: number;
	quantity: number;
}

export interface ParseResult {
	items: ReceiptItem[];
	taxAmount: number | null;
	subtotal: number | null;
	total: number | null;
}

// Generate unique ID
function generateId(): string {
	return Math.random().toString(36).substring(2, 9);
}

// Patterns that indicate TAX line (we want to extract this value)
const TAX_PATTERNS = [
	/^tax\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^sales\s*tax\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^hst\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^gst\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^pst\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^vat\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^tax\s+\$?([\d,]+\.?\d*)/i,
	/tax\s*\$?([\d,]+\.\d{2})\s*$/i
];

// Patterns that indicate SUBTOTAL line
const SUBTOTAL_PATTERNS = [
	/^sub\s*-?\s*total\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^subtotal\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^sub\s+\$?([\d,]+\.?\d*)/i
];

// Patterns that indicate TOTAL line
const TOTAL_PATTERNS = [
	/^total\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^grand\s*total\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^amount\s*due\s*:?\s*\$?([\d,]+\.?\d*)/i,
	/^balance\s*due\s*:?\s*\$?([\d,]+\.?\d*)/i
];

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
	const match = text.match(/\$?([\d,]+\.\d{2})/);
	if (match) {
		return parseFloat(match[1].replace(/,/g, ''));
	}
	return null;
}

// Parse a single line trying different patterns
function parseLine(line: string): ParsedLine | null {
	const trimmed = line.trim();
	if (!trimmed || shouldSkipLine(trimmed)) return null;

	// Pattern 1: "2x Item Name $12.99" or "2 x Item Name $12.99"
	const qtyFirstMatch = trimmed.match(/^(\d+)\s*[x@]\s*(.+?)\s+\$?([\d,]+\.?\d*)\s*$/i);
	if (qtyFirstMatch) {
		const quantity = parseInt(qtyFirstMatch[1], 10);
		const name = qtyFirstMatch[2].trim();
		const price = parseFloat(qtyFirstMatch[3].replace(/,/g, ''));
		if (name && !isNaN(price) && price > 0) {
			return { name, price, quantity };
		}
	}

	// Pattern 2: "Item Name 2 @ $5.99" or "Item Name x2 $5.99"
	const qtyAfterMatch = trimmed.match(/^(.+?)\s+[x@]?\s*(\d+)\s*[@x]?\s*\$?([\d,]+\.?\d*)\s*$/i);
	if (qtyAfterMatch) {
		const name = qtyAfterMatch[1].trim();
		const quantity = parseInt(qtyAfterMatch[2], 10);
		const price = parseFloat(qtyAfterMatch[3].replace(/,/g, ''));
		if (name && !isNaN(price) && price > 0 && quantity > 0 && !shouldSkipLine(name)) {
			return { name, price, quantity };
		}
	}

	// Pattern 3: "Item Name    $12.99" (with dollar sign)
	const dollarMatch = trimmed.match(/^(.+?)\s+\$([\d,]+\.?\d*)\s*$/);
	if (dollarMatch) {
		const name = dollarMatch[1].trim();
		const price = parseFloat(dollarMatch[2].replace(/,/g, ''));
		if (name && !isNaN(price) && price > 0 && !shouldSkipLine(name)) {
			return { name, price, quantity: 1 };
		}
	}

	// Pattern 4: "Item Name    12.99" (without dollar sign, 2+ spaces)
	const spacedMatch = trimmed.match(/^(.+?)\s{2,}([\d,]+\.\d{2})\s*$/);
	if (spacedMatch) {
		const name = spacedMatch[1].trim();
		const price = parseFloat(spacedMatch[2].replace(/,/g, ''));
		if (name && !isNaN(price) && price > 0 && !shouldSkipLine(name)) {
			return { name, price, quantity: 1 };
		}
	}

	// Pattern 5: Simple "Item Name 12.99" at end of line
	const simpleMatch = trimmed.match(/^(.+?)\s+([\d,]+\.\d{2})\s*$/);
	if (simpleMatch) {
		const name = simpleMatch[1].trim();
		const price = parseFloat(simpleMatch[2].replace(/,/g, ''));
		// Be more strict here - name should be reasonable
		if (
			name &&
			name.length >= 2 &&
			!isNaN(price) &&
			price > 0 &&
			price < 1000 &&
			!shouldSkipLine(name)
		) {
			return { name, price, quantity: 1 };
		}
	}

	return null;
}

export function parseReceiptText(text: string): ParseResult {
	const lines = text.split('\n');
	const items: ReceiptItem[] = [];
	let taxAmount: number | null = null;
	let subtotal: number | null = null;
	let total: number | null = null;

	for (const line of lines) {
		const trimmed = line.trim();

		// Check for tax
		if (taxAmount === null) {
			for (const pattern of TAX_PATTERNS) {
				const match = trimmed.match(pattern);
				if (match) {
					const value = parseFloat(match[1].replace(/,/g, ''));
					if (!isNaN(value) && value > 0 && value < 1000) {
						taxAmount = value;
						console.log('[Parser] Found tax:', taxAmount, 'from line:', trimmed);
					}
					break;
				}
			}
		}

		// Check for subtotal
		if (subtotal === null) {
			for (const pattern of SUBTOTAL_PATTERNS) {
				const match = trimmed.match(pattern);
				if (match) {
					const value = parseFloat(match[1].replace(/,/g, ''));
					if (!isNaN(value) && value > 0) {
						subtotal = value;
						console.log('[Parser] Found subtotal:', subtotal, 'from line:', trimmed);
					}
					break;
				}
			}
		}

		// Check for total
		if (total === null) {
			for (const pattern of TOTAL_PATTERNS) {
				const match = trimmed.match(pattern);
				if (match) {
					const value = parseFloat(match[1].replace(/,/g, ''));
					if (!isNaN(value) && value > 0) {
						total = value;
						console.log('[Parser] Found total:', total, 'from line:', trimmed);
					}
					break;
				}
			}
		}

		// Try to parse as menu item
		const parsed = parseLine(line);
		if (parsed) {
			items.push({
				id: generateId(),
				name: parsed.name,
				price: parsed.price,
				quantity: parsed.quantity,
				assignedTo: []
			});
		}
	}

	console.log('[Parser] Parsed', items.length, 'items, tax:', taxAmount, 'subtotal:', subtotal, 'total:', total);

	return { items, taxAmount, subtotal, total };
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
