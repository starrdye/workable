/**
 * templates.ts — Pre-built workflow templates for the template gallery.
 *
 * Each template has:
 *   • Metadata   — name, description, density label, node/edge counts
 *   • Node list  — custom node definitions (all roles: person/tool/external/output)
 *   • Edge list  — directed edges with sequence numbers
 *
 * buildTemplateState() runs the layout algorithms and returns the full
 * importState payload expected by PUT /api/graph-state.
 *
 * Density tiers map to which layout features they showcase:
 *   few  → straight lines + simple beziers  (current 4–7 node default)
 *   some → single beziers + mild radial rings  (~12–14 nodes)
 *   many → 4-arc bundles + concentric force rings  (~22 nodes)
 */

import { hierarchicalLayout, radialWebLayout } from "./layout";
import { CORE_NODE_IDS, ROLE_COLOR } from "./constants";

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
}

// ROLE_COLOR is imported from constants — single source of truth.

// ── Template definitions ──────────────────────────────────────────────────────

export const TEMPLATES: Template[] = [

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
  //
  // Personal daily startup: single person at centre, tools and outputs radiate
  // outward.  Showcases few-entity straight/simple layout.
  {
    id: "morning-routine",
    name: "Morning Routine",
    description: "Personal daily startup: wake-up → review → plan → deep work. A simple 7-step flow centered on you.",
    density: "few",
    nodeCount: 7,
    edgeCount: 8,
    nodes: [
      { id: "me",       label: "You",            initials: "ME", role: "person"   },
      { id: "inbox",    label: "Email / Inbox",  initials: "IN", role: "external" },
      { id: "calendar", label: "Calendar",       initials: "CA", role: "tool"     },
      { id: "notes",    label: "Notes / Journal",initials: "NT", role: "tool"     },
      { id: "todoist",  label: "Task List",      initials: "TL", role: "tool"     },
      { id: "standup",  label: "Team Stand-up",  initials: "SU", role: "person"   },
      { id: "deepwork", label: "Deep Work Block",initials: "DW", role: "output"   },
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
  },

  // ── 2. Project Workflow (~14 nodes) ──────────────────────────────────────
  //
  // One person coordinating tools, collaborators, and deliverables.
  // Showcases bezier edges + moderate radial rings.
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
  },

  // ── 3. Full Work Week (~22 nodes) ─────────────────────────────────────────
  //
  // Showcases 4-arc bundles (you hub degree 9), concentric force rings
  // (ring with >4 nodes), deep 4-ring radial structure.  Dense-layer wrapping
  // keeps the 2D process map legible even with 22 nodes.
  {
    id: "full-week",
    name: "Full Work Week",
    description: "Your complete weekly system: inputs, deep work blocks, meetings, reviews, and outputs — all mapped.",
    density: "many",
    nodeCount: 22,
    edgeCount: 27,
    nodes: [
      // ── Inputs (external triggers) ────────────────────────────────────
      { id: "email",    label: "Email",          initials: "EM", role: "external" },
      { id: "slack",    label: "Slack / Chat",   initials: "SL", role: "external" },
      { id: "news",     label: "News / RSS",     initials: "NW", role: "external" },
      { id: "client",   label: "Client Request", initials: "CR", role: "external" },
      { id: "ideas",    label: "Ideas Inbox",    initials: "II", role: "external" },
      // ── Capture & Planning ────────────────────────────────────────────
      { id: "capture",  label: "Daily Capture",  initials: "DC", role: "tool"     },
      { id: "calendar2",label: "Calendar",       initials: "CA", role: "tool"     },
      { id: "taskmgr",  label: "Task Manager",   initials: "TM", role: "tool"     },
      // ── You (hub) ─────────────────────────────────────────────────────
      { id: "you",      label: "You",            initials: "ME", role: "person"   },
      // ── Deep work blocks ─────────────────────────────────────────────
      { id: "deepw1",   label: "Deep Work A.M.", initials: "D1", role: "tool"     },
      { id: "deepw2",   label: "Deep Work P.M.", initials: "D2", role: "tool"     },
      { id: "research2",label: "Research",       initials: "RS", role: "tool"     },
      // ── Collaboration ─────────────────────────────────────────────────
      { id: "standup2", label: "Stand-up",       initials: "SU", role: "person"   },
      { id: "collab1",  label: "Collaborator A", initials: "C1", role: "person"   },
      { id: "collab2",  label: "Collaborator B", initials: "C2", role: "person"   },
      { id: "review2",  label: "Review Meeting", initials: "RM", role: "person"   },
      // ── Tools ────────────────────────────────────────────────────────
      { id: "notion2",  label: "Notion / Docs",  initials: "NO", role: "tool"     },
      { id: "github2",  label: "GitHub / Code",  initials: "GH", role: "tool"     },
      // ── Outputs ──────────────────────────────────────────────────────
      { id: "deliverable",label: "Deliverable",  initials: "DL", role: "output"   },
      { id: "published",  label: "Published",    initials: "PB", role: "output"   },
      { id: "weekreview", label: "Week Review",  initials: "WR", role: "output"   },
      { id: "kpi",        label: "KPIs / Metrics",initials: "KP",role: "output"   },
    ],
    edges: [
      // Inputs → Capture
      { source: "email",   target: "capture",   sequence: 1 },
      { source: "slack",   target: "capture",   sequence: 1 },
      { source: "news",    target: "capture",   sequence: 1 },
      { source: "client",  target: "capture",   sequence: 1 },
      { source: "ideas",   target: "capture",   sequence: 1 },
      // Capture → You (hub, degree 9+ → 4-arc bundle in eco view)
      { source: "capture",  target: "you",      sequence: 2 },
      { source: "calendar2",target: "you",      sequence: 2 },
      { source: "taskmgr",  target: "you",      sequence: 2 },
      // You → Deep work + collab
      { source: "you",      target: "deepw1",   sequence: 3 },
      { source: "you",      target: "deepw2",   sequence: 3 },
      { source: "you",      target: "research2",sequence: 3 },
      { source: "you",      target: "standup2", sequence: 3 },
      { source: "you",      target: "collab1",  sequence: 3 },
      { source: "you",      target: "collab2",  sequence: 3 },
      // Deep work → tools + outputs
      { source: "deepw1",   target: "notion2",  sequence: 4 },
      { source: "deepw1",   target: "github2",  sequence: 4 },
      { source: "deepw2",   target: "deliverable",sequence: 5 },
      { source: "research2",target: "notion2",  sequence: 4 },
      // Collab → review
      { source: "collab1",  target: "review2",  sequence: 4 },
      { source: "collab2",  target: "review2",  sequence: 4 },
      { source: "standup2", target: "taskmgr",  sequence: 4 },
      // Outputs
      { source: "notion2",  target: "published",sequence: 5 },
      { source: "github2",  target: "deliverable",sequence: 5 },
      { source: "review2",  target: "deliverable",sequence: 5 },
      { source: "deliverable",target: "kpi",    sequence: 6 },
      { source: "published",  target: "kpi",    sequence: 6 },
      { source: "kpi",        target: "weekreview",sequence: 7 },
    ],
  },
];

