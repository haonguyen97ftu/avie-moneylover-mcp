#!/usr/bin/env node
import { createHttpServer } from './httpServer.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');

const server = createHttpServer();
server.listen(port, '0.0.0.0', () => {
  console.log(`Avie Money Lover MCP listening on 0.0.0.0:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
