/**
 * templates.ts — Pre-built workflow templates for the template gallery.
 *
 * Each template ships with:
 *   • Metadata   — name, description, density label, node/edge counts
 *   • Node list  — custom node definitions (roles: person/tool/external/output)
 *   • Edge list  — directed edges with sequence numbers
 *   • Rich data  — per-node summaries, statuses, tasks + workflow groups
 *
 * buildTemplateState() runs the layout algorithms and returns the full
 * importState payload expected by PUT /api/graph-state.
 */

import { hierarchicalLayout, radialWebLayout } from "./layout";
import { CORE_NODE_IDS, ROLE_COLOR } from "./constants";
import type { NodeTask, WorkflowGroup } from "./serverState";
import { JACK_ROUTINE_DEMO_ANALYSIS, JACK_ROUTINE_DEMO_AI_JSON } from "./demoAnalysis";
import { getNodeLabel, getGroupName } from "./templateTranslations";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeRole = "person" | "tool" | "external" | "output";

export interface TplNode {
  id: string;
  label: string;
  initials: string;
  role: NodeRole;
  textColor?: string;
}

export interface TplEdge {
  source: string;
  target: string;
  sequence?: number;
  weight?: number;
}

export interface TplNodeMeta {
  status?: string;
  statusColor?: string;
  summary?: string;
  processes?: string[];
  connections?: string[];
  tasks?: NodeTask[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  density: "few" | "some" | "many";
  nodeCount: number;
  edgeCount: number;
  /** If true the built-in Ridgeview core nodes are kept visible. */
  useBuiltins?: boolean;
  nodes: TplNode[];
  edges: TplEdge[];
  /** Per-node rich metadata shipped with the template. */
  nodeMeta?: Record<string, TplNodeMeta>;
  /** Named workflow groups pre-configured for this template. */
  workflowGroups?: WorkflowGroup[];
  /** Pre-baked AI analysis for demo purposes. */
  demoAnalysis?: any;
}

// ── Template definitions ──────────────────────────────────────────────────────

export const TEMPLATES: Template[] = [

  // ── 0. Demo: Jack's Routine (Mocked AI Analysis) ──────────────────────────
  {
    id: "demo-jack",
    name: "Demo: Jack's Routine",
    description: "A pre-baked scenario showcasing instant AI optimization, Fishbone diagrams, and automated root-cause analysis.",
    density: "few",
    nodeCount: 8,
    edgeCount: 10,
    demoAnalysis: JACK_ROUTINE_DEMO_ANALYSIS,
    workflowGroups: typeof JACK_ROUTINE_DEMO_AI_JSON === 'string' ? JSON.parse(JACK_ROUTINE_DEMO_AI_JSON).groups : [],
    nodes: [
      { id: "jack",       label: "Jack",            initials: "J",  role: "person"   },
      { id: "bloomberg",  label: "Bloomberg T.",    initials: "BT", role: "external" },
      { id: "reconciler", label: "Python Recon",    initials: "PR", role: "tool"     },
      { id: "postgresql", label: "internal DB",     initials: "DB", role: "tool"     },
      { id: "sarah",      label: "Sarah (PM)",      initials: "S",  role: "person"   },
      { id: "dashboard",  label: "Client Dash",     initials: "CD", role: "output"   },
      { id: "mary",       label: "Mary (HR)",       initials: "M",  role: "person"   },
      { id: "jason",      label: "Jason (Supv)",    initials: "JS", role: "person"   },
    ],
    edges: [
      { source: "bloomberg",  target: "jack",       sequence: 1 },
      { source: "jack",       target: "reconciler", sequence: 2 },
      { source: "reconciler", target: "postgresql", sequence: 3 },
      { source: "reconciler", target: "sarah",      sequence: 3 },
      { source: "sarah",      target: "jack",       sequence: 4 },
      { source: "jack",       target: "dashboard",  sequence: 5 },
      { source: "mary",       target: "jack",       sequence: 6 },
      { source: "jason",      target: "mary",       sequence: 7 },
      { source: "mary",       target: "sarah",      sequence: 8 },
    ],
    nodeMeta: {
      jack: {
        summary: "Primary analyst responsible for EOD numbers. Currently manual gatekeeper for reconciliation files.",
        tasks: [{ id: "t_slack_sarah", title: "Slack Sarah if breaks occur", status: "todo", priority: "high" }]
      },
      sarah: {
        summary: "Portfolio Manager. Must manually vet every exception before Jack can commit to the Dashboard.",
      }
    }
  },


  // ── 0. Blank Canvas ──────────────────────────────────────────────────────
  {
    id: "blank",
    name: "Blank Canvas",
    description: "Start from scratch — drag in nodes and draw connections yourself.",
    density: "few",
    nodeCount: 0,
    edgeCount: 0,
    nodes: [],
    edges: [],
  },

  // ── 1. Morning Routine (~7 nodes) ─────────────────────────────────────────
  {
    id: "morning-routine",
    name: "Morning Routine",
    description: "Personal daily startup: wake-up → review → plan → deep work. A simple 7-step flow centered on you.",
    density: "few",
    nodeCount: 7,
    edgeCount: 8,
    nodes: [
      { id: "me",       label: "You",             initials: "ME", role: "person"   },
      { id: "inbox",    label: "Email / Inbox",   initials: "IN", role: "external" },
      { id: "calendar", label: "Calendar",         initials: "CA", role: "tool"     },
      { id: "notes",    label: "Notes / Journal",  initials: "NT", role: "tool"     },
      { id: "todoist",  label: "Task List",        initials: "TL", role: "tool"     },
      { id: "standup",  label: "Team Stand-up",    initials: "SU", role: "person"   },
      { id: "deepwork", label: "Deep Work Block",  initials: "DW", role: "output"   },
    ],
    edges: [
      { source: "inbox",    target: "me",       sequence: 1 },
      { source: "calendar", target: "me",       sequence: 1 },
      { source: "me",       target: "notes",    sequence: 2 },
      { source: "me",       target: "todoist",  sequence: 2 },
      { source: "notes",    target: "standup",  sequence: 3 },
      { source: "todoist",  target: "standup",  sequence: 3 },
      { source: "standup",  target: "deepwork", sequence: 4 },
      { source: "todoist",  target: "deepwork", sequence: 4 },
    ],
    nodeMeta: {
      me: {
        status: "active", statusColor: "#4F46E5",
        summary: "The hub of your morning. You synthesise all incoming signals and decide what matters today.",
        processes: ["Review inbox digest", "Scan calendar for conflicts", "Set daily intention"],
        tasks: [
          { id: "me-t1", title: "Write 3 priorities for today", status: "todo",        priority: "high",   dueDate: "2026-03-19", note: "Do this before opening Slack." },
          { id: "me-t2", title: "10-min meditation",            status: "in-progress", priority: "medium", note: "Use Headspace – morning pack." },
          { id: "me-t3", title: "Log yesterday's wins",         status: "done",        priority: "low" },
        ],
      },
      inbox: {
        status: "active", statusColor: "#64748B",
        summary: "External trigger. Incoming email and notifications that need triage before the day starts.",
        processes: ["Unread scan (2 min cap)", "Flag action items", "Archive newsletters"],
        tasks: [
          { id: "in-t1", title: "Unsubscribe from 5 mailing lists", status: "todo",    priority: "low",  note: "Use unroll.me or manual unsubscribe." },
          { id: "in-t2", title: "Set up inbox filters for GitHub",   status: "blocked", priority: "medium", note: "Waiting on IT to whitelist domain." },
        ],
      },
      calendar: {
        status: "active", statusColor: "#64748B",
        summary: "Daily schedule anchor. Shows what's fixed, what can move, and when the next available deep-work slot is.",
        processes: ["Check next 48 h", "Block focus time if missing", "Decline low-value meetings"],
        tasks: [
          { id: "ca-t1", title: "Block 9–11 AM as deep-work daily", status: "in-progress", priority: "high", note: "Recurring block, no exceptions Mon–Thu." },
          { id: "ca-t2", title: "Audit recurring meetings",          status: "todo",        priority: "medium" },
        ],
      },
      notes: {
        status: "active", statusColor: "#0EA5E9",
        summary: "Capture layer. Fleeting ideas, yesterday's loose ends, and today's intentions all land here before being filtered.",
        processes: ["Brain-dump (5 min)", "Review yesterday's notes", "Highlight 1 idea to explore"],
        tasks: [
          { id: "nt-t1", title: "Migrate notes to Obsidian daily folder", status: "in-progress", priority: "medium" },
          { id: "nt-t2", title: "Create weekly review template",           status: "todo",        priority: "high",   note: "Include energy / output / wins sections." },
        ],
      },
      todoist: {
        status: "active", statusColor: "#0EA5E9",
        summary: "Task triage. Converts intentions into an ordered, time-boxed action list so nothing falls through the cracks.",
        processes: ["Review backlog", "Assign today's tasks to time slots", "Mark stale tasks"],
        tasks: [
          { id: "tl-t1", title: "Implement recurring task review every Friday", status: "todo",    priority: "medium" },
          { id: "tl-t2", title: "Purge tasks older than 30 days",               status: "done",    priority: "low" },
          { id: "tl-t3", title: "Add 'energy level' label to tasks",            status: "blocked", priority: "medium", note: "Need Todoist Pro for custom labels." },
        ],
      },
      standup: {
        status: "active", statusColor: "#10B981",
        summary: "Social alignment. Quick pulse-check with the team surfaces blockers and shared context before focused work begins.",
        processes: ["What did I do yesterday?", "What am I doing today?", "Any blockers to call out?"],
        tasks: [
          { id: "su-t1", title: "Prepare 30-sec update the night before", status: "todo",    priority: "medium" },
          { id: "su-t2", title: "Move standup to async Slack thread",     status: "review",  priority: "high", note: "Proposal drafted — needs team buy-in." },
        ],
      },
      deepwork: {
        status: "active", statusColor: "#10B981",
        summary: "The output. Protected, distraction-free time where the real value gets created. Guard it fiercely.",
        processes: ["Silence notifications", "Single-task on top priority", "Log output at end of session"],
        tasks: [
          { id: "dw-t1", title: "Finish Q2 strategy doc first draft",   status: "in-progress", priority: "high",   dueDate: "2026-03-21" },
          { id: "dw-t2", title: "Prototype new onboarding flow in Figma", status: "todo",       priority: "high",   dueDate: "2026-03-25" },
          { id: "dw-t3", title: "Review PR backlog",                      status: "todo",       priority: "medium" },
        ],
      },
    },
    workflowGroups: [
      {
        id: "grp-mr-inputs",
        name: "Morning Inputs",
        color: "#6366F1",
        nodeIds: ["inbox", "calendar"],
      },
      {
        id: "grp-mr-planning",
        name: "Planning Layer",
        color: "#0EA5E9",
        nodeIds: ["me", "notes", "todoist"],
      },
      {
        id: "grp-mr-output",
        name: "Execution",
        color: "#10B981",
        nodeIds: ["standup", "deepwork"],
      },
    ],
  },

  // ── 2. Project Workflow (~14 nodes) ──────────────────────────────────────
  {
    id: "project-workflow",
    name: "Project Workflow",
    description: "You at the hub: idea → research → writing → review → publish. ~14 steps with tools and collaborators.",
    density: "some",
    nodeCount: 14,
    edgeCount: 17,
    nodes: [
      { id: "me2",       label: "You",             initials: "ME", role: "person"   },
      { id: "idea",      label: "Idea / Brief",    initials: "ID", role: "external" },
      { id: "research",  label: "Research",        initials: "RS", role: "tool"     },
      { id: "notion",    label: "Notion",          initials: "NO", role: "tool"     },
      { id: "outline",   label: "Outline",         initials: "OL", role: "tool"     },
      { id: "draft",     label: "Draft",           initials: "DR", role: "output"   },
      { id: "loom",      label: "Loom / Record",   initials: "LM", role: "tool"     },
      { id: "reviewer1", label: "Reviewer A",      initials: "R1", role: "person"   },
      { id: "reviewer2", label: "Reviewer B",      initials: "R2", role: "person"   },
      { id: "figma2",    label: "Figma / Design",  initials: "FG", role: "tool"     },
      { id: "feedback",  label: "Feedback Loop",   initials: "FB", role: "external" },
      { id: "publish",   label: "Publish",         initials: "PB", role: "output"   },
      { id: "metrics",   label: "Analytics",       initials: "AN", role: "output"   },
      { id: "archive",   label: "Archive / Docs",  initials: "AR", role: "tool"     },
    ],
    edges: [
      { source: "idea",      target: "me2",      sequence: 1 },
      { source: "me2",       target: "research",  sequence: 2 },
      { source: "me2",       target: "notion",    sequence: 2 },
      { source: "research",  target: "outline",   sequence: 3 },
      { source: "notion",    target: "outline",   sequence: 3 },
      { source: "outline",   target: "draft",     sequence: 4 },
      { source: "draft",     target: "loom",      sequence: 5 },
      { source: "draft",     target: "figma2",    sequence: 5 },
      { source: "draft",     target: "reviewer1", sequence: 5 },
      { source: "draft",     target: "reviewer2", sequence: 5 },
      { source: "reviewer1", target: "feedback",  sequence: 6 },
      { source: "reviewer2", target: "feedback",  sequence: 6 },
      { source: "feedback",  target: "me2",       sequence: 6 },
      { source: "figma2",    target: "publish",   sequence: 7 },
      { source: "loom",      target: "publish",   sequence: 7 },
      { source: "publish",   target: "metrics",   sequence: 8 },
      { source: "publish",   target: "archive",   sequence: 8 },
    ],
    nodeMeta: {
      me2: {
        status: "active", statusColor: "#4F46E5",
        summary: "Central coordinator. Receives the brief, breaks it into tracks, and integrates feedback to ship a polished deliverable.",
        processes: ["Kick-off scoping", "Assign sub-tasks", "Quality review before publish"],
        tasks: [
          { id: "me2-t1", title: "Write project brief for Q2 campaign",     status: "in-progress", priority: "high",   dueDate: "2026-03-20" },
          { id: "me2-t2", title: "Schedule sync with Reviewer A and B",     status: "todo",        priority: "medium", dueDate: "2026-03-22" },
          { id: "me2-t3", title: "Archive previous project assets in Notion", status: "done",      priority: "low" },
        ],
      },
      idea: {
        status: "active", statusColor: "#F59E0B",
        summary: "The seed. A brief, RFP, or spontaneous idea that kicks off the project. Captured in writing before anything else.",
        processes: ["Brief intake form", "Stakeholder sign-off", "Scope boundaries agreed"],
        tasks: [
          { id: "id-t1", title: "Formalise idea template in Notion",   status: "todo",    priority: "medium" },
          { id: "id-t2", title: "Map top 3 ideas from last brainstorm", status: "review",  priority: "high" },
        ],
      },
      research: {
        status: "active", statusColor: "#64748B",
        summary: "Evidence gathering. Competitive analysis, user interviews, or desk research that grounds the project in real-world context.",
        processes: ["Define research questions", "Collect sources", "Synthesise key insights"],
        tasks: [
          { id: "rs-t1", title: "Competitive analysis — 5 alternatives",  status: "in-progress", priority: "high",   dueDate: "2026-03-21" },
          { id: "rs-t2", title: "User interview summary doc",             status: "todo",        priority: "high" },
          { id: "rs-t3", title: "Set up shared research Notion database", status: "done",        priority: "medium" },
        ],
      },
      notion: {
        status: "active", statusColor: "#64748B",
        summary: "Knowledge base and project hub. All notes, references, and work-in-progress docs live here for the team to access.",
        processes: ["Create project page", "Link research sources", "Keep status table current"],
        tasks: [
          { id: "no-t1", title: "Templatise project kickoff page", status: "todo",  priority: "medium" },
          { id: "no-t2", title: "Connect Notion to Slack alerts",  status: "blocked", priority: "low", note: "Need workspace admin approval." },
        ],
      },
      outline: {
        status: "active", statusColor: "#64748B",
        summary: "Structural scaffold. Transforms research insights into a logical sequence before any production begins.",
        processes: ["Draft H1/H2 structure", "Allocate word/time counts per section", "Team sign-off"],
        tasks: [
          { id: "ol-t1", title: "Build outline for hero landing page",   status: "in-progress", priority: "high" },
          { id: "ol-t2", title: "Review outline with Reviewer A",         status: "todo",        priority: "medium", dueDate: "2026-03-23" },
        ],
      },
      draft: {
        status: "active", statusColor: "#10B981",
        summary: "First full production pass. All content and design elements come together. Expect 2–3 revision cycles.",
        processes: ["Write full draft", "Internal self-review", "Flag open questions"],
        tasks: [
          { id: "dr-t1", title: "Complete hero copy first pass",       status: "in-progress", priority: "high",   dueDate: "2026-03-24" },
          { id: "dr-t2", title: "Add placeholders for missing visuals", status: "todo",        priority: "medium" },
        ],
      },
      loom: {
        status: "todo", statusColor: "#64748B",
        summary: "Async walkthrough. A short Loom recording explains the rationale behind key decisions so reviewers have context.",
        processes: ["Record 3-min walkthrough", "Add timestamps for key sections", "Share link in review thread"],
        tasks: [
          { id: "lm-t1", title: "Record Loom overview of draft",  status: "todo", priority: "medium", dueDate: "2026-03-25" },
          { id: "lm-t2", title: "Create Loom workspace for team", status: "done", priority: "low" },
        ],
      },
      reviewer1: {
        status: "active", statusColor: "#4F46E5",
        summary: "Subject-matter expert reviewer. Checks accuracy, tone, and strategic alignment before external distribution.",
        processes: ["Read draft end-to-end", "Leave inline comments", "Approve or flag for revision"],
        tasks: [
          { id: "r1-t1", title: "Review draft by EOD Friday", status: "todo",    priority: "high",   dueDate: "2026-03-21" },
          { id: "r1-t2", title: "Align on review checklist",  status: "in-progress", priority: "medium" },
        ],
      },
      reviewer2: {
        status: "active", statusColor: "#4F46E5",
        summary: "Editorial / design reviewer. Ensures consistency with brand guidelines and catches copy errors.",
        processes: ["Brand voice check", "Grammar / readability pass", "Visual consistency audit"],
        tasks: [
          { id: "r2-t1", title: "Share brand guide PDF with team",        status: "done", priority: "low" },
          { id: "r2-t2", title: "Review visual assets for brand alignment", status: "todo", priority: "high", dueDate: "2026-03-22" },
        ],
      },
      figma2: {
        status: "in-progress", statusColor: "#0EA5E9",
        summary: "Design production. Translates the draft content into polished layouts ready for handoff or publication.",
        processes: ["Apply brand system", "Responsive breakpoints", "Export assets at 2×"],
        tasks: [
          { id: "fg-t1", title: "Design hero section — desktop + mobile", status: "in-progress", priority: "high",   dueDate: "2026-03-24" },
          { id: "fg-t2", title: "Create social share card variants",      status: "todo",        priority: "medium" },
          { id: "fg-t3", title: "Handoff spec to dev in Figma",           status: "todo",        priority: "high" },
        ],
      },
      feedback: {
        status: "active", statusColor: "#F59E0B",
        summary: "Consolidation point. Reviewer comments are aggregated, prioritised, and turned into a revision brief.",
        processes: ["Collate all comments", "Prioritise high vs nice-to-have", "Assign revision tasks to owner"],
        tasks: [
          { id: "fb-t1", title: "Build feedback matrix template", status: "todo",    priority: "medium" },
          { id: "fb-t2", title: "Schedule 20-min feedback debrief", status: "in-progress", priority: "high", dueDate: "2026-03-23" },
        ],
      },
      publish: {
        status: "todo", statusColor: "#10B981",
        summary: "Go live. Content is published, assets deployed, and distribution channels activated simultaneously.",
        processes: ["Final QA checklist", "Staged deploy (staging → prod)", "Announce across channels"],
        tasks: [
          { id: "pb-t1", title: "Publish checklist — 12 items",     status: "todo",    priority: "high",   dueDate: "2026-03-28" },
          { id: "pb-t2", title: "Pre-schedule social posts",         status: "todo",    priority: "medium", dueDate: "2026-03-27" },
          { id: "pb-t3", title: "Alert customer success team",       status: "todo",    priority: "low" },
        ],
      },
      metrics: {
        status: "todo", statusColor: "#10B981",
        summary: "Success measurement. Tracks reach, engagement, and conversion against the goals set in the brief.",
        processes: ["Set up UTM tracking", "Dashboard in Looker", "Week-1 review meeting"],
        tasks: [
          { id: "an-t1", title: "Define 3 success KPIs for launch", status: "todo", priority: "high" },
          { id: "an-t2", title: "Connect analytics to Notion dashboard", status: "blocked", priority: "medium", note: "Waiting on data team to grant API access." },
        ],
      },
      archive: {
        status: "todo", statusColor: "#64748B",
        summary: "Institutional memory. Finished project assets are tagged, versioned, and stored so future teams can reuse them.",
        processes: ["Tag all assets with project ID", "Write project retro doc", "Move to archive folder"],
        tasks: [
          { id: "ar-t1", title: "Write project retrospective doc", status: "todo", priority: "medium", dueDate: "2026-04-04" },
          { id: "ar-t2", title: "Tag and archive all Figma frames", status: "todo", priority: "low" },
        ],
      },
    },
    workflowGroups: [
      {
        id: "grp-pw-discovery",
        name: "Discovery",
        color: "#F59E0B",
        nodeIds: ["idea", "me2", "research", "notion"],
      },
      {
        id: "grp-pw-production",
        name: "Production",
        color: "#6366F1",
        nodeIds: ["outline", "draft", "loom", "figma2"],
      },
      {
        id: "grp-pw-review",
        name: "Review Loop",
        color: "#EF4444",
        nodeIds: ["reviewer1", "reviewer2", "feedback"],
      },
      {
        id: "grp-pw-distribution",
        name: "Distribution",
        color: "#10B981",
        nodeIds: ["publish", "metrics", "archive"],
      },
    ],
  },

  // ── 3. Full Work Week (~22 nodes) ─────────────────────────────────────────
  {
    id: "full-week",
    name: "Full Work Week",
    description: "Your complete weekly system: inputs, deep work blocks, meetings, reviews, and outputs — all mapped.",
    density: "many",
    nodeCount: 22,
    edgeCount: 26,
    nodes: [
      // ── Inputs (external triggers) ─────────────────────────────────────
      { id: "email",      label: "Email",          initials: "EM", role: "external" },
      { id: "slack",      label: "Slack / Chat",   initials: "SL", role: "external" },
      { id: "news",       label: "News / RSS",     initials: "NW", role: "external" },
      { id: "client",     label: "Client Request", initials: "CR", role: "external" },
      { id: "ideas",      label: "Ideas Inbox",    initials: "II", role: "external" },
      // ── Capture & Planning ────────────────────────────────────────────
      { id: "capture",    label: "Daily Capture",  initials: "DC", role: "tool"     },
      { id: "calendar2",  label: "Calendar",       initials: "CA", role: "tool"     },
      { id: "taskmgr",    label: "Task Manager",   initials: "TM", role: "tool"     },
      // ── You (hub) ─────────────────────────────────────────────────────
      { id: "you",        label: "You",            initials: "ME", role: "person"   },
      // ── Deep work blocks ──────────────────────────────────────────────
      { id: "deepw1",     label: "Deep Work A.M.", initials: "D1", role: "tool"     },
      { id: "deepw2",     label: "Deep Work P.M.", initials: "D2", role: "tool"     },
      { id: "research2",  label: "Research",       initials: "RS", role: "tool"     },
      // ── Collaboration ─────────────────────────────────────────────────
      { id: "standup2",   label: "Stand-up",       initials: "SU", role: "person"   },
      { id: "collab1",    label: "Collaborator A", initials: "C1", role: "person"   },
      { id: "collab2",    label: "Collaborator B", initials: "C2", role: "person"   },
      { id: "review2",    label: "Review Meeting", initials: "RM", role: "person"   },
      // ── Tools ────────────────────────────────────────────────────────
      { id: "notion2",    label: "Notion / Docs",  initials: "NO", role: "tool"     },
      { id: "github2",    label: "GitHub / Code",  initials: "GH", role: "tool"     },
      // ── Outputs ──────────────────────────────────────────────────────
      { id: "deliverable", label: "Deliverable",    initials: "DL", role: "output"  },
      { id: "published",   label: "Published",      initials: "PB", role: "output"  },
      { id: "weekreview",  label: "Week Review",    initials: "WR", role: "output"  },
      { id: "kpi",         label: "KPIs / Metrics", initials: "KP", role: "output"  },
    ],
    edges: [
      // Inputs → Capture
      { source: "email",    target: "capture",    sequence: 1 },
      { source: "slack",    target: "capture",    sequence: 1 },
      { source: "news",     target: "capture",    sequence: 1 },
      { source: "client",   target: "capture",    sequence: 1 },
      { source: "ideas",    target: "capture",    sequence: 1 },
      // Capture & Planning → You
      { source: "capture",  target: "you",        sequence: 2 },
      { source: "calendar2",target: "you",        sequence: 2 },
      { source: "taskmgr",  target: "you",        sequence: 2 },
      // You → Deep work + collab (NOTE: no back-edge from standup2 to taskmgr — avoids cycle)
      { source: "you",      target: "deepw1",     sequence: 3 },
      { source: "you",      target: "deepw2",     sequence: 3 },
      { source: "you",      target: "research2",  sequence: 3 },
      { source: "you",      target: "standup2",   sequence: 3 },
      { source: "you",      target: "collab1",    sequence: 3 },
      { source: "you",      target: "collab2",    sequence: 3 },
      // Deep work → tools + outputs
      { source: "deepw1",   target: "notion2",    sequence: 4 },
      { source: "deepw1",   target: "github2",    sequence: 4 },
      { source: "deepw2",   target: "deliverable",sequence: 5 },
      { source: "research2",target: "notion2",    sequence: 4 },
      // Collab → review
      { source: "collab1",  target: "review2",    sequence: 4 },
      { source: "collab2",  target: "review2",    sequence: 4 },
      // Outputs
      { source: "notion2",  target: "published",  sequence: 5 },
      { source: "github2",  target: "deliverable",sequence: 5 },
      { source: "review2",  target: "deliverable",sequence: 5 },
      { source: "deliverable",target: "kpi",      sequence: 6 },
      { source: "published",  target: "kpi",      sequence: 6 },
      { source: "kpi",        target: "weekreview",sequence: 7 },
    ],
    nodeMeta: {
      you: {
        status: "active", statusColor: "#4F46E5",
        summary: "The central nervous system of your week. Receives all processed inputs, allocates focus, and routes work to the right output track.",
        processes: ["Morning planning ritual", "Energy management", "EOD shutdown routine"],
        tasks: [
          { id: "you-t1", title: "Plan the week every Monday 8 AM",      status: "in-progress", priority: "high" },
          { id: "you-t2", title: "Complete weekly review every Friday",   status: "todo",        priority: "high",   dueDate: "2026-03-22" },
          { id: "you-t3", title: "Identify one 'keystone' task per day",  status: "todo",        priority: "medium" },
        ],
      },
      email: {
        status: "active", statusColor: "#F59E0B",
        summary: "High-volume async input. Processed in two dedicated batches (morning / afternoon) to avoid constant context-switching.",
        processes: ["Batch at 9 AM and 3 PM", "OHIO rule (Only Handle It Once)", "CC → archive, TO → action"],
        tasks: [
          { id: "em-t1", title: "Enable email batching in Gmail",   status: "in-progress", priority: "high" },
          { id: "em-t2", title: "Create email SLA doc for team",    status: "todo",        priority: "medium", note: "Response within 4 h during work hours." },
        ],
      },
      slack: {
        status: "active", statusColor: "#F59E0B",
        summary: "Real-time chat channel. Notifications muted during deep work; checked in designated windows only.",
        processes: ["Mute during deep work", "Use threads not DMs", "Star action items"],
        tasks: [
          { id: "sl-t1", title: "Set Do Not Disturb schedule in Slack", status: "done",        priority: "high" },
          { id: "sl-t2", title: "Audit channels — archive unused ones",  status: "todo",        priority: "low" },
          { id: "sl-t3", title: "Create #wins channel for team",         status: "in-progress", priority: "medium" },
        ],
      },
      news: {
        status: "active", statusColor: "#64748B",
        summary: "Passive knowledge feed. RSS / newsletters consumed during low-energy windows to stay current without derailing focus.",
        processes: ["Read during commute or lunch", "Save 1–2 articles to Notion", "Delete the rest"],
        tasks: [
          { id: "nw-t1", title: "Curate RSS feed (max 10 sources)", status: "todo",    priority: "medium" },
          { id: "nw-t2", title: "Set up Readwise for highlights",    status: "in-progress", priority: "low" },
        ],
      },
      client: {
        status: "active", statusColor: "#EF4444",
        summary: "External demand signal. Client requests are the highest-priority input — triaged same day, responded within 24 h.",
        processes: ["Acknowledge within 2 h", "Log in task manager", "Clarify scope before starting"],
        tasks: [
          { id: "cr-t1", title: "Update client response SLA to 4 h", status: "review",  priority: "high" },
          { id: "cr-t2", title: "Build client request intake form",   status: "todo",    priority: "high",   dueDate: "2026-03-25" },
        ],
      },
      ideas: {
        status: "active", statusColor: "#8B5CF6",
        summary: "Personal ideation pool. Shower thoughts, reading highlights, and random sparks captured immediately before they evaporate.",
        processes: ["Capture within 60 seconds", "Weekly review and prune", "Promote best ideas to projects"],
        tasks: [
          { id: "ii-t1", title: "Migrate idea list to Notion Ideas DB", status: "in-progress", priority: "medium" },
          { id: "ii-t2", title: "Weekly 20-min idea review ritual",      status: "todo",        priority: "medium" },
        ],
      },
      capture: {
        status: "active", statusColor: "#0EA5E9",
        summary: "First-pass triage layer. All five input streams funnel here for processing into actionable tasks or archive.",
        processes: ["Morning inbox zero sweep", "Assign context tags (urgent / later / someday)", "Route to task manager or archive"],
        tasks: [
          { id: "dc-t1", title: "Create capture SOP document",           status: "todo",    priority: "medium" },
          { id: "dc-t2", title: "Set up 'Daily Capture' note template",  status: "done",    priority: "high" },
          { id: "dc-t3", title: "Review and refine capture tags weekly", status: "in-progress", priority: "low" },
        ],
      },
      calendar2: {
        status: "active", statusColor: "#0EA5E9",
        summary: "Time architecture. Shows the week's fixed commitments, guards deep work slots, and signals when you are over-allocated.",
        processes: ["Block deep work before meetings fill it", "Time-block tasks not just meetings", "Review next week every Friday"],
        tasks: [
          { id: "ca2-t1", title: "Audit all recurring meetings",            status: "in-progress", priority: "high" },
          { id: "ca2-t2", title: "Add 30-min weekly prep block on Sundays", status: "todo",        priority: "medium" },
        ],
      },
      taskmgr: {
        status: "active", statusColor: "#0EA5E9",
        summary: "Ground truth for commitments. Every task, project, and deadline lives here — no whiteboard, no sticky notes, no mental overhead.",
        processes: ["Daily review at 8:30 AM", "Weekly review every Friday PM", "Archive done tasks monthly"],
        tasks: [
          { id: "tm-t1", title: "Migrate all open tasks from email",   status: "in-progress", priority: "high" },
          { id: "tm-t2", title: "Set up projects for Q2 goals",        status: "todo",        priority: "high",   dueDate: "2026-03-20" },
          { id: "tm-t3", title: "Add recurring weekly review task",    status: "done",        priority: "medium" },
        ],
      },
      deepw1: {
        status: "active", statusColor: "#6366F1",
        summary: "Morning peak-energy block (9–11 AM). Reserved for the hardest, most cognitively demanding work of the day.",
        processes: ["No meetings before 11 AM", "Single task only", "Pomodoro 50/10 rhythm"],
        tasks: [
          { id: "d1-t1", title: "Protect 9–11 AM Mon–Thu in calendar", status: "done",        priority: "high" },
          { id: "d1-t2", title: "Experiment with 90-min focus block",   status: "in-progress", priority: "medium" },
          { id: "d1-t3", title: "Track output per deep work session",   status: "todo",        priority: "low" },
        ],
      },
      deepw2: {
        status: "active", statusColor: "#6366F1",
        summary: "Afternoon secondary block (2–4 PM). Used for high-focus but slightly lighter tasks — writing, design, code review.",
        processes: ["After lunch reset (walk 10 min)", "Creative / generative work", "Output logged in journal"],
        tasks: [
          { id: "d2-t1", title: "Identify best P.M. tasks for this block", status: "todo",    priority: "medium" },
          { id: "d2-t2", title: "Remove all P.M. meetings on Tuesdays",    status: "in-progress", priority: "high" },
        ],
      },
      research2: {
        status: "active", statusColor: "#64748B",
        summary: "Structured investigation. Time-boxed research sessions produce concise summaries that go directly into Notion.",
        processes: ["Define question before opening browser", "Time-box to 45 min", "Write 3-bullet summary immediately"],
        tasks: [
          { id: "rs2-t1", title: "Research competitor pricing models",     status: "in-progress", priority: "high",   dueDate: "2026-03-21" },
          { id: "rs2-t2", title: "Synthesise user interview insights",     status: "todo",        priority: "high" },
          { id: "rs2-t3", title: "Create research question template",      status: "todo",        priority: "medium" },
        ],
      },
      standup2: {
        status: "active", statusColor: "#10B981",
        summary: "Daily 15-min team pulse. Surfaces blockers early, aligns on priorities, and replaces most ad-hoc check-in messages.",
        processes: ["Yesterday / Today / Blockers format", "Strict 15-min timebox", "Action items logged in task manager"],
        tasks: [
          { id: "su2-t1", title: "Move standup to 9:30 AM",         status: "review",  priority: "medium", note: "Needs team consensus." },
          { id: "su2-t2", title: "Prepare update every evening",    status: "in-progress", priority: "high" },
        ],
      },
      collab1: {
        status: "active", statusColor: "#4F46E5",
        summary: "Collaborator A — design partner. Responsible for visual deliverables and design system consistency across outputs.",
        processes: ["Weekly 1:1 on Wednesdays", "Async Figma handoff", "Feedback via Loom"],
        tasks: [
          { id: "c1-t1", title: "Share Q2 design brief with C1",         status: "todo",    priority: "high",   dueDate: "2026-03-20" },
          { id: "c1-t2", title: "Set up shared Figma project workspace",  status: "done",    priority: "medium" },
        ],
      },
      collab2: {
        status: "active", statusColor: "#4F46E5",
        summary: "Collaborator B — engineering partner. Owns implementation, reviews technical feasibility early, and ships the final product.",
        processes: ["PR reviews within 4 h", "Pair-program Thursdays 2–4 PM", "Async questions via GitHub comments"],
        tasks: [
          { id: "c2-t1", title: "Define engineering handoff checklist", status: "in-progress", priority: "high" },
          { id: "c2-t2", title: "Add C2 to weekly planning meeting",    status: "todo",        priority: "medium" },
        ],
      },
      review2: {
        status: "active", statusColor: "#4F46E5",
        summary: "Weekly review meeting. Aligns on what shipped, what's blocked, and what the priorities are for the next sprint.",
        processes: ["Review shipped items", "Identify top 3 next-week priorities", "Retrospective (1 good / 1 improve)"],
        tasks: [
          { id: "rm-t1", title: "Prepare review agenda 1 day ahead", status: "todo",    priority: "high" },
          { id: "rm-t2", title: "Send async pre-read to participants", status: "in-progress", priority: "medium", dueDate: "2026-03-21" },
        ],
      },
      notion2: {
        status: "active", statusColor: "#64748B",
        summary: "Long-form knowledge store. Research summaries, decision logs, and project documentation all live here.",
        processes: ["Write while still fresh", "Link related pages", "Tag with project and date"],
        tasks: [
          { id: "no2-t1", title: "Organise Q1 project archive in Notion", status: "done",        priority: "low" },
          { id: "no2-t2", title: "Create decision log template",          status: "in-progress", priority: "medium" },
          { id: "no2-t3", title: "Weekly Notion cleanup (30 min)",        status: "todo",        priority: "low" },
        ],
      },
      github2: {
        status: "active", statusColor: "#64748B",
        summary: "Code and version control. All engineering work goes through PRs so it's reviewable, reversible, and well-documented.",
        processes: ["Feature branch per task", "PR description template", "Squash merge with conventional commit"],
        tasks: [
          { id: "gh-t1", title: "Add PR description template to repo", status: "done",    priority: "medium" },
          { id: "gh-t2", title: "Enable branch protection on main",    status: "in-progress", priority: "high" },
          { id: "gh-t3", title: "Set up GitHub Actions CI pipeline",   status: "todo",    priority: "high",   dueDate: "2026-03-25" },
        ],
      },
      deliverable: {
        status: "in-progress", statusColor: "#10B981",
        summary: "The primary output of the week. A shipped feature, published doc, or completed project that tangibly moves things forward.",
        processes: ["Definition of Done checklist", "Stakeholder demo", "Handoff to next owner"],
        tasks: [
          { id: "dl-t1", title: "Ship v1 of onboarding redesign", status: "in-progress", priority: "high",   dueDate: "2026-03-28" },
          { id: "dl-t2", title: "Write release notes",             status: "todo",        priority: "medium", dueDate: "2026-03-28" },
        ],
      },
      published: {
        status: "todo", statusColor: "#10B981",
        summary: "Public-facing content. Articles, docs, or announcements distributed through owned and earned channels.",
        processes: ["SEO check", "Distribution list activation", "Internal announcement"],
        tasks: [
          { id: "pb2-t1", title: "Publish Q1 retrospective post",        status: "todo",    priority: "medium", dueDate: "2026-03-31" },
          { id: "pb2-t2", title: "Cross-post to LinkedIn and newsletter", status: "todo",    priority: "low" },
        ],
      },
      weekreview: {
        status: "todo", statusColor: "#8B5CF6",
        summary: "Reflective close-out. What shipped, what didn't, energy levels, lessons, and setup for next week.",
        processes: ["Review task manager completions", "Write 3 wins + 1 lesson", "Plan Monday top 3"],
        tasks: [
          { id: "wr-t1", title: "Complete week review template",      status: "todo",    priority: "high",   dueDate: "2026-03-22" },
          { id: "wr-t2", title: "Track weekly output trend over time", status: "in-progress", priority: "medium" },
          { id: "wr-t3", title: "Set up automated weekly stats email", status: "todo",    priority: "low" },
        ],
      },
      kpi: {
        status: "todo", statusColor: "#10B981",
        summary: "Objective measurement layer. Leading and lagging indicators tracked weekly to separate real progress from activity.",
        processes: ["Update dashboard every Friday", "Flag metrics moving in wrong direction", "Share weekly summary to team"],
        tasks: [
          { id: "kp-t1", title: "Define 5 weekly KPIs for Q2",    status: "todo",    priority: "high",   dueDate: "2026-03-20" },
          { id: "kp-t2", title: "Build KPI dashboard in Notion",   status: "in-progress", priority: "high" },
          { id: "kp-t3", title: "Automate KPI pull from GitHub + analytics", status: "todo", priority: "medium", note: "Use Zapier or n8n." },
        ],
      },
    },
    workflowGroups: [
      {
        id: "grp-fw-inputs",
        name: "External Inputs",
        color: "#F59E0B",
        nodeIds: ["email", "slack", "news", "client", "ideas"],
      },
      {
        id: "grp-fw-planning",
        name: "Capture & Plan",
        color: "#0EA5E9",
        nodeIds: ["capture", "calendar2", "taskmgr", "you"],
      },
      {
        id: "grp-fw-focus",
        name: "Deep Focus",
        color: "#6366F1",
        nodeIds: ["deepw1", "deepw2", "research2"],
      },
      {
        id: "grp-fw-collab",
        name: "Collaboration",
        color: "#EC4899",
        nodeIds: ["standup2", "collab1", "collab2", "review2"],
      },
      {
        id: "grp-fw-outputs",
        name: "Outputs & Review",
        color: "#10B981",
        nodeIds: ["notion2", "github2", "deliverable", "published", "weekreview", "kpi"],
      },
    ],
  },
];

// ── buildTemplateState ────────────────────────────────────────────────────────

export interface TemplateState {
  customNodes:        ReturnType<typeof makeCustomNodes>;
  customEdges:        ReturnType<typeof makeCustomEdges>;
  baselinePositions:  Record<string, { x: number; y: number }>;
  ecosystemPositions: Record<string, { x: number; y: number }>;
  settings?: {
    hiddenCoreNodes?: string[];
    metadataOverrides?: Record<string, {
      name?: string; role?: string;
      status?: string; statusColor?: string; summary?: string;
      processes?: string[]; connections?: string[];
      tasks?: NodeTask[];
    }>;
    workflowGroups?: WorkflowGroup[];
  };
}

function makeCustomNodes(nodes: TplNode[], basePos: Record<string, { x: number; y: number }>) {
  return nodes.map((n) => ({
    id:            n.id,
    labelInitials: n.initials,
    label:         n.label,
    nodeType:      "neural" as const,
    role:          n.role as "person" | "tool" | "external" | "output",
    textColor:     n.textColor ?? ROLE_COLOR[n.role],
    position:      basePos[n.id] ?? { x: 100, y: 100 },
  }));
}

function makeCustomEdges(edges: TplEdge[]) {
  return edges.map((e) => ({
    id:       `${e.source}-${e.target}`,
    source:   e.source,
    target:   e.target,
    sequence: e.sequence ?? 1,
    weight:   e.weight   ?? 1,
    isCustom: true as const,
  }));
}

/** Canvas dimensions used for layout computation. */
const CANVAS_W = 900;
const CANVAS_H = 560;

// ── Precomputed layouts ───────────────────────────────────────────────────────
interface PrecomputedLayout {
  baselinePositions:  ReturnType<typeof hierarchicalLayout>;
  ecosystemPositions: ReturnType<typeof radialWebLayout>;
}

const _precomputed = new Map<string, PrecomputedLayout>();

function getPrecomputed(template: Template): PrecomputedLayout {
  if (_precomputed.has(template.id)) return _precomputed.get(template.id)!;
  const layoutNodes = template.nodes.map((n) => ({ id: n.id }));
  const layoutEdges = template.edges.map((e) => ({ source: e.source, target: e.target }));
  const result: PrecomputedLayout = {
    baselinePositions:  hierarchicalLayout(layoutNodes, layoutEdges, CANVAS_W, CANVAS_H),
    ecosystemPositions: radialWebLayout   (layoutNodes, layoutEdges, CANVAS_W, CANVAS_H),
  };
  _precomputed.set(template.id, result);
  return result;
}

// Warm the cache for all non-trivial templates at module load time.
for (const t of TEMPLATES) {
  if (!t.useBuiltins && t.nodes.length > 0) getPrecomputed(t);
}

export function buildTemplateState(template: Template, lang = "en"): TemplateState {
  if (template.useBuiltins || template.nodes.length === 0) {
    return {
      customNodes:        [],
      customEdges:        [],
      baselinePositions:  {},
      ecosystemPositions: {},
      settings:           { hiddenCoreNodes: [] },
    };
  }

  const { baselinePositions, ecosystemPositions } = getPrecomputed(template);

  // Apply label translations to customNodes
  const customNodes = makeCustomNodes(template.nodes, baselinePositions).map(n => ({
    ...n,
    label: getNodeLabel(lang, template.id, n.id, n.label),
  }));
  const customEdges = makeCustomEdges(template.edges);

  // Name lookup using translated labels so connections & processes also localise
  const nodeNameMap = new Map<string, string>(
    template.nodes.map(n => [n.id, getNodeLabel(lang, template.id, n.id, n.label)])
  );

  // Translate group names once for reuse
  const translatedGroups = (template.workflowGroups ?? []).map(g => ({
    ...g,
    name: getGroupName(lang, template.id, g.id, g.name),
  }));

  // Build metadataOverrides — one entry per node, derived consistently:
  //   name        ← translated node label
  //   role        ← node.role
  //   connections ← all neighbouring translated labels (both in & out edges)
  //   processes   ← translated workflow group names this node belongs to
  //   + any rich meta from nodeMeta (status, statusColor, summary, tasks)
  const metadataOverrides: NonNullable<TemplateState["settings"]>["metadataOverrides"] = {};
  for (const node of template.nodes) {
    const meta = template.nodeMeta?.[node.id] ?? {};
    const translatedLabel = getNodeLabel(lang, template.id, node.id, node.label);

    // Direct connections — all neighbours regardless of direction
    const neighbourNames = new Set<string>();
    for (const e of template.edges) {
      if (e.source === node.id) {
        const name = nodeNameMap.get(e.target);
        if (name) neighbourNames.add(name);
      }
      if (e.target === node.id) {
        const name = nodeNameMap.get(e.source);
        if (name) neighbourNames.add(name);
      }
    }

    // Assigned Workflows — translated group names the node belongs to
    const groupNames = translatedGroups
      .filter(g => g.nodeIds.includes(node.id))
      .map(g => g.name);

    metadataOverrides[node.id] = {
      name:        translatedLabel,
      role:        node.role,
      status:      meta.status,
      statusColor: meta.statusColor,
      summary:     meta.summary,
      processes:   groupNames,
      connections: [...neighbourNames],
      tasks:       meta.tasks,
    };
  }

  return {
    customNodes,
    customEdges,
    baselinePositions,
    ecosystemPositions,
    settings: {
      hiddenCoreNodes:   [...CORE_NODE_IDS],
      metadataOverrides,
      workflowGroups:    translatedGroups,
    },
  };
}
