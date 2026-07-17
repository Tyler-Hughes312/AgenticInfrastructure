import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  sourceType: text("source_type").notNull().default("local"),
  defaultBranch: text("default_branch").notNull().default("main"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  graphTemplateId: uuid("graph_template_id"),
  title: text("title"),
  graphConfig: text("graph_config").notNull().default('{"agents":[],"edges":[]}'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  chatSessionId: uuid("chat_session_id").references(() => chatSessions.id),
  status: text("status").notNull().default("pending"),
  task: text("task").notNull(),
  threadId: text("thread_id").notNull(),
  branch: text("branch").notNull().default("agent/run"),
  langfuseTraceUrl: text("langfuse_trace_url"),
  githubPrUrl: text("github_pr_url"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => chatSessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  runId: uuid("run_id").references(() => runs.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id),
  type: text("type").notNull(),
  payload: text("payload").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceFileChanges = pgTable("workspace_file_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatSessionId: uuid("chat_session_id")
    .notNull()
    .references(() => chatSessions.id),
  runId: uuid("run_id").references(() => runs.id),
  agentId: text("agent_id").notNull(),
  path: text("path").notNull(),
  action: text("action").notNull(),
  beforeText: text("before_text").notNull().default(""),
  afterText: text("after_text").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Explicitly saved agent team / graph blueprints — reusable across projects. */
export const savedGraphTemplates = pgTable("saved_graph_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  graphConfig: text("graph_config").notNull(),
  sourceSessionId: uuid("source_session_id").references(() => chatSessions.id, {
    onDelete: "set null",
  }),
  agentCount: text("agent_count").notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
