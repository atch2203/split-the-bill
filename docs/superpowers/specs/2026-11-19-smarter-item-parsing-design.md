# Smarter Item Parsing

Date: 2026-11-19
Status: Approved (approach 2: tag lines, then combine)

## Intent

OCR text is now reliable, but `parseReceiptText` (`src/lib/utils/receiptParser.ts`)
misreads receipts with unusual layouts. Two known failures:

- `6 pc chicken nuggets  7.99` becomes "chicken nuggets" ×6 at $1.33. The size `6 pc`
  is read as a quantity.
- An item ID on the line under the name is dropped, and the item is lost:
  ```
  really long item name
  12354384      253.24
  ```

The goal is a parser that understands line structure, so these and similar
layouts parse correctly and new layouts are cheap to add.

## Approaches considered

1. Patch the two cases with more regexes. Fast, but the rule pile keeps growing.
2. **Tag each line's tokens, give each line a type, then combine lines. (Chosen.)**
3. Use the scanner's box geometry (price column). Only helps scanned input; possible
   later on top of 2.

A subtotal-consistency check was offered and declined.

## Design

1. **Characterization tests first.** `src/lib/utils/receiptParser.test.ts` with
   fixtures for every current behaviour: OCR-damaged prices, quantity first/after,
   bare-quantity lines, `N @ price` lines, multi-line names, tax/subtotal/total/tip
   on one line or label-then-value, skip patterns. The two known failures are added
   as tests. The rewrite must keep all existing fixtures passing.
2. **Line tagging** in `src/lib/utils/receiptLines.ts`. Tokens:
   - price (`7.99`, `$7.99`, OCR-damaged forms via today's `normalizePrice`);
   - quantity (`2x`, `x2`, `2 @`, or a small leading integer not followed by a unit);
   - size (number + unit: `pc`, `pcs`, `piece(s)`, `ct`, `pk`, `pack`, `oz`, `lb`,
     `lbs`, `g`, `kg`, `ml`, `l`, `in`, `"`) which stays in the name;
   - code (5+ digits, no decimal point), dropped;
   - words.
   Line types: summary (tax/subtotal/total/tip, with or without value), skip, item
   (name + price), name, price (price alone, optionally after a code), qty, qty@price.
3. **Combining** in `parseReceiptText` walks typed lines with today's rules, plus:
   a size never becomes a quantity; a code + price line acts as a price line.
4. `parseReceiptText(text): ParseResult` is unchanged; no caller changes.

## Non-goals

Subtotal check, box geometry, discounts / negative prices, trailing tax-flag letters
(`7.99 T`).

## Test data

No public US receipt dataset with item-level labels was found. CORD (CC BY 4.0) is
Indonesian with no-cent prices, so it doesn't match. Fixtures are hand-written,
modelled on common US POS layouts; the user's real problem receipts are added as
they come.
