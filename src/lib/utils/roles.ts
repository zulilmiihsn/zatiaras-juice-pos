// Kebijakan role kanonik tunggal.
// Dipakai login, session store, dan store UI agar konsisten:
// valid `pemilik`/`kasir`/`admin`, unknown fail-closed (null),
// bukan default diam ke otoritas mana pun.
export const VALID_ROLES = ['pemilik', 'kasir', 'admin'] as const;

export type ValidRole = (typeof VALID_ROLES)[number];

export function normalizeRole(role: unknown): ValidRole | null {
	const value = String(role ?? '')
		.trim()
		.toLowerCase();
	return (VALID_ROLES as readonly string[]).includes(value) ? (value as ValidRole) : null;
}

// Helper peran untuk UI dan store. `admin` setara `pemilik` di UI, sesuai
// `requireAnyRole` di `src/lib/server/apiAuth.ts`. Nilai tak dikenal: false.
type RoleInput = string | null | undefined;

export function isOwnerRole(role: RoleInput): boolean {
	return role === 'pemilik' || role === 'admin';
}

export function isKasirRole(role: RoleInput): boolean {
	return role === 'kasir';
}

export function isStaffRole(role: RoleInput): boolean {
	return isKasirRole(role) || isOwnerRole(role);
}
