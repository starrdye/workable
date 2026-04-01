/**
 * templateTranslations.ts
 *
 * Localised node labels and workflow-group names for each built-in template.
 * Keyed as  TEMPLATE_NODE_LABELS[templateId][nodeId]  and
 *           TEMPLATE_GROUP_NAMES[templateId][groupId].
 *
 * English labels live in templates.ts (source of truth).
 * Only non-English variants need entries here.
 */

// ── Simplified Chinese ────────────────────────────────────────────────────────

export const TEMPLATE_NODE_LABELS: Record<string, Record<string, Record<string, string>>> = {
  zh: {
    // ── Morning Routine ──────────────────────────────────────────────────────
    "morning-routine": {
      me:       "您",
      inbox:    "电子邮件 / 收件箱",
      calendar: "日历",
      notes:    "笔记 / 日记",
      todoist:  "任务清单",
      standup:  "团队站会",
      deepwork: "深度工作块",
    },

    // ── Project Workflow ─────────────────────────────────────────────────────
    "project-workflow": {
      me2:       "您",
      idea:      "构思 / 简报",
      research:  "调研",
      notion:    "Notion",
      outline:   "大纲",
      draft:     "草稿",
      loom:      "Loom / 录制",
      reviewer1: "审阅者 A",
      reviewer2: "审阅者 B",
      figma2:    "Figma / 设计",
      feedback:  "反馈循环",
      publish:   "发布",
      metrics:   "数据分析",
      archive:   "存档 / 文档",
    },

    // ── Full Work Week ───────────────────────────────────────────────────────
    "full-week": {
      email:       "电子邮件",
      slack:       "Slack / 即时通讯",
      news:        "新闻 / RSS",
      client:      "客户需求",
      ideas:       "想法收集箱",
      capture:     "每日记录",
      calendar2:   "日历",
      taskmgr:     "任务管理器",
      you:         "您",
      deepw1:      "上午深度工作",
      deepw2:      "下午深度工作",
      research2:   "调研",
      standup2:    "站会",
      collab1:     "协作者 A",
      collab2:     "协作者 B",
      review2:     "评审会议",
      notion2:     "Notion / 文档",
      github2:     "GitHub / 代码",
      deliverable: "交付成果",
      published:   "已发布",
      weekreview:  "周回顾",
      kpi:         "KPI / 指标",
    },
  },
};

export const TEMPLATE_GROUP_NAMES: Record<string, Record<string, Record<string, string>>> = {
  zh: {
    // ── Morning Routine ──────────────────────────────────────────────────────
    "morning-routine": {
      "grp-mr-inputs":   "晨间输入",
      "grp-mr-planning": "规划层",
      "grp-mr-output":   "执行",
    },

    // ── Project Workflow ─────────────────────────────────────────────────────
    "project-workflow": {
      "grp-pw-discovery":    "探索发现",
      "grp-pw-production":   "生产制作",
      "grp-pw-review":       "审阅循环",
      "grp-pw-distribution": "分发推广",
    },

    // ── Full Work Week ───────────────────────────────────────────────────────
    "full-week": {
      "grp-fw-inputs":   "外部输入",
      "grp-fw-planning": "收集与规划",
      "grp-fw-focus":    "深度专注",
      "grp-fw-collab":   "协作",
      "grp-fw-outputs":  "成果与回顾",
    },
  },
};

/** Returns the translated node label, or falls back to the original English label. */
export function getNodeLabel(lang: string, templateId: string, nodeId: string, fallback: string): string {
  return TEMPLATE_NODE_LABELS[lang]?.[templateId]?.[nodeId] ?? fallback;
}

/** Returns the translated group name, or falls back to the original English name. */
export function getGroupName(lang: string, templateId: string, groupId: string, fallback: string): string {
  return TEMPLATE_GROUP_NAMES[lang]?.[templateId]?.[groupId] ?? fallback;
}
