export type RunEvent = {
  run_id: string;
  event: string;
  name?: string;
  data?: any;
  metadata?: any;
  ts?: number;
  step_index?: number;
  state_snapshot?: any;
};

export type Snapshot = { step: number; state: Record<string, unknown> };

export type RunSessionStatus = "idle" | "running" | "completed" | "error";
