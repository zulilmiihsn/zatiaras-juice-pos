import assert from 'node:assert/strict';
import { RealtimeDurableObject } from '../src/lib/server/realtimeDurableObject.js';

const sent = [];
const closed = [];
const sockets = [
	{
		send(payload) {
			sent.push({ socket: 'first', payload: JSON.parse(payload) });
		},
		close(code, reason) {
			closed.push({ socket: 'first', code, reason });
		}
	},
	{
		send(payload) {
			sent.push({ socket: 'second', payload: JSON.parse(payload) });
		},
		close(code, reason) {
			closed.push({ socket: 'second', code, reason });
		}
	}
];

const ctx = {
	acceptWebSocket() {},
	getWebSockets() {
		return sockets;
	}
};

const durableObject = new RealtimeDurableObject(ctx, {});
const payload = {
	branch: 'samarinda',
	table: 'produk',
	event: 'change',
	timestamp: '2026-06-17T00:00:00.000Z'
};

const publishResponse = await durableObject.fetch(
	new Request('https://realtime.local/publish', {
		method: 'POST',
		body: JSON.stringify(payload),
		headers: { 'Content-Type': 'application/json' }
	})
);
const publishBody = await publishResponse.json();

assert.equal(publishResponse.status, 200);
assert.deepEqual(publishBody, { ok: true, delivered: 2 });
assert.deepEqual(sent, [
	{ socket: 'first', payload },
	{ socket: 'second', payload }
]);
assert.deepEqual(closed, []);

const invalidResponse = await durableObject.fetch(
	new Request('https://realtime.local/publish', {
		method: 'POST',
		body: 'not-json'
	})
);
assert.equal(invalidResponse.status, 400);

const upgradeRequiredResponse = await durableObject.fetch(
	new Request('https://realtime.local/connect')
);
assert.equal(upgradeRequiredResponse.status, 426);

console.log('Realtime Durable Object broadcast verified');
