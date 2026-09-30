/**
 * Workable window for the Hermes desktop app.
 *
 * Shows Workable's live team view (http://localhost:3000/hermes) as a page
 * (sidebar → Workable), painted with Hermes's own theme colours. There is no
 * docked pane: the status-bar chip and the optional floating card below keep
 * the team in view, and the page is one click away when you want detail. When the agent writes ::workable-graph{id="g_…"} on its
 * own line (the MCP tools hand it that line as chatCard), the message shows a
 * live card of that workflow. Workable runs in the SDK's sandboxed frame; the embed
 * token lets it call its own API from there (see src/proxy.ts in the workable
 * repo — WORKABLE_EMBED_TOKEN in .env.local must match EMBED_TOKEN below).
 * Editing Hermes stays in the browser: the frame is read-only for that.
 *
 * Team indicator: a chip in the Hermes status bar ("● 2 working") that is
 * always visible, with a popover listing each agent's status, and an optional
 * floating card that stays on screen. Both poll Workable's /api/hermes/summary
 * (same statuses as the team view) every few seconds, so you can follow the
 * team without keeping the Workable page open.
 *
 * Source: ~/Documents/trae_projects/workable/hermes-plugin/desktop/plugin.js
 */

import {
  Button,
  Codicon,
  host,
  PALETTE_AREA,
  PANES_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ROUTES_AREA,
  SandboxedFrame,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  TRANSCRIPT_DIRECTIVE_AREA,
  useTheme
} from '@hermes/plugin-sdk'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const WORKABLE_URL = 'http://localhost:3000'
const EMBED_TOKEN = '__WORKABLE_EMBED_TOKEN__' // filled in by hermes-plugin/install.sh

/**
 * Hermes's current theme as URL parameters, so the framed page paints with the
 * same surfaces, text and borders (see src/lib/hermes/theme.ts in workable).
 */
function useThemeParams() {
  const { theme, renderedMode } = useTheme()
  const c = (theme && theme.colors) || {}
  const params = new URLSearchParams({ mode: renderedMode === 'dark' ? 'dark' : 'light' })
  const add = (key, value) => { if (typeof value === 'string' && value) params.set(key, value) }
  add('bg', c.background)
  add('surface', c.card)
  add('sunk', c.muted)
  add('fg', c.foreground)
  add('muted', c.mutedForeground)
  add('border', c.border)
  params.set('embed', EMBED_TOKEN)
  return params.toString()
}

const GRAPH_ID = /^g_[a-z0-9]{10}$/

/** Inline card for ::workable-graph{id="g_…"}. Attributes are untrusted model output. */
function WorkflowChatCard({ attrs, streaming }) {
  const themeParams = useThemeParams()
  const id = typeof attrs.id === 'string' ? attrs.id : ''
  if (!GRAPH_ID.test(id)) return null
  if (streaming) {
    return jsx('div', {
      className: 'my-1 rounded-md border border-(--ui-border) px-3 py-2 text-xs text-(--ui-text-tertiary)',
      children: 'Workable workflow…'
    })
  }
  return jsxs('div', {
    className: 'my-1 overflow-hidden rounded-md border border-(--ui-border)',
    style: { maxWidth: '680px' },
    children: [
      jsx(SandboxedFrame, {
        src: WORKABLE_URL + '/embed/graph/' + id + '?' + themeParams,
        title: 'Workable workflow ' + id,
        sandbox: 'allow-scripts',
        className: 'block w-full border-0',
        style: { height: '380px' }
      }),
      jsxs('div', {
        className: 'flex items-center gap-2 border-t border-(--ui-border) px-2 py-1 text-[0.6875rem] text-(--ui-text-tertiary)',
        children: [
          jsx('span', { className: 'font-mono', children: id }),
          jsx('div', { className: 'flex-1' }),
          jsx(Button, {
            variant: 'ghost',
            size: 'xs',
            onClick: () => host.navigate('/workable'),
            children: 'Open Workable'
          })
        ]
      })
    ]
  })
}

/** The agent to show selected when the Workable page opens (set from the chip / card). */
const focusStore = (() => {
  let agent = null
  const listeners = new Set()
  return {
    subscribe: l => { listeners.add(l); return () => listeners.delete(l) },
    get: () => agent,
    set: id => { agent = id; listeners.forEach(l => l()) }
  }
})()

