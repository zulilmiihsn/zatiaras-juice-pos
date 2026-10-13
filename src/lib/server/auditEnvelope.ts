type AuditSession = { userId?: string | null; username?: string | null; role?: string | null };
export type AuditLogInput = {
	action: string;
	entityType: string;
	entityId?: string | number | null;
	transactionId?: string | null;
	amount?: number | null;
	metadata?: Record<string, unknown> | null;
	ipHash?: string | null;
	session?: AuditSession | null;
};
const AUDIT_METADATA_BYTES = 8192;
function safeStringify(value: unknown): string | null {
	try {
		const seen = new Set();
		return (
			JSON.stringify(value, (_key, val: unknown) => {
				if (val && typeof val === 'object') {
					if (seen.has(val)) return '[cyclic]';
					seen.add(val);
				}
				return val;
			}) ?? null
		);
	} catch {
		return null; /* Best-effort encoding preserves the bounded envelope fallback. */
	}
}
function boundedMetadataObject(
	value: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
	if (!value) return null;
	const direct = safeStringify(value),
		bytes = direct === null ? null : new TextEncoder().encode(direct).length;
	if (bytes !== null && bytes <= AUDIT_METADATA_BYTES) return value;
	const summary: Record<string, unknown> = {};
	for (const [key, v] of Object.entries(value))
		if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
			summary[key] = `${key}:${String(v)}`.slice(0, 120);
			if ((safeStringify(summary)?.length ?? 0) > 1024) {
				delete summary[key];
				break;
			}
		}
	return { truncated: true, byte_size: bytes, summary };
}
export function buildAuditPayload(input: AuditLogInput): string {
	return safeStringify({ ...input, metadata: boundedMetadataObject(input.metadata) }) ?? '{}';
}
function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function parseAuditPayload(payload: string, branch: string): AuditLogInput {
	const value: unknown = JSON.parse(payload);
	if (
		!record(value) ||
		typeof value.action !== 'string' ||
		!value.action.trim() ||
		typeof value.entityType !== 'string' ||
		!value.entityType.trim()
	)
		throw new Error('AUDIT_INVALID_ENVELOPE');
	for (const key of ['transactionId', 'ipHash'])
		if (value[key] != null && typeof value[key] !== 'string')
			throw new Error('AUDIT_INVALID_ENVELOPE');
	if (
		value.entityId != null &&
		typeof value.entityId !== 'string' &&
		!(typeof value.entityId === 'number' && Number.isFinite(value.entityId))
	)
		throw new Error('AUDIT_INVALID_ENVELOPE');
	if (value.amount != null && !(typeof value.amount === 'number' && Number.isFinite(value.amount)))
		throw new Error('AUDIT_INVALID_ENVELOPE');
	if (value.metadata != null && !record(value.metadata)) throw new Error('AUDIT_INVALID_ENVELOPE');
	if (value.session != null) {
		if (!record(value.session)) throw new Error('AUDIT_INVALID_ENVELOPE');
		for (const key of ['userId', 'username', 'role'])
			if (value.session[key] != null && typeof value.session[key] !== 'string')
				throw new Error('AUDIT_INVALID_ENVELOPE');
		if (value.session.branch != null && value.session.branch !== branch)
			throw new Error('AUDIT_BRANCH_CONFLICT');
	}
	return value as AuditLogInput;
}
/** Same column projection for direct writes, immediate delivery and every drain consumer. */
export function auditValues(input: AuditLogInput): (string | number | null)[] {
	return [
		input.session?.userId ?? null,
		input.session?.username ?? null,
		input.session?.role ?? null,
		input.action,
		input.entityType,
		input.entityId == null ? null : String(input.entityId),
		input.transactionId ?? null,
		input.amount ?? null,
		input.metadata == null ? null : safeStringify(input.metadata),
		input.ipHash ?? null
	];
}
