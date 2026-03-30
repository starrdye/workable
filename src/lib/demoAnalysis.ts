import { OptimizeResponseType } from "./aiSchemas";

/**
 * Pre-built AI JSON that the parse-workflow route uses when provider = 'demo'.
 * Node IDs must stay in sync with JACK_ROUTINE_DEMO_ANALYSIS references below.
 */
export const JACK_ROUTINE_DEMO_AI_JSON = JSON.stringify({
  nodes: [
    {
      id: "jack",
      name: "Jack",
      initials: "JK",
      role: "person",
      summary: "Financial analyst responsible for the daily Bloomberg reconciliation workflow. Owns the morning data extraction and quality-check process.",
      tasks: [
        { id: "t_download_csv", title: "Download end-of-day CSV from Bloomberg Terminal", status: "todo", priority: "high" },
        { id: "t_run_recon",    title: "Run Python reconciliation script against PostgreSQL", status: "todo", priority: "high" },
        { id: "t_slack_sarah",  title: "Slack Exception File to Sarah when price breaks found", status: "todo", priority: "medium" }
      ]
    },
    {
      id: "bloomberg",
      name: "Bloomberg Terminal",
      initials: "BT",
      role: "tool",
      summary: "Financial data platform used to extract raw end-of-day pricing data in CSV format each morning.",
      tasks: [
        { id: "t_extract_eod", title: "Export end-of-day pricing data as CSV", status: "todo", priority: "high" }
      ]
    },
    {
      id: "reconciler",
      name: "Python Reconciliation Script",
      initials: "PY",
      role: "tool",
      summary: "Local script that compares Bloomberg CSV data against PostgreSQL to detect price breaks and generate Match Reports or Exception Files.",
      constraints: "Must be run locally on Jack's machine; cannot be scheduled automatically.",
      tasks: [
        { id: "t_compare",         title: "Compare Bloomberg data vs PostgreSQL for price breaks", status: "todo", priority: "high" },
        { id: "t_generate_report", title: "Generate Match Report or Exception File based on results", status: "todo", priority: "high" }
      ]
    },
    {
      id: "postgresql",
      name: "PostgreSQL Database",
      initials: "DB",
      role: "tool",
      summary: "Internal database storing authoritative pricing records. Source of truth for reconciliation and destination for approved overrides.",
      tasks: [
        { id: "t_update_db", title: "Update records with Sarah-approved overrides", status: "todo", priority: "high" }
      ]
    },
    {
      id: "sarah",
      name: "Sarah (Portfolio Manager)",
      initials: "SM",
      role: "person",
      summary: "Portfolio Manager who reviews Exception Files and approves override requests from Jack. Single point of approval in the exception workflow.",
      constraints: "Sole approver — Jack is fully blocked until Sarah responds. Her availability directly impacts the EOD pipeline.",
      tasks: [
        { id: "t_review_exception", title: "Review Exception File from Jack and approve overrides", status: "todo", priority: "high" },
        { id: "t_slack_jack",       title: "Slack approval or rejection back to Jack", status: "todo", priority: "high" }
      ]
    },
    {
      id: "dashboard",
      name: "Ternary Client Dashboard",
      initials: "TD",
      role: "output",
      summary: "External client-facing dashboard that receives final corrected pricing data. Destination for both the clean Match Report and approved corrected numbers.",
      tasks: [
        { id: "t_upload_report", title: "Upload Match Report when reconciliation is clean", status: "todo", priority: "medium" },
        { id: "t_push_numbers",  title: "Push corrected numbers after override approval", status: "todo", priority: "high" }
      ]
    },
    {
      id: "mary",
      name: "Mary (HR)",
      initials: "MH",
      role: "person",
      summary: "HR representative who conducts weekly wellbeing check-ins with Jack and liaises with Sarah on Jack's performance reviews.",
      tasks: [
        { id: "t_weekly_checkin", title: "Conduct weekly mental wellbeing meeting with Jack", status: "todo", priority: "medium" },
        { id: "t_perf_review",    title: "Coordinate quarterly performance review with Sarah", status: "todo", priority: "low" }
      ]
    },
    {
      id: "jason",
      name: "Jason (Mary's Supervisor)",
      initials: "JS",
      role: "person",
      summary: "Supervises Mary and participates in the monthly joint wellbeing meeting with Jack and Mary.",
      tasks: [
        { id: "t_monthly_joint", title: "Attend monthly joint wellbeing meeting with Mary and Jack", status: "todo", priority: "low" }
      ]
    }
  ],
  edges: [
    { id: "e_jack_bloomberg",       source: "jack",       target: "bloomberg",  name: "Log in & download CSV" },
    { id: "e_bloomberg_reconciler", source: "bloomberg",  target: "reconciler", name: "Raw CSV data feed" },
    { id: "e_reconciler_postgresql",source: "reconciler", target: "postgresql", name: "Price comparison query" },
    { id: "e_reconciler_dashboard", source: "reconciler", target: "dashboard",  name: "Upload Match Report" },
    { id: "e_reconciler_sarah",     source: "reconciler", target: "sarah",      name: "Exception File via Slack" },
    { id: "e_sarah_postgresql",     source: "sarah",      target: "postgresql", name: "Approve overrides" },
    { id: "e_postgresql_dashboard", source: "postgresql", target: "dashboard",  name: "Push corrected numbers" },
    { id: "e_mary_jack",            source: "mary",       target: "jack",       name: "Weekly wellbeing check-in" },
    { id: "e_jason_mary",           source: "jason",      target: "mary",       name: "Monthly supervisory meeting" },
    { id: "e_mary_sarah",           source: "mary",       target: "sarah",      name: "Jack performance discussion" }
  ],
  groups: [
    { id: "grp_data_extraction", name: "Data Extraction",         color: "#6366F1", nodeIds: ["jack", "bloomberg"],            parentGroupId: null },
    { id: "grp_reconciliation",  name: "Reconciliation Engine",   color: "#0EA5E9", nodeIds: ["reconciler", "postgresql"],     parentGroupId: null },
    { id: "grp_exception_flow",  name: "Exception Approval Flow", color: "#F59E0B", nodeIds: ["sarah", "reconciler"],          parentGroupId: null },
    { id: "grp_hr",              name: "HR & Wellbeing",          color: "#10B981", nodeIds: ["mary", "jason", "jack"],        parentGroupId: null }
  ]
});

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