/** Open the Workable page with one agent's details showing. */
function openAgent(id) {
  focusStore.set(id)
  host.navigate('/workable')
}

function WorkableWindow({ os }) {
  const themeParams = useThemeParams()
  const focusAgent = useSyncExternalStore(focusStore.subscribe, focusStore.get)
  // The floating card steps aside while this page is open (it would cover the details).
  useEffect(() => {
    floatingCtl?.suspend()
    return () => floatingCtl?.resume()
  }, [])
  const [reloadKey, setReloadKey] = useState(0)

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1 border-b border-(--ui-border) px-2 py-1',
        children: [
          jsx('span', { className: 'px-1 text-xs font-medium text-(--ui-text-secondary)', children: 'Team' }),
          jsx('div', { className: 'flex-1' }),
          jsx(Button, {
            variant: 'ghost',
            size: 'icon-xs',
            title: 'Reload',
            'aria-label': 'Reload the team view',
            onClick: () => setReloadKey(k => k + 1),
            children: jsx(Codicon, { name: 'refresh' })
          }),
          jsx(Button, {
            variant: 'ghost',
            size: 'icon-xs',
            title: 'Open Workable in the browser (canvas, adding and editing agents)',
            'aria-label': 'Open Workable in the browser',
            onClick: () => os.openExternal(WORKABLE_URL + '/hermes'),
            children: jsx(Codicon, { name: 'link-external' })
          })
        ]
      }),
      jsx('div', {
        className: 'relative min-h-0 flex-1',
        children: jsx(SandboxedFrame, {
          // A theme change produces a new URL, which repaints the frame.
          key: String(reloadKey),
          src: WORKABLE_URL + '/hermes?' + themeParams + (focusAgent ? '&agent=' + encodeURIComponent(focusAgent) : ''),
          title: 'Workable team view',
          sandbox: 'allow-scripts allow-forms',
          className: 'absolute inset-0 h-full w-full border-0'
        })
      })
    ]
  })
}

/* ------------------------------------------------------------------ */
/* Team indicator: status-bar chip + optional floating card            */
/* ------------------------------------------------------------------ */

// Same colours as the team view: bright for dots and bars, deeper for blocks with
// white text (≥ 4.5:1 contrast).
const TONE = {
  waiting: '#579BFC',
  working: '#FDAB3D',
  ok: '#00C875',
  bad: '#E2445C',
  warn: '#A25DDC',
  idle: '#C4C4C4'
}
const SOLID = {
  waiting: '#1F6FD6',
  working: '#B85C00',
  ok: '#00804A',
  bad: '#D12A45',
  warn: '#8B46C8',
  idle: '#E6E9EF'
}
const POLL_MS = 3000
const OFFLINE_POLL_MS = 10000

