const branches = ['samarinda', 'balikpapan', 'berau'];
export const SHARED_STAGING_BUCKET = 'zpos-shared-assets-staging';
const accountId = /^[a-f0-9]{32}$/;
const databaseId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const workerName = /^zpos-[a-z0-9-]+-staging$/;
const workerDomain = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function stagingOrigin(worker) {
	if (!workerName.test(worker?.name ?? '') || !workerDomain.test(worker?.subdomain ?? ''))
		throw new Error('Nama dan subdomain Worker staging tidak valid');
	return `https://${worker.name}.${worker.subdomain}.workers.dev`;
}

/** Explicit account IDs avoid inheriting Wrangler's default account on a multi-account machine. */
export function buildBranchStagingConfigs({
	gateway,
	backends,
	main,
	publicAssets,
	sharedStorage,
	storageMain
}) {
	if (!main || !publicAssets) throw new Error('Bundle dan salinan aset publik wajib tersedia');
	const publicOrigin = stagingOrigin(gateway);
	const targets = branches.map((branch) => backends?.[branch]);
	const accounts = targets.map((target) => target?.accountId);
	if (
		!accountId.test(gateway.accountId ?? '') ||
		accounts.some((id) => !accountId.test(id ?? '')) ||
		new Set(accounts).size !== branches.length ||
		!accounts.includes(gateway.accountId)
	)
		throw new Error('Tiga akun backend berbeda diperlukan; gateway harus memakai salah satunya');
	if (
		targets.some((target) => !databaseId.test(target?.databaseId ?? '')) ||
		new Set(targets.map((target) => target.databaseId)).size !== branches.length
	)
		throw new Error('D1 staging berbeda diperlukan untuk setiap cabang');
	const origins = targets.map(stagingOrigin);
	if (new Set([publicOrigin, ...origins]).size !== branches.length + 1)
		throw new Error('Alamat gateway dan backend harus berbeda');
	const common = (worker, mode) => ({
		name: worker.name,
		account_id: worker.accountId,
		main,
		compatibility_date: '2026-06-29',
		compatibility_flags: ['nodejs_compat'],
		workers_dev: true,
		preview_urls: false,
		assets: { directory: publicAssets, binding: 'ASSETS', run_worker_first: true },
		vars: { BRANCH_ACCOUNT_MODE: mode, BRANCH_PUBLIC_ORIGIN: publicOrigin }
	});
	const frontend = common(gateway, 'gateway');
	const colocated = accounts.indexOf(gateway.accountId);
	frontend.services = [{ binding: 'BRANCH_LOCAL_BACKEND', service: targets[colocated].name }];
	frontend.vars.BRANCH_LOCAL_ORIGIN = origins[colocated];
	for (const [index, branch] of branches.entries())
		frontend.vars[`BRANCH_ORIGIN_${branch.toUpperCase()}`] = origins[index];
	const backendConfigs = {};
	for (const [index, branch] of branches.entries()) {
		const target = targets[index];
		const config = common(target, 'backend');
		if (target.bucketName !== undefined) {
			if (target.bucketName !== `zpos-${branch}-assets-staging`)
				throw new Error(`${branch}: bucket R2 staging tidak valid`);
			config.r2_buckets = [{ binding: 'STORAGE', bucket_name: target.bucketName }];
		}
		config.observability = { enabled: true, logs: { enabled: true, invocation_logs: false } };
		Object.assign(config.vars, {
			BRANCH_ACCOUNT_IDENTITY: branch,
			KIOSK_PRODUCTION_PILOT: branch,
			KIOSK_PROJECTION_BRANCHES: branch
		});
		config.d1_databases = [
			{
				binding: `DB_${branch.toUpperCase()}_GROUP`,
				database_name: target.name,
				database_id: target.databaseId
			}
		];
		config.durable_objects = {
			bindings: [
				{ name: 'REALTIME_HUB', class_name: 'RealtimeDurableObject' },
				{ name: 'BRANCH_MAINTENANCE', class_name: 'BranchMaintenanceAlarm' }
			]
		};
		config.migrations = [
			{ tag: 'v1', new_sqlite_classes: ['RealtimeDurableObject'] },
			{ tag: 'v2', new_sqlite_classes: ['BranchMaintenanceAlarm'] }
		];
		backendConfigs[branch] = config;
	}
	let storage;
	if (sharedStorage !== undefined) {
		if (
			!storageMain ||
			sharedStorage?.bucketName !== SHARED_STAGING_BUCKET ||
			targets.some((target) => target.bucketName !== undefined) ||
			gateway.accountId !== accounts[0]
		)
			throw new Error('Konfigurasi R2 bersama staging tidak valid');
		const name = 'zpos-storage-staging';
		const origin = stagingOrigin({ name, subdomain: gateway.subdomain });
		if ([publicOrigin, ...origins].includes(origin))
			throw new Error('Origin R2 staging bertabrakan');
		storage = {
			name,
			main: storageMain,
			account_id: gateway.accountId,
			compatibility_date: '2026-06-29',
			compatibility_flags: ['nodejs_compat'],
			workers_dev: true,
			preview_urls: false,
			r2_buckets: [{ binding: 'STORAGE', bucket_name: sharedStorage.bucketName }]
		};
		for (const config of Object.values(backendConfigs)) config.vars.BRANCH_STORAGE_ORIGIN = origin;
		backendConfigs.samarinda.services = [{ binding: 'BRANCH_STORAGE_LOCAL', service: name }];
	}
	return { gateway: frontend, backends: backendConfigs, storage };
}
