#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMoneyloverMcpServer } from './mcpServer.js';

const server = createMoneyloverMcpServer();
await server.connect(new StdioServerTransport());
