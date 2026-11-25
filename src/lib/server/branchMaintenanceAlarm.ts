import type { DurableObjectStorage } from '@cloudflare/workers-types';
import realtime from './realtimeWorker.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DAILY_OFFSET = 3 * HOUR;

/** A separate instance keeps maintenance IO and its retries away from committed cashier writes. */
export class BranchMaintenanceAlarm {
	constructor(
		private readonly state: {
			storage: Pick<DurableObjectStorage, 'getAlarm' | 'setAlarm'> & {
				get<T>(key: string): Promise<T | undefined>;
				put<T>(key: string, value: T): Promise<void>;
			};
		},
		private readonly env: Record<string, unknown>
	) {}

	async fetch(request: Request) {
		if (
			request.method !== 'POST' ||
			request.url !== 'https://maintenance.internal/start' ||
			this.env.BRANCH_ACCOUNT_MODE !== 'backend'
		)
			return new Response(null, { status: 404 });
		if ((await this.state.storage.getAlarm()) === null)
			await this.state.storage.setAlarm(this.nextHour(Date.now()));
		return new Response(null, { status: 204 });
	}

	async alarm() {
		if (this.env.BRANCH_ACCOUNT_MODE !== 'backend') return;
		const now = Date.now();
		// Reserve the next tick before D1 IO; a quota or runtime failure must not stop future maintenance.
		await this.state.storage.setAlarm(this.nextHour(now));
		const day = Math.floor((now - DAILY_OFFSET) / DAY);
		const daily = (await this.state.storage.get<number>('retention:day')) !== day;
		const report = await realtime.scheduled(
			{ cron: daily ? '0 3 * * *' : '* * * * *', scheduledTime: now },
			this.env
		);
		if (daily && report && report.missingBindings === 0)
			await this.state.storage.put('retention:day', day);
	}

	private nextHour(now: number) {
		return (Math.floor(now / HOUR) + 1) * HOUR;
	}
}
