import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export const legacyProductionOrigin = 'https://zatiaraspos.pages.dev';
export const productionStorageName = 'zatiaraspos-storage';

/** Candidate only: no public routing change, maintenance, or open mode is representable. */
export function buildBranchProductionCandidateConfigs({
	inventory,
	destinations,
	main,
	publicAssets,
	liveConfig,
	connectPaused = false,
	prepareOperational = false
}) {
	if (prepareOperational && !connectPaused)
		throw new Error('Persiapan operasional memerlukan backend yang terhubung dan tertutup');
	const { gateway, backends } = buildBranchStagingConfigs({
		gateway: inventory.gateway,
		backends: inventory.backends,
		main,
		publicAssets
	});
	if (
		gateway.account_id !== backends.samarinda.account_id ||
		gateway.name !== 'zpos-gateway-staging'
	)
		throw Error('Akun utama kandidat tidak cocok');
	const name = 'zatiaraspos-gateway-candidate';
	const publicOrigin = `https://${name}.${inventory.gateway.subdomain}.workers.dev`;
	const storageOrigin = `https://${productionStorageName}.${inventory.gateway.subdomain}.workers.dev`;
	const stageIds = new Set(
		Object.values(backends).map((config) => config.d1_databases[0].database_id)
	);
	const destinationIds = new Set();
	const common = {
		main,
		compatibility_date: gateway.compatibility_date,
		compatibility_flags: gateway.compatibility_flags,
		workers_dev: true,
		preview_urls: false,
		assets: gateway.assets
	};
	const gate = {
		BRANCH_PUBLIC_ORIGIN: publicOrigin,
		BRANCH_PRODUCTION_CANDIDATE: 'yes',
		BRANCH_CUTOVER_STATE: 'paused'
	};
	const config = {
		gateway: {
			...common,
			name,
			account_id: gateway.account_id,
			vars: { ...gate, BRANCH_ACCOUNT_MODE: 'gateway' },
			services: []
		},
		backends: {}
	};
	for (const [branch, backend] of Object.entries(backends)) {
		const destination = destinations[branch];
		if (
			destination?.name !== `zatiaraspos-${branch}` ||
			!uuid.test(destination.id) ||
			stageIds.has(destination.id) ||
			destinationIds.has(destination.id) ||
			liveConfig.includes(destination.id)
		)
			throw Error(`${branch}: D1 kandidat bukan tujuan produksi terpisah`);
		destinationIds.add(destination.id);
		const worker = `zatiaraspos-${branch}-candidate`;
		const origin = `https://${worker}.${inventory.backends[branch].subdomain}.workers.dev`;
		config.gateway.vars[`BRANCH_ORIGIN_${branch.toUpperCase()}`] = origin;
		if (branch === 'samarinda') {
			config.gateway.vars.BRANCH_LOCAL_ORIGIN = origin;
			config.gateway.services.push({ binding: 'BRANCH_LOCAL_BACKEND', service: worker });
		}
		config.backends[branch] = {
			...common,
			name: worker,
			account_id: backend.account_id,
			vars: {
				...gate,
				BRANCH_ACCOUNT_MODE: 'backend',
				BRANCH_ACCOUNT_IDENTITY: branch,
				...(connectPaused
					? {
							BRANCH_PUBLIC_ORIGIN: legacyProductionOrigin,
							BRANCH_STORAGE_ORIGIN: storageOrigin,
							BRANCH_CONNECTION_PROBE: 'yes'
						}
					: {}),
				...(prepareOperational
					? {
							BRANCH_OPERATIONAL_READY: 'yes',
							KIOSK_PRODUCTION_PILOT: branch,
							KIOSK_PROJECTION_BRANCHES: branch
						}
					: {})
			},
			...(connectPaused && branch === 'samarinda'
				? { services: [{ binding: 'BRANCH_STORAGE_LOCAL', service: productionStorageName }] }
				: {}),
			d1_databases: [
				{
					binding: backend.d1_databases[0].binding,
					database_name: destination.name,
					database_id: destination.id
				}
			],
			durable_objects: {
				bindings: [
					{ name: 'REALTIME_HUB', class_name: 'RealtimeDurableObject' },
					...(prepareOperational
						? [{ name: 'BRANCH_MAINTENANCE', class_name: 'BranchMaintenanceAlarm' }]
						: [])
				]
			},
			migrations: [
				{ tag: 'v1', new_sqlite_classes: ['RealtimeDurableObject'] },
				...(prepareOperational
					? [{ tag: 'v2', new_sqlite_classes: ['BranchMaintenanceAlarm'] }]
					: [])
			]
		};
	}
	return config;
}
