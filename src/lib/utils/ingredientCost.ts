export const DEFAULT_INGREDIENT_YIELD_PERCENT = 100;

const roundFourDecimals = (value: number): number => Math.round(value * 10_000) / 10_000;

const parseYieldPercent = (value: unknown): number =>
	typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value);

export function isValidYieldPercent(value: unknown): boolean {
	const parsed = parseYieldPercent(value);
	return Number.isFinite(parsed) && parsed > 0 && parsed <= 100;
}

export function normalizeYieldPercent(value: unknown): number {
	if (!isValidYieldPercent(value)) return DEFAULT_INGREDIENT_YIELD_PERCENT;
	return Math.round(parseYieldPercent(value) * 100) / 100;
}

export function calculateUsableQuantity(purchaseQuantity: unknown, yieldPercent: unknown): number {
	const quantity = Number(purchaseQuantity);
	if (!Number.isFinite(quantity) || quantity <= 0) return 0;
	return roundFourDecimals(quantity * (normalizeYieldPercent(yieldPercent) / 100));
}

export function calculateEffectiveUnitCost(
	purchaseCost: unknown,
	purchaseQuantity: unknown,
	yieldPercent: unknown
): number {
	const cost = Number(purchaseCost);
	if (!Number.isFinite(cost) || cost <= 0) return 0;
	const usableQuantity = calculateUsableQuantity(purchaseQuantity, yieldPercent);
	if (usableQuantity <= 0) return 0;
	return roundFourDecimals(cost / usableQuantity);
}
