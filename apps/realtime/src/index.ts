import { Server } from "@hocuspocus/server";

const port = Number(process.env.PORT ?? 1234);

const server = new Server({
  port,
  quiet: process.env.QUIET === "1",
});

await server.listen();

console.log(`[alove-realtime] ${server.webSocketURL}`);
