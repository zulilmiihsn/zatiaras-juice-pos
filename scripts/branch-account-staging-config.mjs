const branches = ['samarinda', 'balikpapan', 'berau'];
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
export function buildBranchStagingConfigs({ gateway, backends, main, publicAssets }) {
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
	for (const [index, branch] of branches.entries())
		frontend.vars[`BRANCH_ORIGIN_${branch.toUpperCase()}`] = origins[index];
	const backendConfigs = {};
	for (const [index, branch] of branches.entries()) {
		const target = targets[index];
		const config = common(target, 'backend');
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
			bindings: [{ name: 'REALTIME_HUB', class_name: 'RealtimeDurableObject' }]
		};
		config.migrations = [{ tag: 'v1', new_sqlite_classes: ['RealtimeDurableObject'] }];
		config.triggers = { crons: ['* * * * *'] };
		backendConfigs[branch] = config;
	}
	return { gateway: frontend, backends: backendConfigs };
}
