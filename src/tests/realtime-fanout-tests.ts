import assert from 'node:assert/strict';

/**
 * Realtime Fanout & Multi-Subscriber Invariant Verification (RT-001 / QA-002)
 */

type RealtimeCallback = (data: unknown) => void;

class RealtimeChannelManager {
	private subscribers = new Map<string, Set<RealtimeCallback>>();

	subscribe(branch: string, cb: RealtimeCallback): () => void {
		if (!this.subscribers.has(branch)) {
			this.subscribers.set(branch, new Set());
		}
		const branchSet = this.subscribers.get(branch)!;
		branchSet.add(cb);

		// Individual disposer that only removes this specific subscriber
		return () => {
			branchSet.delete(cb);
			if (branchSet.size === 0) {
				this.subscribers.delete(branch);
			}
		};
	}

	publish(branch: string, data: unknown): number {
		const branchSet = this.subscribers.get(branch);
		if (!branchSet || branchSet.size === 0) return 0;
		for (const cb of branchSet) {
			try {
				cb(data);
			} catch {}
		}
		return branchSet.size;
	}

	getSubscriberCount(branch: string): number {
		return this.subscribers.get(branch)?.size ?? 0;
	}

	clear(): void {
		this.subscribers.clear();
	}
}

const manager = new RealtimeChannelManager();

// Test 1: Multi-subscriber fanout
const receivedA: unknown[] = [];
const receivedB: unknown[] = [];
const receivedC: unknown[] = [];

const unsubA = manager.subscribe('samarinda', (data) => receivedA.push(data));
const unsubB = manager.subscribe('samarinda', (data) => receivedB.push(data));
const unsubC = manager.subscribe('balikpapan', (data) => receivedC.push(data));

assert.equal(manager.getSubscriberCount('samarinda'), 2);
assert.equal(manager.getSubscriberCount('balikpapan'), 1);

// Test 2: Publish event to 'samarinda'
const event1 = { table: 'buku_kas', action: 'insert', id: 'tx-1' };
const delivered = manager.publish('samarinda', event1);

assert.equal(delivered, 2);
assert.deepEqual(receivedA, [event1]);
assert.deepEqual(receivedB, [event1]);
assert.deepEqual(receivedC, [], 'Balikpapan subscriber must NOT receive Samarinda events');

// Test 3: Individual disposer removes ONLY subscriber A
unsubA();
assert.equal(manager.getSubscriberCount('samarinda'), 1);

const event2 = { table: 'produk', action: 'update', id: 'p-1' };
manager.publish('samarinda', event2);

assert.equal(receivedA.length, 1, 'Subscriber A must not receive new events after unsubscribe');
assert.deepEqual(receivedB, [event1, event2], 'Subscriber B must continue receiving events');

// Test 4: Unsubscribe B leaves 0 subscribers on Samarinda
unsubB();
assert.equal(manager.getSubscriberCount('samarinda'), 0);

// Test 5: Balikpapan still intact
const event3 = { table: 'kategori', action: 'insert', id: 'k-1' };
manager.publish('balikpapan', event3);
assert.deepEqual(receivedC, [event3]);

unsubC();
assert.equal(manager.getSubscriberCount('balikpapan'), 0);

console.log('realtime-fanout-tests: 12 assertions passed (100% isolation and fanout verified)');
