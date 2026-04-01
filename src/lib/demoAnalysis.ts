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
 * 对应 JACK_ROUTINE_DEMO_AI_JSON 的中文版本。
 */
export const JACK_ROUTINE_DEMO_AI_JSON_ZH = JSON.stringify({
  nodes: [
    {
      id: "jack",
      name: "Jack",
      initials: "JK",
      role: "person",
      summary: "财务分析师，负责每日彭博对账流程。负责早晨的数据提取和质量检查工作。",
      tasks: [
        { id: "t_download_csv", title: "从彭博终端下载每日收盘 CSV", status: "todo", priority: "high" },
        { id: "t_run_recon",    title: "针对 PostgreSQL 运行 Python 对账脚本", status: "todo", priority: "high" },
        { id: "t_slack_sarah",  title: "发现价格差异时将异常文件发给 Sarah", status: "todo", priority: "medium" }
      ]
    },
    {
      id: "bloomberg",
      name: "彭博终端",
      initials: "BT",
      role: "tool",
      summary: "金融数据平台，每天早晨用于提取 CSV 格式的原始收盘价格数据。",
      tasks: [
        { id: "t_extract_eod", title: "将收盘价格数据导出为 CSV", status: "todo", priority: "high" }
      ]
    },
    {
      id: "reconciler",
      name: "Python 对账脚本",
      initials: "PY",
      role: "tool",
      summary: "本地脚本，用于对比彭博 CSV 数据与 PostgreSQL 数据库，识别价格差异并生成匹配报告或异常文件。",
      constraints: "必须在 Jack 的本地机器上运行；无法自动调度。",
      tasks: [
        { id: "t_compare",         title: "对比彭博数据与 PostgreSQL 以发现价格差异", status: "todo", priority: "high" },
        { id: "t_generate_report", title: "根据结果生成匹配报告或异常文件", status: "todo", priority: "high" }
      ]
    },
    {
      id: "postgresql",
      name: "PostgreSQL 数据库",
      initials: "DB",
      role: "tool",
      summary: "内部数据库，存储权威价格记录。是对账的唯一事实来源，也是经批准的覆盖数据的存储地。",
      tasks: [
        { id: "t_update_db", title: "使用 Sarah 批准的覆盖数据更新记录", status: "todo", priority: "high" }
      ]
    },
    {
      id: "sarah",
      name: "Sarah (投资组合经理)",
      initials: "SM",
      role: "person",
      summary: "投资组合经理，负责审阅异常文件并批准 Jack 的覆盖请求。是异常工作流中的唯一审批点。",
      constraints: "唯一审批人 — 在 Sarah 响应前，Jack 的工作完全被阻塞。她的响应速度直接影响盘后处理进度。",
      tasks: [
        { id: "t_review_exception", title: "审阅来自 Jack 的异常文件并批准覆盖", status: "todo", priority: "high" },
        { id: "t_slack_jack",       title: "感通过 Slack 将批准或拒绝结果反馈给 Jack", status: "todo", priority: "high" }
      ]
    },
    {
      id: "dashboard",
      name: "三元客户看板",
      initials: "TD",
      role: "output",
      summary: "面向外部客户的看板，接收最终修正后的价格数据。是清洁匹配报告和批准后的修正数据的去向。",
      tasks: [
        { id: "t_upload_report", title: "对账清洁时上传匹配报告", status: "todo", priority: "medium" },
        { id: "t_push_numbers",  title: "覆盖批准后推送修正后的数据", status: "todo", priority: "high" }
      ]
    },
    {
      id: "mary",
      name: "Mary (人力资源)",
      initials: "MH",
      role: "person",
      summary: "HR 代表，每周与 Jack 进行身心健康检查，并与 Sarah 沟通 Jack 的绩效考评。",
      tasks: [
        { id: "t_weekly_checkin", title: "每周与 Jack 进行身心健康会议", status: "todo", priority: "medium" },
        { id: "t_perf_review",    title: "与 Sarah 协调季度绩效考核", status: "todo", priority: "low" }
      ]
    },
    {
      id: "jason",
      name: "Jason (Mary 的主管)",
      initials: "JS",
      role: "person",
      summary: "监督 Mary 的工作，并参加每月与 Jack 和 Mary 的联合会议。",
      tasks: [
        { id: "t_monthly_joint", title: "参加每月与 Mary 和 Jack 的联合会议", status: "todo", priority: "low" }
      ]
    }
  ],
  edges: [
    { id: "e_jack_bloomberg",       source: "jack",       target: "bloomberg",  name: "登录并下载 CSV" },
    { id: "e_bloomberg_reconciler", source: "bloomberg",  target: "reconciler", name: "原始 CSV 数据流" },
    { id: "e_reconciler_postgresql",source: "reconciler", target: "postgresql", name: "价格对比查询" },
    { id: "e_reconciler_dashboard", source: "reconciler", target: "dashboard",  name: "上传匹配报告" },
    { id: "e_reconciler_sarah",     source: "reconciler", target: "sarah",      name: "通过 Slack 发送异常文件" },
    { id: "e_sarah_postgresql",     source: "sarah",      target: "postgresql", name: "批准覆盖数据" },
    { id: "e_postgresql_dashboard", source: "postgresql", target: "dashboard",  name: "推送修正后的数据" },
    { id: "e_mary_jack",            source: "mary",       target: "jack",       name: "每周身心健康检查" },
    { id: "e_jason_mary",           source: "jason",      target: "mary",       name: "每月监督会议" },
    { id: "e_mary_sarah",           source: "mary",       target: "sarah",      name: "Jack 绩效讨论" }
  ],
  groups: [
    { id: "grp_data_extraction", name: "数据提取",         color: "#6366F1", nodeIds: ["jack", "bloomberg"],            parentGroupId: null },
    { id: "grp_reconciliation",  name: "对账引擎",         color: "#0EA5E9", nodeIds: ["reconciler", "postgresql"],     parentGroupId: null },
    { id: "grp_exception_flow",  name: "异常审批流",       color: "#F59E0B", nodeIds: ["sarah", "reconciler"],          parentGroupId: null },
    { id: "grp_hr",              name: "HR 与身心健康",     color: "#10B981", nodeIds: ["mary", "jason", "jack"],        parentGroupId: null }
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

/**
 * 对应 JACK_ROUTINE_DEMO_ANALYSIS 的中文版本。
 */
export const JACK_ROUTINE_DEMO_ANALYSIS_ZH: OptimizeResponseType = {
  analysis: `## 工作流摘要
该工作流展示了一个日常财务对账流程。Jack（核心操作员）从**彭博终端**提取价格数据，并通过 **Python 对账脚本**进行处理。流程根据数据是否与内部记录匹配而产生分支。

## 识别到的瓶颈
- **手动异常审阅（严重程度：高）**：最显著的瓶颈是每当发现差异时，**Sarah（投资组合经理）**需要进行的手动审阅。在 Sarah 通过 Slack 反馈批准之前，Jack 的工作完全被阻塞，导致不可预测的延迟。
- **单点故障**：Sarah 是唯一能够批准覆盖数据的人员，如果她不在岗或工作过载，将产生巨大风险。

## 约束分析
- **时间约束**：彭博数据仅在收盘后可用，迫使整个对账工作挤在早晨的时段内。
- **沟通约束**：使用 Slack 进行异常审批是无结构的，难以进行审计或追踪性能指标。

## 建议
- **自动化低风险异常**：实施基于规则的 AI 审阅工具来处理 80% 的常见价格波动，仅将 20% 的高风险异常上报给 Sarah。
- **直接集成**：将 Slack 替换为基于任务的看板链接，允许 Sarah 直接点击“批准”，从而自动更新 PostgreSQL 数据库。`,

  suggestedRemovals: [
    {
      type: "node",
      id: "sarah",
      name: "Sarah (投资组合经理)",
      action: "automate",
      reason: "Sarah 目前作为所有异常审阅的手动守门人，这可以通过高可信度的 AI 逻辑实现自动化。",
      fishboneBones: [
        {
          category: "Process",
          cause: "缺乏预定义的覆盖规则，迫使每次偏差都需要人工干预。",
          resolvedBy: { type: "newNode", refId: "ai_review_tool" }
        },
        {
          category: "People",
          cause: "投资组合经理的高工作负荷导致“审批滞后”，阻塞了整个盘后处理流程。",
          resolvedBy: { type: "newNode", refId: "ai_review_tool" }
        },
        {
          category: "Technology",
          cause: "传统脚本仅标记错误，不提供修复建议或审计历史。",
          resolvedBy: { type: "newNode", refId: "ai_review_tool" }
        }
      ]
    }
  ],

  suggestedNewNodes: [
    {
      tempId: "ai_review_tool",
      label: "AI 异常审阅器",
      role: "tool",
      summary: "根据历史波动性和流动性过滤器审阅彭博价格异常的自动引擎。",
      connectFrom: ["reconciler"],
      connectTo: ["dashboard", "postgresql"],
      replacesNodeId: "sarah"
    }
  ],

  suggestedConnections: [
    {
      sourceId: "reconciler",
      sourceName: "Python 对账脚本",
      targetId: "ai_review_tool",
      targetName: "AI 异常审阅器",
      connectionName: "发送异常",
      reason: "通过将数据直接喂给自动化审阅层，绕过了手动的 Slack 步骤。",
      cascadeEffects: [
        {
          id: "eff_sarah_free",
          type: "stable",
          description: "每天减少 Sarah 约 45 分钟的操作负担。",
          depth: 1
        },
        {
          id: "eff_faster_eod",
          type: "stable",
          description: "将最终客户看板的更新提前约 2 小时。",
          depth: 2
        }
      ]
    }
  ],

  suggestedEdgeRemovals: [
    {
      edgeId: "e_reconciler_sarah",
      sourceName: "Python 对账脚本",
      targetName: "Sarah (投资组合经理)",
      reason: "一旦 AI 审阅工具负责高通量的异常分拣，该连接即变为冗余。",
      prerequisiteConnectionId: "reconciler-ai_review_tool"
    }
  ],

  suggestedTaskUpdates: [
    {
      nodeId: "jack",
      nodeName: "Jack",
      addTasks: [
        { id: "t_monitor_ai", title: "监控 AI 异常审阅器的准确性", status: "todo", priority: "medium" }
      ],
      removeTasks: ["t_slack_sarah"],
      reason: "Jack 不再需要手动发送 Slack 文件；他的角色转向更高层级的监督。"
    }
  ],

  suggestedGroupUpdates: [],
  suggestionPlan: {
    phases: [
      {
        phaseIndex: 1,
        label: "自动化阶段",
        description: "部署 AI 审阅器并重新路由对账管道。",
        prerequisitePhases: [],
        suggestionRefs: [
          { type: "newNode", refId: "ai_review_tool" },
          { type: "connection", refId: "reconciler-ai_review_tool" }
        ]
      },
      {
        phaseIndex: 2,
        label: "退役旧流程",
        description: "一旦 AI 通过验证，移除旧的手动审阅步骤。",
        prerequisitePhases: [1],
        suggestionRefs: [
          { type: "edgeRemoval", refId: "e_reconciler_sarah" },
          { type: "removal", refId: "sarah" }
        ]
      }
    ]
  }
};

/** Pre-built AI Update response for the Sarah-promotion demo scenario */
export const JACK_ROUTINE_DEMO_UPDATE_RESULT = {
  summary: "Sarah has been promoted to Head of Portfolio Management. Two junior analysts — Alex and Jamie — have joined her team to handle first-line Exception File reviews. Jack now sends Exception Files to Alex first; Alex escalates complex cases to Sarah, while Jamie provides backup triage support. The direct Jack-to-Sarah Slack step is replaced by this structured review chain.",
  add: {
    nodes: [
      {
        id: "alex_analyst",
        name: "Alex (Junior Analyst)",
        initials: "AA",
        role: "person",
        summary: "First-line reviewer of Exception Files from Jack's reconciliation script. Handles standard price-break overrides and escalates complex cases to Sarah.",
        tasks: [
          { id: "t_review_exceptions", title: "Review Exception Files from Python reconciliation script", status: "todo", priority: "high" },
          { id: "t_escalate_sarah",    title: "Escalate non-standard price breaks to Sarah for sign-off", status: "todo", priority: "medium" }
        ]
      },
      {
        id: "jamie_analyst",
        name: "Jamie (Junior Analyst)",
        initials: "JA",
        role: "person",
        summary: "Backup analyst who assists Alex with overflow exception triage when volume is high.",
        tasks: [
          { id: "t_overflow_triage", title: "Handle overflow Exception File triage alongside Alex", status: "todo", priority: "medium" }
        ]
      }
    ],
    edges: [
      { id: "e_reconciler_alex",  source: "reconciler",    target: "alex_analyst", name: "Exception File (first review)" },
      { id: "e_alex_sarah",       source: "alex_analyst",  target: "sarah",        name: "Escalate complex cases" },
      { id: "e_alex_jamie",       source: "alex_analyst",  target: "jamie_analyst",name: "Overflow triage request" },
      { id: "e_analysts_postgresql", source: "alex_analyst", target: "postgresql", name: "Approved overrides (standard)" }
    ],
    groups: [
      { id: "grp_analyst_tier", name: "Junior Analyst Review Tier", color: "#8B5CF6", nodeIds: ["alex_analyst", "jamie_analyst"], parentGroupId: null }
    ]
  },
  update: {
    nodes: [
      {
        id: "sarah",
        name: "Sarah (Head of Portfolio Management)",
        summary: "Promoted to Head of Portfolio Management. Now manages two junior analysts and handles only escalated, non-standard exception cases. No longer involved in routine daily overrides."
      }
    ],
    groupExtensions: [],
    groups: [],
    nodeTasks: [],
    edges: []
  },
  remove: {
    nodeIds: [],
    edgeIds: ["e_reconciler_sarah"],
    groupIds: []
  }
};

/**
 * 对应 JACK_ROUTINE_DEMO_UPDATE_RESULT 的中文版本。
 */
export const JACK_ROUTINE_DEMO_UPDATE_RESULT_ZH = {
  summary: "Sarah 已晋升为投资组合管理负责人。两名初级分析师 — Alex 和 Jamie — 加入了她的团队，负责第一线异常文件的审阅。Jack 现在先将异常文件发送给 Alex；Alex 将复杂的案例上报给 Sarah，而 Jamie 则提供辅助分拣支持。原有的 Jack 到 Sarah 的 Slack 直连步骤被这一结构化的审阅链所取代。",
  add: {
    nodes: [
      {
        id: "alex_analyst",
        name: "Alex (初级分析师)",
        initials: "AA",
        role: "person",
        summary: "负责从 Jack 的对账脚本中接收并进行第一线审阅。处理标准的价格波动覆盖，并将非标准案例上报给 Sarah。",
        tasks: [
          { id: "t_review_exceptions", title: "审阅来自 Python 对账脚本的异常文件", status: "todo", priority: "high" },
          { id: "t_escalate_sarah",    title: "将非标准的价格异常上报给 Sarah 签字", status: "todo", priority: "medium" }
        ]
      },
      {
        id: "jamie_analyst",
        name: "Jamie (初级分析师)",
        initials: "JA",
        role: "person",
        summary: "后备分析师，在异常量较大时协助 Alex 进行分拣。",
        tasks: [
          { id: "t_overflow_triage", title: "与 Alex 一同处理溢出的异常文件分拣", status: "todo", priority: "medium" }
        ]
      }
    ],
    edges: [
      { id: "e_reconciler_alex",  source: "reconciler",    target: "alex_analyst", name: "异常文件 (首展审阅)" },
      { id: "e_alex_sarah",       source: "alex_analyst",  target: "sarah",        name: "上报复杂案例" },
      { id: "e_alex_jamie",       source: "alex_analyst",  target: "jamie_analyst",name: "溢出分拣请求" },
      { id: "e_analysts_postgresql", source: "alex_analyst", target: "postgresql", name: "已批准的覆盖 (标准)" }
    ],
    groups: [
      { id: "grp_analyst_tier", name: "初级分析师审阅层", color: "#8B5CF6", nodeIds: ["alex_analyst", "jamie_analyst"], parentGroupId: null }
    ]
  },
  update: {
    nodes: [
      {
        id: "sarah",
        name: "Sarah (投资组合管理负责人)",
        summary: "已晋升为投资组合管理负责人。现在管理两名初级分析师，仅处理上报的非标准异常。不再参与日常的常规覆盖工作。"
      }
    ],
    groupExtensions: [],
    groups: [],
    nodeTasks: [],
    edges: []
  },
  remove: {
    nodeIds: [],
    edgeIds: ["e_reconciler_sarah"],
    groupIds: []
  }
};
