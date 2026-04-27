#!/usr/bin/env bun
import { createServer } from "./server.ts";

const server = createServer();

await server.start({
  transportType: "stdio",
});
