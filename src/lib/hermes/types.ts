/**
 * hermes/types.ts — Shapes shared by the Hermes bridge (server) and the
 * Hermes view (client). Everything here is plain JSON so it can cross the
 * /api/hermes boundary unchanged.
 */

/** Workable's five task-dot states (same vocabulary as NodeTask.status). */
export type DotStatus = 'todo' | 'in-progress' | 'review' | 'blocked' | 'done';

/** Raw Hermes kanban statuses (tasks.status). */
export type HermesTaskStatus =
  | 'triage' | 'todo' | 'ready' | 'scheduled' | 'running'
  | 'blocked' | 'review' | 'done' | 'archived';

export interface HermesProfile {
  /** Profile id as Hermes addresses it on the board ("default" for the root profile). */
  id: string;
  /** Human name (display_name for the default profile, otherwise the id). */
  name: string;
  description: string;
  model: string | null;
  isDefault: boolean;
  /** True when computer_use is disabled — i.e. the profile runs as an unattended worker. */
  unattended: boolean;
  disabledToolsets: string[];
}

export interface HermesEdge {
  id: string;
  source: string;
  target: string;
  /** 'roster' = implied by the team structure; 'observed' = seen on the board. */
  kind: 'roster' | 'observed';
  /** Number of cards that flowed source → target (observed edges only). */
  count: number;
}

export interface HermesTask {
  id: string;
  title: string;
  assignee: string | null;
  createdBy: string | null;
  status: HermesTaskStatus;
  dot: DotStatus;
  priority: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  consecutiveFailures: number;
  lastFailureError: string | null;
  tenant: string | null;
  projectId: string | null;
}

export interface HermesEvent {
  id: number;
  taskId: string;
  taskTitle: string;
  kind: string;
  createdAt: number;
  /** Profile the event travels from / to, when it represents a hand-off. */
  from: string | null;
  to: string | null;
  /** Profile the event happens on, for events that don't travel. */
  at: string | null;
  summary: string | null;
}

export interface HermesRun {
  id: number;
  taskId: string;
  profile: string | null;
  status: string;
  outcome: string | null;
  startedAt: number;
  endedAt: number | null;
  error: string | null;
}

export interface ProfileMetrics {
  profileId: string;
  /** Cards currently waiting to be picked up (todo/ready/scheduled/triage). */
  queued: number;
  running: number;
  blocked: number;
  /** Cards sitting in review with this profile as the reviewer. */
  reviewQueue: number;
  /** Seconds the oldest review card has been waiting, or null. */
  oldestReviewWait: number | null;
  /** Median seconds a card waited in review before leaving it (history). */
  medianReviewWait: number | null;
  /** Finished runs over the metrics window. */
  runs: number;
  successRate: number | null;
  medianRunSeconds: number | null;
  failures: number;
  lastError: string | null;
  /** 0–1 composite load score used for heat colouring. */
  load: number;
}

export interface Bottleneck {
  profileId: string;
  reason: string;
  /** Suggested next step, phrased for the human operator. */
  suggestion: string;
}

export interface HermesBoard {
  slug: string;
  name: string;
  description: string;
  projectId: string | null;
}

export interface HermesProject {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  boardSlug: string | null;
}

export interface HermesSnapshot {
  home: string;
  board: HermesBoard | null;
  boards: HermesBoard[];
  projects: HermesProject[];
  profiles: HermesProfile[];
  edges: HermesEdge[];
  tasks: HermesTask[];
  events: HermesEvent[];
  metrics: ProfileMetrics[];
  bottleneck: Bottleneck | null;
  /** Unix seconds when the snapshot was read. */
  generatedAt: number;
  /** True when the payload is illustrative sample data, not the live board. */
  sample: boolean;
  warnings: string[];
}

export interface HermesTaskDetail {
  task: HermesTask;
  events: HermesEvent[];
  runs: HermesRun[];
}