// ── buildTemplateState ────────────────────────────────────────────────────────
//
// Runs both layout algorithms on the template's node/edge list and returns
// the full payload for PUT /api/graph-state { action: "importState" }.

export interface TemplateState {
  customNodes:        ReturnType<typeof makeCustomNodes>;
  customEdges:        ReturnType<typeof makeCustomEdges>;
  baselinePositions:  Record<string, { x: number; y: number }>;
  ecosystemPositions: Record<string, { x: number; y: number }>;
  settings?:          { hiddenCoreNodes?: string[] };
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
  return edges.map((e, i) => ({
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
//
// Template layouts are static — compute them once at module load so that
// template selection is instant instead of blocking the main thread each time.

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

export function buildTemplateState(template: Template): TemplateState {
  if (template.useBuiltins || template.nodes.length === 0) {
    // Ridgeview / Blank: restore core nodes, no custom content
    return {
      customNodes:        [],
      customEdges:        [],
      baselinePositions:  {},
      ecosystemPositions: {},
      settings:           { hiddenCoreNodes: [] },
    };
  }

  const { baselinePositions, ecosystemPositions } = getPrecomputed(template);
  const customNodes = makeCustomNodes(template.nodes, baselinePositions);
  const customEdges = makeCustomEdges(template.edges);

  return {
    customNodes,
    customEdges,
    baselinePositions,
    ecosystemPositions,
    // Hide the built-in Ridgeview core nodes so only template nodes show
    settings: {
      hiddenCoreNodes: [...CORE_NODE_IDS],
    },
  };
}
