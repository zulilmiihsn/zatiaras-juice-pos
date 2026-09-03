import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

declare global {
	namespace App {
		interface Locals {
			authSession: {
				id: string;
				userId: string;
				username: string;
				role: string;
				branch?: string;
				createdAt: number;
				expiresAt: number;
				unlockedPages: string[];
				unlockExpiresAt: number;
			} | null;
		}

		interface Platform {
			env: {
				DB?: D1Database;
				DB_SAMARINDA_GROUP?: D1Database;
				DB_BALIKPAPAN_GROUP?: D1Database;
				DB_BERAU_GROUP?: D1Database;
				STORAGE?: R2Bucket;
				// [CATATAN]: DurableObjectNamespace dibiarkan longgar: tipe Cloudflare-nya menyeret
				// [CATATAN]: signature fetch/Request CF yang bentrok dengan DOM Request di publisher.
				REALTIME_HUB?: {
					idFromName(nama: string): unknown;
					get(id: unknown): { fetch(request: Request): Promise<Response> };
				};
				R2_PUBLIC_URL?: string;
				POS_PRICE_SIGNING_KEY?: string;
				POS_PRICE_SIGNING_KEY_ID?: string;
				POS_PRICE_SIGNING_KEY_PREVIOUS?: string;
				POS_PRICE_SIGNING_KEY_PREVIOUS_ID?: string;
			};
		}
	}

	// [CATATAN]: Declare pwa-install web component
	namespace JSX {
		interface IntrinsicElements {
			'pwa-install': unknown;
		}
	}
}

export {};
