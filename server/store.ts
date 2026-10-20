import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { stateSchema, emptyState, type PlannerState } from "../src/lib/model";
const records = sqliteTable("workspace", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull(),
  body: text("body").notNull(),
});
export function createStore(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)",
  );
  const db = drizzle(sqlite);
  db.insert(records)
    .values({ id: 1, revision: 0, body: JSON.stringify(emptyState) })
    .onConflictDoNothing()
    .run();
  const read = () => {
    const record = db.select().from(records).where(eq(records.id, 1)).get()!;
    return {
      revision: record.revision,
      state: stateSchema.parse(JSON.parse(record.body)),
    };
  };
  return {
    read,
    save: (input: PlannerState, revision: number) => {
      const state = stateSchema.parse(input);
      return sqlite.transaction(() => {
        const current = read();
        if (current.revision !== revision)
          throw new Error(
            "This workspace changed in another tab. Reload before saving.",
          );
        db.update(records)
          .set({ body: JSON.stringify(state), revision: revision + 1 })
          .where(eq(records.id, 1))
          .run();
        return { state, revision: revision + 1 };
      })();
    },
    close: () => sqlite.close(),
  };
}
export type Store = ReturnType<typeof createStore>;
