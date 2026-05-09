import { createServer } from "./server.ts";

const server = createServer();

server.start({
  transportType: "stdio",
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