/** One shared poller for the chip and the card; stops when nothing is listening. */
const summaryStore = (() => {
  let state = { summary: null, offline: false }
  const listeners = new Set()
  let timer = null
  const emit = next => { state = next; listeners.forEach(l => l()) }
  async function tick() {
    try {
      const res = await fetch(WORKABLE_URL + '/api/hermes/summary?embed=' + EMBED_TOKEN, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      emit({ summary: await res.json(), offline: false })
    } catch {
      emit({ summary: state.summary, offline: true })
    }
    if (listeners.size) timer = setTimeout(tick, state.offline ? OFFLINE_POLL_MS : POLL_MS)
  }
  return {
    subscribe(l) {
      listeners.add(l)
      if (listeners.size === 1) tick()
      return () => {
        listeners.delete(l)
        if (!listeners.size && timer) { clearTimeout(timer); timer = null }
      }
    },
    get: () => state
  }
})()

function useTeamSummary() {
  return useSyncExternalStore(summaryStore.subscribe, summaryStore.get)
}

function Dot({ tone, size = 7 }) {
  return jsx('span', {
    'aria-hidden': 'true',
    className: 'inline-block shrink-0 rounded-full',
    style: { width: size, height: size, background: TONE[tone] || TONE.idle }
  })
}

/** Solid status block with one word, as in the team view. */
function StatusBlock({ tone, text }) {
  return jsx('span', {
    className: 'inline-flex h-[18px] shrink-0 items-center justify-center rounded px-1.5 text-[0.625rem] font-semibold',
    style: { minWidth: 58, background: SOLID[tone] || SOLID.idle, color: tone === 'idle' ? '#333' : '#fff' },
    children: text
  })
}

/** Small red outline badge for a problem the status word doesn't show ("2 blocked"). */
function AlertBadge({ text }) {
  return jsx('span', {
    className: 'shrink-0 rounded border px-1 text-[0.5625rem] font-semibold leading-[14px]',
    style: { borderColor: TONE.bad, color: SOLID.bad, background: 'rgba(226,68,92,0.08)' },
    children: text
  })
}

/** "● 2 working  ● 1 failed" — only the counts that matter, or one calm word. */
function chipSegments(summary) {
  const c = summary.counts
  const segs = []
  if (c.working) segs.push({ tone: 'working', text: c.working + ' working' })
  if (c.waiting) segs.push({ tone: 'waiting', text: c.waiting + ' waiting' })
  if (c.failed) segs.push({ tone: 'bad', text: c.failed + ' failed' })
  else if (c.blocked) segs.push({ tone: 'bad', text: c.blocked + ' blocked' })
  return segs.length ? segs : [summary.headline]
}

/** Agent rows, shared by the popover and the floating card. */
function AgentList({ summary, dense }) {
  return jsx('ul', {
    className: 'flex flex-col',
    children: summary.agents.map(a => jsx('li', { children: jsxs('button', {
      type: 'button',
      onClick: () => openAgent(a.id),
      className: 'flex w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-(--chrome-action-hover) ' + (dense ? 'py-1' : 'py-1.5'),
      title: (a.detail ? a.detail + ' — ' : '') + 'Open details',
      children: [
        jsxs('div', {
          className: 'min-w-0 flex-1',
          children: [
            jsx('div', { className: 'truncate text-xs font-medium text-(--ui-text-primary)', children: a.name }),
            !dense && (a.detail || a.sub) && jsx('div', {
              className: 'truncate text-[0.6875rem] text-(--ui-text-tertiary)',
              children: [a.detail, a.sub].filter(Boolean).join(' · ')
            })
          ]
        }),
        a.alert && jsx(AlertBadge, { text: a.alert }),
        jsx(StatusBlock, { tone: a.tone, text: a.label })
      ]
    }) }, a.id))
  })
}

function OfflineNote() {
  return jsx('p', {
    className: 'px-2.5 py-2 text-[0.6875rem] text-(--ui-text-tertiary)',
    children: "Can't reach Workable at " + WORKABLE_URL + '. Start it with npm run dev.'
  })
}

function TeamChip({ controls }) {
  const { summary, offline } = useTeamSummary()
  const floating = useSyncExternalStore(controls.subscribe, controls.isFloating)
  const segs = summary && !offline ? chipSegments(summary) : [{ tone: 'idle', text: offline ? 'offline' : '…' }]

  return jsxs(Popover, {
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsxs('button', {
          type: 'button',
          title: 'Hermes agents — status from Workable',
          className: 'inline-flex h-full items-center gap-2 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
          children: [
            jsx('span', { className: 'font-medium', children: 'Agents' }),
            ...segs.map(seg => jsxs('span', {
              className: 'inline-flex items-center gap-1',
              children: [jsx(Dot, { tone: seg.tone }), seg.text]
            }, seg.text))
          ]
        })
      }),
      jsxs(PopoverContent, {
        align: 'end',
        side: 'top',
        className: 'w-72 p-0',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2 border-b border-(--ui-border) px-2.5 py-1.5 text-[0.6875rem] text-(--ui-text-secondary)',
            children: [
              jsx('span', { className: 'font-medium', children: 'Agents' }),
              summary && jsx('span', { className: 'text-(--ui-text-tertiary)', children: summary.install + (summary.board ? ' › ' + summary.board : '') })
            ]
          }),
          offline || !summary ? jsx(OfflineNote, {}) : jsx(AgentList, { summary }),
          summary && jsx(LiveNextJob, { schedule: summary.schedule }),
          jsx(LiveFreshness, {}),
          jsxs('div', {
            className: 'flex items-center gap-1 border-t border-(--ui-border) px-1.5 py-1',
            children: [
              jsx(Button, {
                variant: 'ghost', size: 'xs',
                onClick: controls.toggleFloating,
                children: floating ? 'Hide floating card' : 'Keep on screen'
              }),
              jsx('div', { className: 'flex-1' }),
              jsx(Button, {
                variant: 'ghost', size: 'xs',
                onClick: () => host.navigate('/workable'),
                children: 'Open team view'
              })
            ]
          })
        ]
      })
    ]
  })
}

