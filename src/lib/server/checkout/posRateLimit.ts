import { isD1DailyLimit } from '../d1DailyLimit';
import { consumeRateLimit } from '../rateLimit';

/** Hanya kuota harian eksplisit boleh memicu antrean POS; penolakan lain tetap fail-closed. */
export async function consumePosRateLimit(...args: Parameters<typeof consumeRateLimit>) {
	const result = await consumeRateLimit(...args);
	if (!result.available && isD1DailyLimit(result.unavailableCause)) throw result.unavailableCause;
	return result;
}
