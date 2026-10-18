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
const SUMMARY_VALUE_CHARS = 120;
const SUMMARY_MAX_CHARS = 1024;

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
		// Best-effort encoding preserves the bounded envelope fallback.
		return null;
	}
}

function boundedMetadataObject(
	value: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
	if (!value) return null;

	const direct = safeStringify(value);
	const bytes = direct === null ? null : new TextEncoder().encode(direct).length;
	if (bytes !== null && bytes <= AUDIT_METADATA_BYTES) return value;

	const summary: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		const isScalar = entry === null || ['string', 'number', 'boolean'].includes(typeof entry);
		if (!isScalar) continue;

		summary[key] = `${key}:${String(entry)}`.slice(0, SUMMARY_VALUE_CHARS);
		if ((safeStringify(summary)?.length ?? 0) > SUMMARY_MAX_CHARS) {
			delete summary[key];
			break;
		}
	}
	return { truncated: true, byte_size: bytes, summary };
}

export function buildAuditPayload(input: AuditLogInput): string {
	return safeStringify({ ...input, metadata: boundedMetadataObject(input.metadata) }) ?? '{}';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isNonBlankString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function isOptionalString(value: unknown): boolean {
	return value == null || typeof value === 'string';
}

function assertEnvelope(valid: boolean): asserts valid {
	if (!valid) throw new Error('AUDIT_INVALID_ENVELOPE');
}

export function parseAuditPayload(payload: string, branch: string): AuditLogInput {
	const value: unknown = JSON.parse(payload);
	assertEnvelope(isRecord(value));
	assertEnvelope(isNonBlankString(value.action) && isNonBlankString(value.entityType));
	assertEnvelope(isOptionalString(value.transactionId) && isOptionalString(value.ipHash));
	assertEnvelope(
		value.entityId == null || typeof value.entityId === 'string' || isFiniteNumber(value.entityId)
	);
	assertEnvelope(value.amount == null || isFiniteNumber(value.amount));
	assertEnvelope(value.metadata == null || isRecord(value.metadata));

	const session = value.session;
	if (session != null) {
		assertEnvelope(isRecord(session));
		assertEnvelope(['userId', 'username', 'role'].every((key) => isOptionalString(session[key])));
		if (session.branch != null && session.branch !== branch) {
			throw new Error('AUDIT_BRANCH_CONFLICT');
		}
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
