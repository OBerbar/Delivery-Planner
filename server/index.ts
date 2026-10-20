import { resolve } from "node:path";
import { startPlanner } from "./start";
const planner = await startPlanner({
  dataDirectory: resolve(process.env.PLANNER_DATA_DIR ?? "data"),
  webDirectory: resolve(process.env.PLANNER_WEB_DIR ?? "dist"),
  port: Number(process.env.API_PORT ?? 4311),
});
console.log(`Delivery Studio: http://127.0.0.1:${planner.port}`);
const stop = () => {
  void planner.stop().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
