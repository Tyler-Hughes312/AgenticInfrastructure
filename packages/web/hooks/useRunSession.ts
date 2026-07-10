"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RunSessionWebsocket, fetchRunTrace, subscribeRunStream, type RunLaunchOptions } from "../app/api-client";
import { diffStates } from "../components/diff";
import type { DiffItem } from "../components/diff";
import type { RunEvent, RunSessionStatus, Snapshot } from "../lib/types/run";

function isCriticalEvent(e: RunEvent): boolean {
  return Boolean(
    e.state_snapshot ||
      e.event === "on_chain_end" ||
      e.event === "on_chain_start" ||
      e.event === "on_node_end" ||
      e.event === "on_node_start" ||
      e.event === "on_tool_start" ||
      e.event === "on_tool_end" ||
      e.event === "on_chat_model_end" ||
      e.event === "orchestrator_graph_updated" ||
      e.event === "error"
  );
}

function cleanState(state: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === "__end__" || key === "END" || key.startsWith("__")) continue;
    clean[key] = value;
  }
  return clean;
}

export function useRunSession(
  initialRunId?: string | null,
  options?: { persist?: boolean }
) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [actualRunId, setActualRunId] = useState<string | null>(initialRunId ?? null);
  const [status, setStatus] = useState<RunSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);

  const sessionRef = useRef<RunSessionWebsocket | null>(null);
  const isLiveRef = useRef(isLive);
  const actualRunIdRef = useRef(actualRunId);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    actualRunIdRef.current = actualRunId;
  }, [actualRunId]);

  const processEvent = useCallback((e: RunEvent) => {
    setEvents((prev) => [...prev, e]);

    if (e.run_id) {
      setActualRunId(e.run_id);
    }

    if (e.state_snapshot) {
      setSnapshots((prev) => {
        const next = [
          ...prev,
          { step: e.step_index ?? prev.length, state: e.state_snapshot as Record<string, unknown> },
        ];
        if (isLiveRef.current) {
          setReplayIndex(next.length - 1);
        }
        return next;
      });
    }

    if (e.event === "error") {
      setStatus("error");
      const message = (e.data as { message?: string } | undefined)?.message ?? "Run failed";
      setError(message);
      // Keep hasStarted so follow-ups can reuse the session after a recoverable error.
    }
  }, []);

  const ingestEvent = useCallback(
    (eventBuffer: RunEvent[], flushAll = false) => {
      if (eventBuffer.length === 0) return;

      const critical = flushAll
        ? eventBuffer
        : eventBuffer.filter(isCriticalEvent);
      const batched = flushAll
        ? []
        : eventBuffer.filter((e) => !isCriticalEvent(e));

      if (critical.length > 0) {
        setEvents((prev) => [...prev, ...critical]);

        for (const e of critical) {
          if (e.run_id) setActualRunId(e.run_id);
        }

        const newSnapshots: Snapshot[] = [];
        for (const e of critical) {
          if (e.state_snapshot) {
            newSnapshots.push({
              step: e.step_index ?? 0,
              state: e.state_snapshot as Record<string, unknown>,
            });
          }
        }

        if (newSnapshots.length > 0) {
          setSnapshots((prev) => {
            const next = [...prev, ...newSnapshots];
            if (isLiveRef.current) setReplayIndex(next.length - 1);
            return next;
          });
        }
      }

      if (batched.length > 0) {
        setEvents((prev) => [...prev, ...batched]);
      }
    },
    []
  );

  const ensureSession = useCallback(() => {
    if (sessionRef.current) return sessionRef.current;

    let eventBuffer: RunEvent[] = [];
    let bufferTimeout: ReturnType<typeof setTimeout> | null = null;

    const flushBuffer = () => {
      ingestEvent(eventBuffer, true);
      eventBuffer = [];
      bufferTimeout = null;
    };

    const session = new RunSessionWebsocket({
      onOpen: () => {
        setStatus((s) => {
          if (s === "error") return s;
          // Keep "running" if a turn is already in flight when the socket opens.
          return s === "running" ? "running" : s;
        });
      },
      onClose: () => {
        flushBuffer();
        if (intentionalCloseRef.current) {
          intentionalCloseRef.current = false;
          return;
        }
        setStatus((s) => (s === "running" ? "error" : s));
        setError((prev) => prev ?? "Connection to orchestrator closed unexpectedly");
      },
      onError: (message) => {
        setError(message);
        setStatus("error");
      },
      onEvent: (e) => {
        if (e.event === "turn_complete") {
          flushBuffer();
          setStatus("completed");
          return;
        }
        if (isCriticalEvent(e)) {
          if (eventBuffer.length > 0) flushBuffer();
          processEvent(e);
        } else {
          eventBuffer.push(e);
          if (!bufferTimeout) {
            bufferTimeout = setTimeout(flushBuffer, 100);
          }
        }
      },
    });

    sessionRef.current = session;
    return session;
  }, [ingestEvent, processEvent]);

  useEffect(() => {
    if (!initialRunId || initialRunId === "new") return;

    let ws: WebSocket | null = null;
    let cancelled = false;

    fetchRunTrace(initialRunId)
      .then((trace) => {
        if (cancelled) return;
        setActualRunId(trace.run_id ?? initialRunId);
        if (trace.status === "running") {
          setStatus("running");
          setHasStarted(true);
          ws = subscribeRunStream(initialRunId, (raw) => {
            processEvent(raw as RunEvent);
          });
        } else {
          setStatus(trace.status === "failed" ? "error" : "completed");
          if (trace.error) setError(trace.error);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [initialRunId, processEvent]);

  useEffect(() => {
    if (options?.persist) return;
    return () => {
      intentionalCloseRef.current = true;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [options?.persist]);

  const validReplayIndex = useMemo(() => {
    if (snapshots.length === 0) return 0;
    return Math.max(0, Math.min(replayIndex, snapshots.length - 1));
  }, [replayIndex, snapshots.length]);

  const latestSnapshot = snapshots[snapshots.length - 1];
  const replayState = snapshots[validReplayIndex]?.state;
  const shownState =
    (isLive ? latestSnapshot?.state : replayState) || latestSnapshot?.state || {};

  const filteredEvents = useMemo(() => {
    if (isLive || snapshots.length === 0) return events;
    if (validReplayIndex >= snapshots.length) return events;

    const currentSnapshot = snapshots[validReplayIndex];
    if (!currentSnapshot) return events;

    return events.filter((e) => {
      if (e.step_index === undefined || e.step_index === null) {
        return validReplayIndex === 0;
      }
      return e.step_index <= currentSnapshot.step;
    });
  }, [events, snapshots, validReplayIndex, isLive]);

  const computedDiffs = useMemo((): DiffItem[] => {
    if (!filteredEvents.length) return [];

    if (!isLive && snapshots.length > 0 && validReplayIndex > 0) {
      const currentState = snapshots[validReplayIndex]?.state;
      const prevState = snapshots[validReplayIndex - 1]?.state;
      if (currentState && prevState) {
        return diffStates(prevState, currentState);
      }
    }

    const stateTransitions: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }> =
      [];
    let prevState: Record<string, unknown> = {};

    for (const e of filteredEvents) {
      if (e.event === "on_chain_end" && e.metadata?.langgraph_node) {
        const out = (e.data as { output?: unknown } | undefined)?.output || e.state_snapshot;
        if (out && typeof out === "object") {
          const cleanOut = cleanState(out as Record<string, unknown>);
          if (Object.keys(prevState).length > 0) {
            stateTransitions.push({ before: prevState, after: cleanOut });
          }
          prevState = cleanOut;
        }
      } else if (e.state_snapshot) {
        const cleanStateSnapshot = cleanState(e.state_snapshot);
        if (Object.keys(prevState).length > 0) {
          stateTransitions.push({ before: prevState, after: cleanStateSnapshot });
        }
        prevState = cleanStateSnapshot;
      }
    }

    if (stateTransitions.length > 0) {
      const lastTransition = stateTransitions[stateTransitions.length - 1];
      return diffStates(lastTransition.before, lastTransition.after);
    }

    return [];
  }, [filteredEvents, snapshots, validReplayIndex, isLive]);

  const isRunning = status === "running";

  const startTask = useCallback(
    (question: string, options?: RunLaunchOptions) => {
      setError(null);
      setStatus("running");
      setHasStarted(true);
      const session = ensureSession();
      session.sendStart(question, options);
    },
    [ensureSession]
  );

  const sendFollowUp = useCallback(
    (question: string, options?: RunLaunchOptions) => {
      if (!hasStarted) {
        startTask(question, options);
        return;
      }
      setError(null);
      setStatus("running");
      const session = ensureSession();
      session.sendFollowUp(question, options);
    },
    [ensureSession, hasStarted, startTask]
  );

  const resetSession = useCallback(() => {
    intentionalCloseRef.current = true;
    sessionRef.current?.close();
    sessionRef.current = null;
    setEvents([]);
    setSnapshots([]);
    setReplayIndex(0);
    setIsLive(true);
    setActualRunId(null);
    setStatus("idle");
    setError(null);
    setHasStarted(false);
  }, []);

  const toggleLive = useCallback(() => {
    setIsLive((v) => {
      const newLive = !v;
      if (newLive && snapshots.length > 0) {
        setReplayIndex(snapshots.length - 1);
      } else if (!newLive && snapshots.length > 0) {
        setReplayIndex((idx) => Math.max(0, Math.min(idx, snapshots.length - 1)));
      }
      return newLive;
    });
  }, [snapshots.length]);

  const setReplayIndexClamped = useCallback(
    (v: number) => {
      setReplayIndex(Math.max(0, Math.min(v, Math.max(0, snapshots.length - 1))));
    },
    [snapshots.length]
  );

  return {
    events,
    snapshots,
    replayIndex: validReplayIndex,
    isLive,
    actualRunId,
    shownState,
    filteredEvents,
    computedDiffs,
    status,
    isRunning,
    error,
    hasStarted,
    startTask,
    sendFollowUp,
    resetSession,
    setIsLive: toggleLive,
    setReplayIndex: setReplayIndexClamped,
  };
}
