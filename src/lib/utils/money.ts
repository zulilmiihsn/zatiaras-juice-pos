/** Decode angka mesin/queue legacy, bukan input Rupiah berformat locale atau JSON coercion. */
export function decodeDecimalNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
	const amount = Number(text);
	return Number.isFinite(amount) ? amount : null;
}

export type DecodedMoneyAmount =
	{ ok: true; amount: number } | { ok: false; reason: 'invalid' | 'negative' | 'unsafe' };

/** Only decoded decimal strings reach this comparison; do not expand exponent-sized buffers. */
function exceedsExactMoneyMaximum(text: string): boolean {
	const [mantissa, exponent = '0'] = text.split(/[eE]/);
	const fractionLength = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0;
	const digits = mantissa.replace(/[+.-]/g, '').replace(/^0+/, '');
	const point = digits.length + Number(exponent) - fractionLength;
	const maximum = String(Number.MAX_SAFE_INTEGER);
	if (point > maximum.length) return true;
	if (point < maximum.length) return false;
	const integer = digits.slice(0, point).padEnd(point, '0');
	return integer > maximum || (integer === maximum && /[1-9]/.test(digits.slice(point)));
}

/** Shared write/AI range guard, before normalization can erase the original string boundary. */
export function decodeMoneyAmount(value: unknown): DecodedMoneyAmount {
	const amount = decodeDecimalNumber(value);
	if (amount === null) return { ok: false, reason: 'invalid' };
	const text = typeof value === 'string' ? value.trim() : null;
	// Negative underflow and maximum+fraction otherwise lose their violation in Number(text).
	const negativeUnderflow =
		text !== null && amount === 0 && text.startsWith('-') && /[1-9]/.test(text.split(/[eE]/)[0]);
	if (amount < 0 || negativeUnderflow) return { ok: false, reason: 'negative' };
	if (
		amount > Number.MAX_SAFE_INTEGER ||
		(text !== null && amount === Number.MAX_SAFE_INTEGER && exceedsExactMoneyMaximum(text))
	)
		return { ok: false, reason: 'unsafe' };
	return { ok: true, amount: amount === 0 ? 0 : amount };
}

/** Policy rupiah kanonik; boundary tulis harus menolak input invalid sebelum normalisasi. */
export function normalizeMoney(value: unknown): number {
	const amount = Number(value);
	if (!Number.isFinite(amount) || amount < 0) return 0;
	return Math.round(amount);
}

/** HPP mempertahankan empat desimal; jangan memakai pembulatan rupiah untuk biaya satuan. */
export function normalizeCost(value: unknown): number {
	const amount = Number(value);
	if (!Number.isFinite(amount) || amount < 0) return 0;
	return Math.round(amount * 10000) / 10000;
}

export function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}
