import { createServer } from 'vite';

// Separate process: the adapter owns its workerd proxy until process exit.
// Parent waits for this process before deleting ONLY its temporary persistence.
let server;
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	const timer = setTimeout(() => process.exit(1), 15000);
	try {
		await server?.close();
		clearTimeout(timer);
		process.exit(0);
	} catch {
		process.exit(1);
	}
}
process.on('message', (message) => {
	if (message === 'shutdown') void stop();
});
process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

try {
	server = await createServer({
		mode: 'e2e',
		logLevel: 'warn',
		server: { host: '127.0.0.1', port: 0 }
	});
	await server.listen();
	const address = server.httpServer?.address();
	if (!address || typeof address === 'string') throw new Error('E2E server address unavailable');
	process.send?.({ port: address.port });
} catch (error) {
	console.error('[e2e-server]', error instanceof Error ? error.message : String(error));
	process.exit(1);
}
