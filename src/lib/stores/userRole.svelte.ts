export type UserRole = 'pemilik' | 'kasir' | 'admin';

function isUserRole(role: unknown): role is UserRole {
	return role === 'pemilik' || role === 'kasir' || role === 'admin';
}

// [CATATAN]: Store untuk user role dan profile menggunakan runes Svelte 5
class RoleState {
	value = $state<UserRole | null>(null);
}
export const userRole = new RoleState();

class ProfileState {
	value = $state<unknown | null>(null);
}
export const userProfile = new ProfileState();

// [CATATAN]: Coba inisialisasi store dari localStorage saat aplikasi dimuat
if (typeof window !== 'undefined') {
	const saved = localStorage.getItem('zatiaras_session');
	if (saved) {
		try {
			const parsed = JSON.parse(saved);
			if (parsed.user && parsed.user.role) {
				userRole.value = isUserRole(parsed.user.role) ? parsed.user.role : null;
				userProfile.value = parsed.user;
			}
		} catch (e) {
			// [CATATAN]: Silent error handling
		}
	}
}

// [CATATAN]: Fungsi untuk set user role dan profile (dipanggil saat login)
export function setUserRole(role: string, profile: unknown) {
	userRole.value = isUserRole(role) ? role : null;
	userProfile.value = profile;
}

// [CATATAN]: Fungsi untuk clear user data (dipanggil saat logout)
export function clearUserRole() {
	userRole.value = null;
	userProfile.value = null;
}

export async function validateRoleWithBackend(): Promise<'valid' | 'invalid' | 'network_error'> {
	try {
		const res = await fetch('/api/session');
		if (!res.ok) return 'network_error';
		const data = await res.json();
		if (!data?.user) {
			clearUserRole();
			return 'invalid';
		}
		setUserRole(data.user.role, data.user);
		return 'valid';
	} catch {
		return 'network_error';
	}
}

/**
 * Mendapatkan peran pengguna saat ini.
 */
export async function getCurrentRole(): Promise<UserRole | null> {
	if (userRole.value) return userRole.value;

	const validationStatus = await validateRoleWithBackend();
	if (validationStatus === 'valid') return userRole.value;

	return null;
}

/**
 * Mendapatkan profil pengguna saat ini.
 */
export async function getCurrentProfile(): Promise<unknown | null> {
	if (userProfile.value) return userProfile.value;

	const validationStatus = await validateRoleWithBackend();
	if (validationStatus === 'valid') return userProfile.value;

	return null;
}
