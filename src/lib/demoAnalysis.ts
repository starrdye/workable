import { OptimizeResponseType } from "./aiSchemas";

/**
 * Pre-baked AI analysis for "Jack's Routine" Template.
 * This showcases the core AI capabilities (Fishbone diagram, cascading effects,
 * and automated suggestions) without needing a live AI key.
 */
export const JACK_ROUTINE_DEMO_ANALYSIS: OptimizeResponseType = {
  analysis: `## Workflow Summary
The workflow represents a daily financial reconciliation routine. Jack (the central operator) extracts pricing data from a **Bloomberg Terminal** and processes it through a **Python Reconciliation Script**. The process branches based on whether the data matches internal records.

## Bottlenecks Identified
- **Manual Exception Review (High Severity)**: The most significant bottleneck is the manual review required by **Sarah (Portfolio Manager)** whenever discrepancies are found. Jack is completely blocked until Sarah slacks back her approval, leading to unpredictable delays.
- **Single-Point-of-Failure**: Sarah is the only person who can approve overrides, creating a risk if she is unavailable or overloaded.

## Constraint Analysis
- **Temporal Constraint**: The Bloomberg data is only available EOD, forcing the entire reconciliation into the morning window.
- **Communication Constraint**: Using Slack for exception approval is unstructured and difficult to audit or track for performance metrics.

## Recommendations
- **Automate Low-Risk Exceptions**: Implement a rule-based AI Review Tool to handle 80% of common price breaks, only escalating 20% of high-risk outliers to Sarah.
- **Direct Integration**: Replace Slack with a task-based dashboard link that allows Sarah to click "Approve" directly, updating the PostgreSQL database automatically.`,

  suggestedRemovals: [
    {
      type: "node",
      id: "sarah",
      name: "Sarah (Portfolio Manager)",
      action: "automate",
      reason: "Sarah currently acts as a manual gatekeeper for all exception reviews, which can be automated with high-confidence AI logic.",
      fishboneBones: [
        {
          category: "Process",
          cause: "Lack of predefined override rules forces manual intervention for every deviation.",
          resolvedBy: { type: "newNode", refId: "ai_review_tool" }
        },
        {
          category: "People",
          cause: "PM's high workload leads to 'approval lag', blocking the entire EOD pipeline.",
          resolvedBy: { type: "newNode", refId: "ai_review_tool" }
        },
        {
          category: "Technology",
          cause: "Legacy script only marks errors; it doesn't propose fixes or audit history.",
          resolvedBy: { type: "newNode", refId: "ai_review_tool" }
        }
      ]
    }
  ],

  suggestedNewNodes: [
    {
      tempId: "ai_review_tool",
      label: "AI Exception Reviewer",
      role: "tool",
      summary: "Automated engine that reviews Bloomberg price breaks against historical volatility and liquidity filters.",
      connectFrom: ["reconciler"],
      connectTo: ["dashboard", "postgresql"],
      replacesNodeId: "sarah"
    }
  ],

  suggestedConnections: [
    {
      sourceId: "reconciler",
      sourceName: "Python Reconciliation Script",
      targetId: "ai_review_tool",
      targetName: "AI Exception Reviewer",
      connectionName: "Send Exceptions",
      reason: "Bypasses the manual Slack step by feeding data directly into the automated review layer.",
      cascadeEffects: [
        {
          id: "eff_sarah_free",
          type: "stable",
          description: "Reduces Sarah's daily operational overhead by 45 minutes.",
          depth: 1
        },
        {
          id: "eff_faster_eod",
          type: "stable",
          description: "Accelerates final Client Dashboard updates by approximately 2 hours.",
          depth: 2
        }
      ]
    }
  ],

  suggestedEdgeRemovals: [
    {
      edgeId: "e_reconciler_sarah",
      sourceName: "Python Reconciliation Script",
      targetName: "Sarah (Portfolio Manager)",
      reason: "Redundant once the AI Review Tool is handling the high-volume exception triage.",
      prerequisiteConnectionId: "reconciler-ai_review_tool"
    }
  ],

  suggestedTaskUpdates: [
    {
      nodeId: "jack",
      nodeName: "Jack",
      addTasks: [
        { id: "t_monitor_ai", title: "Monitor AI Exception Reviewer accuracy", status: "todo", priority: "medium" }
      ],
      removeTasks: ["t_slack_sarah"],
      reason: "Jack no longer needs to manually Slack files; his role shifts to higher-level oversight."
    }
  ],

  suggestedGroupUpdates: [],
  suggestionPlan: {
    phases: [
      {
        phaseIndex: 1,
        label: "Automation Phase",
        description: "Deploy the AI Reviewer and re-route reconciliation pipes.",
        prerequisitePhases: [],
        suggestionRefs: [
          { type: "newNode", refId: "ai_review_tool" },
          { type: "connection", refId: "reconciler-ai_review_tool" }
        ]
      },
      {
        phaseIndex: 2,
        label: "Decommissioning",
        description: "Remove the legacy manual review step once the AI is validated.",
        prerequisitePhases: [1],
        suggestionRefs: [
          { type: "edgeRemoval", refId: "e_reconciler_sarah" },
          { type: "removal", refId: "sarah" }
        ]
      }
    ]
  }
};
