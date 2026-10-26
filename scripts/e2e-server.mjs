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
	// Default Node menutup socket keep-alive yang diam 5 detik. Tes yang menahan respons
	// lebih lama membuat klien Playwright memakai ulang socket yang sedang ditutup
	// (ECONNRESET, CI run 39009800989). Server tes tidak boleh menutup lebih dulu.
	if (server.httpServer) {
		server.httpServer.keepAliveTimeout = 120_000;
		server.httpServer.headersTimeout = 121_000;
		server.httpServer.on('connection', (socket) => {
			// WebKit can reset an upgraded dev connection when its context closes on Windows.
			// The connection owns this expected disconnect; other socket failures still fail the run.
			socket.on('error', (error) => {
				if (error.code !== 'ECONNRESET') throw error;
			});
		});
	}
	await server.listen();
	const address = server.httpServer?.address();
	if (!address || typeof address === 'string') throw new Error('E2E server address unavailable');
	process.send?.({ port: address.port });
} catch (error) {
	console.error('[e2e-server]', error instanceof Error ? error.message : String(error));
	process.exit(1);
}