/* ---- Time helpers: the card ticks every second without refetching ---- */

const clock = (() => {
  let now = Date.now()
  const listeners = new Set()
  let timer = null
  return {
    subscribe(l) {
      listeners.add(l)
      if (!timer) timer = setInterval(() => { now = Date.now(); listeners.forEach(fn => fn()) }, 1000)
      return () => { listeners.delete(l); if (!listeners.size) { clearInterval(timer); timer = null } }
    },
    get: () => now
  }
})()

/** Current time in unix seconds, re-rendering every second. */
function useNowS() {
  return useSyncExternalStore(clock.subscribe, clock.get) / 1000
}

/** 4 → "now", 42 → "42s", 190 → "3m", 7300 → "2h 1m", 90000 → "1d". */
function ago(sec) {
  const s = Math.max(0, Math.floor(sec))
  if (s < 5) return 'now'
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'
  return Math.floor(s / 86400) + 'd'
}

/** 72 → "1m 12s": how long something has been running. */
function elapsed(sec) {
  const s = Math.max(0, Math.floor(sec))
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'
}

const clockTime = unix => new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/* ---- Card pieces ---- */

/** "Latest round · 3 of 4 replied · 1 failed" with a segmented bar in status colours. */
function RoundBar({ round, now }) {
  const parts = [
    ['ok', round.done], ['working', round.working], ['waiting', round.waiting], ['bad', round.failed]
  ].filter(([, n]) => n > 0)
  const words = [round.done + ' of ' + round.total + ' replied']
  if (round.failed) words.push(round.failed + ' failed')
  if (round.working) words.push(round.working + ' working')
  // Cards only move when a Hermes gateway (which runs the dispatcher) is up.
  const stuck = round.waiting === round.total - round.done - round.failed && round.waiting > 0 && round.working === 0 && now - round.startedAt > 90
  return jsxs('div', {
    className: 'px-2.5 pb-2',
    children: [
      jsxs('div', {
        className: 'mb-1 flex items-baseline gap-1 text-[0.6875rem]',
        children: [
          jsx('span', { className: 'font-medium text-(--ui-text-secondary)', children: 'Latest round' }),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-(--ui-text-tertiary)', children: '· ' + words.join(' · ') }),
          jsx('span', { className: 'shrink-0 text-(--ui-text-quaternary)', children: ago(now - round.startedAt) === 'now' ? 'now' : ago(now - round.startedAt) + ' ago' })
        ]
      }),
      stuck && jsx('div', {
        className: 'mb-1 rounded px-1.5 py-1 text-[0.625rem] leading-snug',
        style: { background: 'rgba(253,171,61,0.15)', color: 'var(--ui-text-secondary)' },
        children: 'Not picked up yet — is the Hermes gateway running? (hermes gateway run)'
      }),
      jsx('div', {
        className: 'flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-(--ui-border)',
        role: 'img',
        'aria-label': words.join(', '),
        children: parts.map(([tone, n]) => jsx('span', { style: { flex: n, background: TONE[tone] } }, tone))
      })
    ]
  })
}

/** One agent: name + what it's doing / how long ago, and its status block. */
function AgentRow({ a, now }) {
  const time = a.at ? (a.tone === 'working' ? elapsed(now - a.at) : ago(now - a.at) + (ago(now - a.at) === 'now' ? '' : ' ago')) : ''
  const line = a.tone === 'working' ? [a.step || a.detail, time].filter(Boolean).join(' · ') : time
  return jsx('li', { children: jsxs('button', {
    type: 'button',
    onClick: () => openAgent(a.id),
    className: 'flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-(--chrome-action-hover)',
    title: (a.detail ? a.detail + ' — ' : '') + 'Open details',
    children: [
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsx('div', { className: 'truncate text-xs font-medium text-(--ui-text-primary)', children: a.name }),
          line && jsx('div', { className: 'truncate text-[0.625rem] text-(--ui-text-tertiary)', children: line })
        ]
      }),
      a.alert && jsx(AlertBadge, { text: a.alert }),
      jsx(StatusBlock, { tone: a.tone, text: a.label })
    ]
  }) })
}

