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
  /** 'roster' = implied by the team structure; 'observed' = seen on the board; 'chat' = you chat with it directly. */
  kind: 'roster' | 'observed' | 'chat';
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
  /** What the worker sent back: the card's result, else its latest run summary (first 300 chars). */
  reply?: string | null;
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

/** One direct chat with a profile (terminal, desktop app, messaging), from its session store. */
export interface ChatSession {
  id: string;
  /** Where the chat happened: cli, desktop, oneshot, telegram, … */
  source: string;
  title: string;
  lastAt: number;
  messages: number;
  /** True while the profile is still producing its reply. */
  working: boolean;
  /** What it's doing right now, e.g. "thinking" or "used terminal". */
  step: string | null;
  /** How the latest turn in this chat ended (or 'working'). */
  outcome: TurnOutcome;
  /** When the latest turn ended or last progressed (unix seconds). */
  outcomeAt: number | null;
  /** First line of the error for a failed turn. */
  error: string | null;
}

export type TurnOutcome = 'working' | 'completed' | 'failed' | 'cut-off' | 'interrupted' | 'none';

/** One Hermes scheduled job (`hermes cron`), read from a profile's cron/jobs.json. */
export interface HermesJob {
  id: string;
  profileId: string;
  name: string;
  /** Plain words: "Every 30 min", "Weekdays at 09:00". */
  scheduleText: string;
  /** scheduled · running · paused · error · completed */
  state: 'scheduled' | 'running' | 'paused' | 'error' | 'completed';
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  pausedReason: string | null;
  /** First line of the latest run's response, when saved. */
  lastReply: string | null;
  /** Newest first, at most 8: one dot per run. */
  runs: Array<{ at: number; status: 'completed' | 'failed' | 'running' | 'other' }>;
}

export interface ProfileActivity {
  profileId: string;
  working: boolean;
  step: string | null;
  current: ChatSession | null;
  /** The most recent chat's latest turn (working or finished). */
  lastTurn: ChatSession | null;
  lastActiveAt: number | null;
  chats24h: number;
  recent: ChatSession[];
}

/** A Hermes install Workable can show (from WORKABLE_HERMES_HOMES). */
export interface HermesHomeOption {
  id: string;
  label: string;
  path: string;
}

export interface HermesSnapshot {
  home: string;
  /** Id of the install shown, and the installs the viewer can switch between. */
  homeId: string;
  homes: HermesHomeOption[];
  /** Live chat activity per profile. */
  activity: ProfileActivity[];
  /** Scheduled jobs across all profiles (`hermes cron`). */
  jobs?: HermesJob[];
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
  /** True when WORKABLE_HERMES_EDIT is on, so the view offers edit controls. */
  editable: boolean;
  warnings: string[];
}

export interface HermesTaskDetail {
  task: HermesTask;
  events: HermesEvent[];
  runs: HermesRun[];
}

/** What the browser sees of an edit plan (no staging paths or file hashes). */
export interface EditPlanView {
  id: string;
  op: 'add-agent' | 'edit-agent' | 'add-project';
  title: string;
  home: string;
  changes: Array<{ path: string; label: string; before: string; after: string }>;
  steps: Array<{ label: string; command: string }>;
  warnings: string[];
}

export interface EditApplyResult {
  ok: boolean;
  steps: Array<{ label: string; ok: boolean; output: string }>;
  backupDir: string | null;
  error?: string;
}
