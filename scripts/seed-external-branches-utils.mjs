/**
 * Parse optional product extras without silently dropping malformed catalog data.
 * @param {unknown} raw
 * @param {string} productName
 * @returns {string[]}
 */
export function parseExtraIds(raw, productName) {
	if (raw === null || raw === undefined || raw === '') return [];

	let parsed = raw;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch (cause) {
			throw new Error(`Data ekstra untuk produk ${productName} tidak valid; seed dibatalkan.`, {
				cause
			});
		}
	}

	if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
		throw new Error(`Format data ekstra untuk produk ${productName} tidak valid; seed dibatalkan.`);
	}
	return parsed;
}