/** "Updated 09:12:05 · 3s ago" — turns amber when the data is stale, red when offline. */
function Freshness({ summary, offline, now }) {
  const age = summary ? now - summary.generatedAt : Infinity
  const tone = offline ? 'bad' : age > 15 ? 'working' : 'ok'
  const text = !summary ? 'Waiting for Workable…'
    : offline ? "Can't reach Workable · last update " + clockTime(summary.generatedAt)
    : age > 15 ? 'Stale · last update ' + clockTime(summary.generatedAt)
    : 'Updated ' + (ago(age) === 'now' ? 'just now' : ago(age) + ' ago')
  return jsxs('div', {
    className: 'flex items-center gap-1.5 border-t border-(--ui-border) px-2.5 py-1.5 text-[0.625rem] text-(--ui-text-tertiary)',
    title: summary ? 'As of ' + clockTime(summary.generatedAt) + ' · ' + summary.install + (summary.board ? ' › ' + summary.board : '') : '',
    children: [jsx(Dot, { tone, size: 6 }), jsx('span', { className: 'truncate', children: text })]
  })
}

/** "⏱ Next: clerk · Time check in 28m" — the next scheduled job, counting down. */
function NextJob({ schedule, now }) {
  if (!schedule || (!schedule.next && !schedule.running && !schedule.failing)) return null
  const wait = schedule.next ? schedule.next.at - now : null
  const inText = wait == null ? '' : wait <= 30 ? 'due now' : 'in ' + (wait < 3600 ? elapsed(wait).replace(/ \d+s$/, '') : ago(wait))
  const parts = []
  if (schedule.running) parts.push({ tone: 'working', text: schedule.running + ' job running' })
  if (schedule.failing) parts.push({ tone: 'bad', text: schedule.failing + ' job failing' })
  return jsxs('div', {
    className: 'flex items-center gap-1.5 border-t border-(--ui-border) px-2.5 py-1.5 text-[0.6875rem] text-(--ui-text-secondary)',
    title: schedule.total + ' scheduled job' + (schedule.total === 1 ? '' : 's'),
    children: [
      jsx('span', { 'aria-hidden': 'true', className: 'text-(--ui-text-tertiary)', children: '⏱' }),
      jsx('span', {
        className: 'min-w-0 flex-1 truncate',
        children: schedule.next ? 'Next: ' + schedule.next.agent + ' · ' + schedule.next.name : 'No upcoming runs'
      }),
      ...parts.map(p => jsxs('span', { className: 'inline-flex shrink-0 items-center gap-1', children: [jsx(Dot, { tone: p.tone, size: 6 }), p.text] }, p.text)),
      inText && jsx('span', { className: 'shrink-0 tabular-nums text-(--ui-text-quaternary)', children: inText })
    ]
  })
}

/** Next-job line that ticks on its own (used inside the chip's popover). */
function LiveNextJob({ schedule }) {
  return jsx(NextJob, { schedule, now: useNowS() })
}

/** Freshness line that ticks on its own (used inside the chip's popover). */
function LiveFreshness() {
  const { summary, offline } = useTeamSummary()
  return jsx(Freshness, { summary, offline, now: useNowS() })
}

