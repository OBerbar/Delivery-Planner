import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import serveStatic from "@fastify/static";
import { createStore } from "./store";
import { createServer, type ManagedRuntime } from "./app";

export async function startPlanner(options: {
  dataDirectory: string;
  webDirectory: string;
  port: number;
  runtime?: ManagedRuntime;
}) {
  mkdirSync(options.dataDirectory, { recursive: true });
  const store = createStore(resolve(options.dataDirectory, "planner.sqlite"));
  const server = createServer(store, options.runtime);
  let stopped: Promise<void> | undefined;
  const stop = () =>
    (stopped ??= (async () => {
      await server.close();
      store.close();
    })());
  try {
    if (existsSync(resolve(options.webDirectory, "index.html"))) {
      await server.register(serveStatic, {
        root: resolve(options.webDirectory),
        wildcard: true,
      });
      server.setNotFoundHandler((request, reply) =>
        request.url.startsWith("/api")
          ? reply.code(404).send({ error: "Not found" })
          : reply.sendFile("index.html"),
      );
    }
    await server.listen({ host: "127.0.0.1", port: options.port });
    const address = server.server.address();
    if (!address || typeof address === "string")
      throw new Error("A local TCP address was not allocated.");
    return { server, stop, port: address.port };
  } catch (error) {
    await stop();
    throw error;
  }
}
