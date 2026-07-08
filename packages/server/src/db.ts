import pg from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { InMemoryStore } from "@langchain/langgraph";
import type { BaseStore } from "@langchain/langgraph";
import { env } from "./config.js";
import { getEmbeddings } from "./models-llm.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let checkpointer: PostgresSaver | null = null;
let store: BaseStore | null = null;
let initialized = false;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

export function getCheckpointer(): PostgresSaver {
  if (!checkpointer) {
    checkpointer = new PostgresSaver(getPool());
  }
  return checkpointer;
}

export function getStore(): BaseStore {
  if (!store) {
    throw new Error("Memory store not initialized — call setupDb() during server startup");
  }
  return store;
}

function createInMemoryStore(): InMemoryStore {
  if (env.OPENAI_API_KEY) {
    return new InMemoryStore({
      index: { dims: 1536, embeddings: getEmbeddings() },
    });
  }
  console.warn("OPENAI_API_KEY not set — using InMemoryStore without semantic search");
  return new InMemoryStore();
}

async function createPostgresStore(): Promise<PostgresStore> {
  const pgStore = PostgresStore.fromConnString(env.DATABASE_URL, {
    index: {
      dims: 1536,
      embed: getEmbeddings(),
    },
  });
  await pgStore.setup();
  return pgStore;
}

export async function setupDb(): Promise<void> {
  if (initialized) return;

  await getCheckpointer().setup();

  if (env.MEMORY_STORE === "inmemory") {
    console.warn("Using InMemoryStore for long-term memory (MEMORY_STORE=inmemory)");
    store = createInMemoryStore();
    initialized = true;
    return;
  }

  try {
    store = await createPostgresStore();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("vector") || msg.includes("ECONNREFUSED")) {
      console.warn(
        "PostgresStore unavailable (%s). Falling back to InMemoryStore for this session.",
        msg.split("\n")[0]
      );
      store = createInMemoryStore();
    } else {
      throw err;
    }
  }

  initialized = true;
}

export async function shutdownDb(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  checkpointer = null;
  store = null;
  initialized = false;
}
