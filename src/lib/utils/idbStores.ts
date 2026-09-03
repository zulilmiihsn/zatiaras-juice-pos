import { createStore } from 'idb-keyval';

export const cacheStore = createStore('zatiaras-cache-v2', 'cache');
export const catalogStore = createStore('zatiaras-catalog-v2', 'catalog');
export const pendingTransactionStore = createStore(
	'zatiaras-pending-transactions-v2',
	'pending-transactions'
);
