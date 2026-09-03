export const PAYMENT = {
	QUICK_AMOUNTS: [5_000, 10_000, 20_000, 50_000, 100_000]
} as const;

export const NOTIF = {
	AUTO_DISMISS_MS: 2_000,
	TOAST_MS: 3_000
} as const;

export const POS_SKELETON = {
	MOBILE: 6,
	TABLET: 9,
	DESKTOP: 12
} as const;
