// Kebijakan role kanonik tunggal (AUD-019).
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
