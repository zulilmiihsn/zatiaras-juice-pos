// Revision is a control token, not money: missing/coerced/unsafe values cannot authorize an increment.
export function decodeLedgerRevision(value: unknown): number | null {
	return typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value < Number.MAX_SAFE_INTEGER
		? value
		: null;
}
