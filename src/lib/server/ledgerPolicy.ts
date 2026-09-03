export function containsPosLedger(rows: ReadonlyArray<{ sumber?: unknown }>): boolean {
	return rows.some((row) => String(row.sumber || '').toLowerCase() === 'pos');
}

export const POS_LEDGER_ROUTE_MESSAGE =
	'Ledger POS hanya boleh diubah lewat /api/transaksi-kasir?transaction_id=...';
