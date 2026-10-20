import Fastify from "fastify";
import { z } from "zod";
import { stateSchema } from "../src/lib/model";
import { STORAGE_SCHEMA_VERSION } from "../src/lib/runtime-version";
import type { Store } from "./store";
export interface ManagedRuntime {
  instanceId: string;
  quitToken: string;
  onQuit: () => Promise<void>;
}
export function createServer(store: Store, runtime?: ManagedRuntime) {
  const app = Fastify({ logger: false, bodyLimit: 15 * 1024 * 1024 });
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api")) {
      const origin = request.headers.origin;
      const address = app.server.address();
      const boundPort =
        address && typeof address !== "string" ? address.port : null;
      if (
        origin &&
        ![
          "http://127.0.0.1:4310",
          "http://localhost:4310",
          "http://127.0.0.1:4311",
          "http://localhost:4311",
          `http://127.0.0.1:${process.env.VITE_PORT ?? 4310}`,
          `http://127.0.0.1:${process.env.API_PORT ?? 4311}`,
          ...(boundPort
            ? [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`]
            : []),
        ].includes(origin)
      )
        return reply
          .code(403)
          .send({ error: "This planner only accepts local requests." });
      const host = (request.headers.host ?? "").split(":")[0];
      if (!["127.0.0.1", "localhost", ""].includes(host))
        return reply.code(403).send({ error: "Local requests only." });
    }
  });
  app.get("/api/state", async () => store.read());
  app.put("/api/state", async (request, reply) => {
    const parsed = z
      .object({ revision: z.number().int().min(0), state: stateSchema })
      .safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    try {
      return store.save(parsed.data.state, parsed.data.revision);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
  app.get("/api/health", async () => ({
    status: "ok",
    schemaVersion: STORAGE_SCHEMA_VERSION,
    ...(runtime
      ? { application: "delivery-studio", instanceId: runtime.instanceId }
      : {}),
  }));
  app.get("/api/runtime", async () =>
    runtime
      ? { managed: true, quitToken: runtime.quitToken }
      : { managed: false },
  );
  app.post("/api/quit", async (request, reply) => {
    if (!runtime)
      return reply
        .code(404)
        .send({ error: "This server is managed through its terminal." });
    if (request.headers["x-delivery-studio-token"] !== runtime.quitToken)
      return reply
        .code(403)
        .send({ error: "Quit was not authorized by this workspace." });
    setImmediate(() => {
      void runtime.onQuit().catch((error) => app.log.error(error));
    });
    return { stopping: true };
  });
  return app;
}