/** The floating card: headline, latest round, one row per agent, the last event, freshness. */
function TeamCard() {
  const { summary, offline } = useTeamSummary()
  const now = useNowS()
  if (!summary) return jsx(OfflineNote, {})
  return jsxs('div', {
    className: 'flex h-full flex-col',
    children: [
      jsx('div', {
        className: 'flex flex-wrap items-center gap-x-2 px-2.5 pb-1.5 text-[0.6875rem] font-medium text-(--ui-text-secondary)',
        children: chipSegments(summary).map(seg => jsxs('span', {
          className: 'inline-flex items-center gap-1',
          children: [jsx(Dot, { tone: seg.tone }), seg.text]
        }, seg.text))
      }),
      summary.round && jsx(RoundBar, { round: summary.round, now }),
      jsx('ul', {
        className: 'min-h-0 flex-1 overflow-auto border-t border-(--ui-border) py-0.5',
        children: summary.agents.map(a => jsx(AgentRow, { a, now }, a.id))
      }),
      jsx(NextJob, { schedule: summary.schedule, now }),
      summary.latest && jsxs('div', {
        className: 'flex items-start gap-1.5 border-t border-(--ui-border) px-2.5 py-1.5 text-[0.6875rem] text-(--ui-text-secondary)',
        title: summary.latest.text,
        children: [
          jsx(Dot, { tone: summary.latest.tone, size: 6 }),
          jsx('span', { className: 'line-clamp-2 min-w-0 flex-1 leading-snug', children: summary.latest.text }),
          jsx('span', { className: 'shrink-0 text-[0.625rem] text-(--ui-text-quaternary)', children: ago(now - summary.latest.at) })
        ]
      }),
      jsx(Freshness, { summary, offline, now })
    ]
  })
}

const FLOAT_KEY = 'workable.teamCard'
let floatingCtl = null

/** Show/hide the floating card; remembered in this app's localStorage. */
function floatingControls(ctx) {
  let dispose = null
  const listeners = new Set()
  const read = () => { try { return localStorage.getItem(FLOAT_KEY) === '1' } catch { return false } }
  const write = on => { try { localStorage.setItem(FLOAT_KEY, on ? '1' : '0') } catch { /* private mode */ } }
  const show = () => {
    if (dispose) return
    dispose = ctx.register({
      id: 'team-card',
      area: PANES_AREA,
      title: 'Agents',
      // 'floating' = a fixed, draggable card above the layout; collapse from its header.
      data: { placement: 'floating', anchor: 'bottom-right', width: '280px', height: '380px' },
      render: () => jsx(TeamCard, {})
    })
  }
  const hide = () => { if (dispose) { dispose(); dispose = null } }
  let suspended = 0
  const controls = {
    // While the Workable page is open the card would cover its details, so step aside.
    suspend: () => { suspended++; hide(); listeners.forEach(l => l()) },
    resume: () => { suspended = Math.max(0, suspended - 1); if (!suspended && read()) show(); listeners.forEach(l => l()) },
    isFloating: () => !!dispose || (suspended > 0 && read()),
    subscribe: l => { listeners.add(l); return () => listeners.delete(l) },
    toggleFloating: () => {
      const on = !(dispose || (suspended > 0 && read()))
      write(on)
      if (on && !suspended) show(); else hide()
      listeners.forEach(l => l())
    }
  }
  if (read()) show()
  ctx.onDispose(hide)
  floatingCtl = controls
  return controls
}

export default {
  id: 'workable',
  name: 'Workable',
  register(ctx) {
    const controls = floatingControls(ctx)
    ctx.registerMany([
      {
        id: 'team-chip',
        area: STATUSBAR_AREAS.right,
        render: () => jsx(TeamChip, { controls })
      },
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/workable' },
        render: () => jsx(WorkableWindow, { os: ctx.os })
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/workable', label: 'Workable', codicon: 'type-hierarchy' }
      },
      {
        id: 'graph-card',
        area: TRANSCRIPT_DIRECTIVE_AREA,
        data: { name: 'workable-graph', render: props => jsx(WorkflowChatCard, props) }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'workable.open',
          label: 'Workable: Open',
          keywords: ['workable', 'workflow', 'canvas', 'team'],
          run: () => host.navigate('/workable')
        }
      },
      {
        id: 'toggle-card',
        area: PALETTE_AREA,
        data: {
          id: 'workable.toggleTeamCard',
          label: 'Workable: Show/hide floating team card',
          keywords: ['workable', 'team', 'status', 'floating'],
          run: () => controls.toggleFloating()
        }
      },
      {
        id: 'open-browser',
        area: PALETTE_AREA,
        data: {
          id: 'workable.openBrowser',
          label: 'Workable: Open in browser',
          keywords: ['workable', 'browser'],
          run: () => ctx.os.openExternal(WORKABLE_URL + '/hermes')
        }
      }
    ])
  }
}
