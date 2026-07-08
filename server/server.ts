import http from "node:http";
import next from "next";
import { initDb } from "./db";
import { attachWebSocket } from "./websocket";
import { ensureDataDirs } from "../rdt/fileUtils";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

async function main() {
  await ensureDataDirs();
  await initDb();

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  attachWebSocket(server);

  server.listen(port, hostname, () => {
    console.log(`RDT Lab ready on http://${hostname}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
