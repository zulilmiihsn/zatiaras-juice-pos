import assert from 'node:assert/strict';
import {
	formatDateYmdWita,
	getNowWita,
	getTodayWita,
	witaToUtcISO,
	witaToUtcRange
} from '../lib/utils/dateTime';

// AUD-026: default Catat harus dari instant sekarang dalam WITA,
// bukan zona perangkat. Bekukan instant di batas sensitif.
const RealDate = Date;

function freezeInstant(iso: string): () => void {
	const fixed = new RealDate(iso).getTime();
	class FrozenDate extends RealDate {
		constructor(...args: unknown[]) {
			super(...((args.length ? args : [fixed]) as []));
		}
		static now(): number {
			return fixed;
		}
	}
	(globalThis as unknown as { Date: unknown }).Date = FrozenDate;
	return () => {
		(globalThis as unknown as { Date: unknown }).Date = RealDate;
	};
}

function witaParts(instantIso: string): { date: string; time: string } {
	const instant = new RealDate(instantIso);
	const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar' }).format(instant);
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Asia/Makassar',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(instant);
	return { date, time };
}

// 2026-09-30T16:30:00Z = 00:30 WITA 1 Okt (lewat tengah malam WITA,
// masih 30 Sep di UTC/WIB). Formula lama getFullYear/getDate perangkat
// memberi 30 Sep pada perangkat UTC — hari salah sebelum dianggap WITA.
for (const instant of [
	'2026-09-30T16:30:00.000Z',
	'2026-09-30T15:59:00.000Z',
	'2026-08-31T16:30:00.000Z',
	'2025-12-31T16:30:00.000Z',
	'2026-09-30T04:00:00.000Z'
]) {
	const restore = freezeInstant(instant);
	try {
		const expected = witaParts(instant);
		assert.equal(getTodayWita(), expected.date, `date WITA untuk ${instant}`);
		assert.equal(getNowWita().slice(0, 10), expected.date, `now date WITA untuk ${instant}`);
		assert.equal(getNowWita().slice(11, 16), expected.time, `now time WITA untuk ${instant}`);
		assert.equal(
			formatDateYmdWita(new Date(instant)),
			expected.date,
			`format WITA untuk ${instant}`
		);
		// Round-trip simpan: default yang tampil kembali ke instant yang sama.
		assert.equal(
			witaToUtcISO(expected.date, expected.time).slice(0, 16),
			instant.slice(0, 16),
			`round-trip untuk ${instant}`
		);
	} finally {
		restore();
	}
}

// AUD-027: batas hari WITA tepat di UTC untuk filter aktivitas.
assert.deepEqual(witaToUtcRange('2026-10-01'), {
	startUtc: '2026-09-30T16:00:00.000Z',
	endUtc: '2026-10-01T15:59:59.999Z'
});
// Batas bulan/tahun tak bocor sehari.
assert.deepEqual(witaToUtcRange('2026-03-01').startUtc, '2026-02-28T16:00:00.000Z');
assert.deepEqual(witaToUtcRange('2026-01-01').startUtc, '2025-12-31T16:00:00.000Z');
// 23:59 WITA masih hari sama; 00:00 WITA hari berikut.
assert.ok('2026-10-01T15:59:00.000Z' <= witaToUtcRange('2026-10-01').endUtc);
assert.ok('2026-10-01T16:00:00.000Z' > witaToUtcRange('2026-10-01').endUtc);

console.log('catat-timezone-tests: default WITA beku lintas batas passed');
