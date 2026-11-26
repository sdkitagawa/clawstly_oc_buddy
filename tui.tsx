import { Show, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { CliRenderEvents, type BoxRenderable, type Renderable } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"

const ACCENT = "#D77757"

const VERSION = "0.1.0"

/** Tiers the user can pick; the choice is persisted in plugin storage. */
const TIERS = ["Free", "Pro", "Max", "Ultra"] as const
type Tier = (typeof TIERS)[number]
const DEFAULT_TIER: Tier = "Ultra"

/**
 * Where the session copy of Clawstly sits inside the sidebar. `top` is the
 * default: directly under the session name, at the top of the panel body.
 */
const PLACEMENTS = ["top", "bottom", "hidden"] as const
type Placement = (typeof PLACEMENTS)[number]
const DEFAULT_PLACEMENT: Placement = "top"

function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value)
}

function isPlacement(value: unknown): value is Placement {
  return typeof value === "string" && (PLACEMENTS as readonly string[]).includes(value)
}

/** Rows actually drawn by the idle art; the rest of a frame is empty padding. */
const IDLE_ROWS = 4

/** Every frame is rendered on this many rows so the layout never shifts. */
const FRAME_ROWS = 6

const padFrame = (rows: string[]) => [...rows, ...Array<string>(FRAME_ROWS - rows.length).fill("")]

/** Your art, verbatim. Do not re-indent: the leading and trailing spaces are part of it. */
const ART_IDLE = padFrame([
  "    ▝▚   ▞▘",
  "    ▐▛███▛█",
  "   ▝▜██████▀",
  "    ▝▝   ▝▝",
])

/** Working frames: the side accent alternates while the model is thinking or using tools. */
const ART_BUSY = [
  padFrame([
    "▝   ▝▚   ▞▘",
    " ▝  ▐▛███▛█ ",
    "▀  ▝▜██████▀",
    "    ▝▝   ▝▝",
    "     ▐████▌",
    "     ▀▀▀▀▀▀",
  ]),
  padFrame([
    "    ▝▚   ▞▘ ▝ ",
    "    ▐▛███▛█    ▀",
    "   ▝▜██████▀ ▝",
    "    ▝▝   ▝▝",
    "     ▐████▌",
    "     ▀▀▀▀▀▀",
  ]),
]

/** Held briefly on a failed or interrupted execution. */
const ART_ERROR = padFrame([
  "    ▝▚   ▞▘   ▐█",
  "    ▐▛███▛█   ▝▀",
  "   ▝▜██████▀  ▝▀",
  "    ▝▝   ▝▝   ",
])

/** Widest art line (16) plus a 1-column gutter to the text. */
const ART_WIDTH = 17

/** Busy frame interval, inactivity decay, and error-pose hold, in milliseconds. */
const ANIM_MS = 500
const BUSY_MS = 2500
const ERROR_MS = 1000

/** OpenCode wordmark: 19 cols + 1 gap + 19 cols, per packages/tui/src/logo.ts */
const LOGO_WIDTH = 39

/** Session sidebar: 42 cells with 2 cells of padding on each side. */
const SIDEBAR_WIDTH = 42
const SIDEBAR_PAD = 2

/**
 * Cells to slide the centred sidebar block left (negative) or right (positive). The slot's
 * container is wider than the padded content area, so centring against "100%" biases it right.
 */
const SIDEBAR_CENTER_SHIFT = -1

/** Text column inside the sidebar: leave a cell spare so it never wraps. */
const SESSION_TEXT_WIDTH = SIDEBAR_WIDTH - SIDEBAR_PAD * 2 - ART_WIDTH - 1

/** Below this many cells the text column is dropped and only the art is drawn. */
const TEXT_MIN = 10

/**
 * Never let the text column grow wider than this. It is only a sanity cap: an
 * uncapped column used to fill all free space and pulled the block off-centre.
 */
const TEXT_MAX = 30

/**
 * Terminal cells, not pixels.
 * `lift` is the gap in rows between Clawstly and the wordmark; `topAdjust`
 * nudges the whole thing a row up or down if the host chrome changes.
 */
const TUNING = {
  home: { lift: 1, topAdjust: 0 },
}

type LogoGeometry = { x: number; y: number; width: number }

type TextChunkLike = { text?: string }

/**
 * Text content is stored two ways in OpenTUI 0.8.4: styled chunks on a
 * TextRenderable, and plain strings in a TextNodeRenderable's `children`.
 * `getChildren()` filters those strings out, so read both directly.
 */
function textOf(node: Renderable): string {
  const value = node as unknown as {
    content?: { chunks?: TextChunkLike[] }
    chunks?: TextChunkLike[]
    children?: Array<string | Renderable>
  }
  const chunks = value.content?.chunks ?? value.chunks
  if (chunks) return chunks.map((chunk) => chunk.text ?? "").join("")
  if (Array.isArray(value.children)) {
    return value.children
      .map((child) => (typeof child === "string" ? child : textOf(child)))
      .join("")
  }
  return ""
}

function subtreeText(node: Renderable): string {
  const value = node as unknown as { getTextChildren?: () => Renderable[] }
  const children = typeof value.getTextChildren === "function" ? value.getTextChildren() : node.getChildren()
  return textOf(node) + children.map(subtreeText).join("")
}

/**
 * Distinctive runs from the OpenCode wordmark; none occur in Clawstly's art.
 * `_` in the raw logo source is rendered as a space, hence `█  █`.
 */
const WORDMARK_MARKERS = ["█▀▀█", "▀▀▀▀", "█  █"] as const

/**
 * Find the smallest renderable whose text contains the wordmark's glyph runs.
 * Text matching is more tolerant than matching the exact row/column structure,
 * which can change between OpenCode builds.
 */
function findWordmark(root: Renderable, skipId: string) {
  const pending = root.getChildren()
  let best: Renderable | undefined
  let candidates = 0

  for (let i = 0; i < pending.length; i++) {
    const node = pending[i]
    if (node.id === skipId) continue

    if (node.width >= 20 && node.width <= 120 && node.height >= 3 && node.height <= 8) {
      const text = subtreeText(node)
      if (WORDMARK_MARKERS.every((marker) => text.includes(marker))) {
        candidates++
        const area = node.width * node.height
        if (!best || area < best.width * best.height) best = node
      }
    }
    pending.push(...node.getChildren())
  }

  return { node: best, candidates }
}

type Route = { type: string; sessionID?: string }

export default Plugin.define({
  id: "clawstly",
  setup(ctx) {
    const options = (ctx.options ?? {}) as Record<string, unknown>
    if (options.enabled === false) return

    // `false` keeps the exact idle art at all times, including the error pose.
    const animate = options.animate !== false

    const text = (key: string, fallback: string) => {
      const value = options[key]
      return typeof value === "string" && value.length > 0 ? value : fallback
    }

    const version = text("version", VERSION)
    const customSubtitle = text("subtitle", "")

    // Persisted so a picked tier and placement survive hot reloads and restarts.
    const [settings, updateSettings] = ctx.storage.store("settings", {
      initial: {
        tier: isTier(options.tier) ? options.tier : DEFAULT_TIER,
        placement: isPlacement(options.placement) ? options.placement : DEFAULT_PLACEMENT,
      },
    })
    const tier = (): Tier => (isTier(settings.tier) ? settings.tier : DEFAULT_TIER)
    const placement = (): Placement =>
      isPlacement(settings.placement) ? settings.placement : DEFAULT_PLACEMENT
    const subtitle = () => customSubtitle || `Clawstly · ${tier()}`

    async function pickTier() {
      const next = await ctx.ui.dialog.select<Tier>({
        title: "Clawstly tier",
        placeholder: "Pick a tier",
        current: tier(),
        options: TIERS.map((value) => ({ title: value, value })),
      })
      if (!next) return
      await updateSettings((draft) => {
        draft.tier = next
      })
    }

    async function pickPlacement() {
      const next = await ctx.ui.dialog.select<Placement>({
        title: "Clawstly placement",
        placeholder: "Pick a placement",
        current: placement(),
        options: [
          {
            title: "Top",
            value: "top",
            description: "Under the session name, at the top of the sidebar",
          },
          {
            title: "Bottom",
            value: "bottom",
            description: "Above the ~ path line, at the foot of the sidebar",
          },
          {
            title: "Hidden",
            value: "hidden",
            description: "Home screen only",
          },
        ],
      })
      if (!next) return
      await updateSettings((draft) => {
        draft.placement = next
      })
    }

    // `/clawstly` and the command palette open the tier picker; clicking the
    // tier line does too. `/clawstly-placement` and a second palette entry move
    // Clawstly between the top and the foot of the sidebar; clicking the art
    // does too.
    //
    // `mode: "global"` is required: plugin layers default to `base`, but the
    // prompt only exposes reachable commands from layers that match its mode.
    // OpenCode's own app commands use a global layer for the same reason.
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "clawstly.tier",
          title: "Clawstly: set tier",
          description: "Choose Free, Pro, Max or Ultra",
          group: "Clawstly",
          palette: true,
          slash: { name: "clawstly" },
          run: () =>
            pickTier().catch((error) => {
              ctx.ui.toast.show({ variant: "error", title: "Clawstly", message: String(error) })
            }),
        },
        {
          id: "clawstly.placement",
          title: "Clawstly: set placement",
          description: "Top, bottom or hidden in the session sidebar",
          group: "Clawstly",
          palette: true,
          slash: { name: "clawstly-placement" },
          run: () =>
            pickPlacement().catch((error) => {
              ctx.ui.toast.show({ variant: "error", title: "Clawstly", message: String(error) })
            }),
        },
      ],
    }))

    const [route, setRoute] = createSignal<Route>(ctx.ui.router.current() as Route)
    const routeTimer = setInterval(() => {
      const next = ctx.ui.router.current() as Route
      const previous = route()
      if (next.type !== previous.type || next.sessionID !== previous.sessionID) setRoute(next)
    }, 250)

    // One shared signal drives every visible session copy, but each session is
    // tracked independently so only the open session's state is ever rendered.
    const [busySessions, setBusySessions] = createSignal<ReadonlySet<string>>(new Set())
    const [errorSessions, setErrorSessions] = createSignal<ReadonlySet<string>>(new Set())
    const [animFrame, setAnimFrame] = createSignal(0)

    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const errorTimers = new Map<string, ReturnType<typeof setTimeout>>()
    let animTimer: ReturnType<typeof setInterval> | undefined

    const startAnim = () => {
      if (animTimer) return
      animTimer = setInterval(() => setAnimFrame((i) => (i + 1) % ART_BUSY.length), ANIM_MS)
    }

    const stopAnim = () => {
      if (animTimer) clearInterval(animTimer)
      animTimer = undefined
      setAnimFrame(0)
    }

    function clearError(id: string) {
      const timer = errorTimers.get(id)
      if (timer) clearTimeout(timer)
      errorTimers.delete(id)
      setErrorSessions((previous) => {
        if (!previous.has(id)) return previous
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }

    function release(id?: string) {
      if (!id) return
      const timer = timers.get(id)
      if (timer) clearTimeout(timer)
      timers.delete(id)
      setBusySessions((previous) => {
        if (!previous.has(id)) return previous
        const next = new Set(previous)
        next.delete(id)
        return next
      })
      if (busySessions().size === 0) stopAnim()
    }

    function touch(id?: string) {
      if (!id || !animate) return
      const previous = timers.get(id)
      if (previous) clearTimeout(previous)
      timers.set(id, setTimeout(() => release(id), BUSY_MS))
      setBusySessions((previous) => (previous.has(id) ? previous : new Set(previous).add(id)))
      startAnim()
    }

    function fail(id?: string) {
      if (!id || !animate) return
      release(id)
      clearError(id)
      setErrorSessions((previous) =>
        previous.has(id) ? previous : new Set(previous).add(id),
      )
      errorTimers.set(id, setTimeout(() => clearError(id), ERROR_MS))
    }

    const stops = [
      ctx.data.on("session.execution.started", (e) => {
        clearError(e.data.sessionID)
        touch(e.data.sessionID)
      }),
      ctx.data.on("session.reasoning.started", (e) => touch(e.data.sessionID)),
      ctx.data.on("session.reasoning.delta", (e) => touch(e.data.sessionID)),
      ctx.data.on("session.tool.called", (e) => touch(e.data.sessionID)),
      ctx.data.on("session.tool.progress", (e) => touch(e.data.sessionID)),
      ctx.data.on("session.text.delta", (e) => touch(e.data.sessionID)),
      ctx.data.on("session.execution.succeeded", (e) => release(e.data.sessionID)),
      ctx.data.on("session.execution.failed", (e) => fail(e.data.sessionID)),
      ctx.data.on("session.execution.interrupted", (e) => fail(e.data.sessionID)),
    ]

    function directory() {
      const current = route()
      if (current.type === "session" && current.sessionID) {
        const session = ctx.data.session.get(current.sessionID) as
          | { location?: { directory?: string }; directory?: string }
          | undefined
        const path = session?.location?.directory ?? session?.directory
        if (path) return path
      }
      return ctx.location?.directory ?? ctx.data.location.default().directory ?? ""
    }

    function fit(value: string, max: number) {
      if (max <= 0) return ""
      if (value.length <= max) return value
      if (max <= 1) return "…"
      const head = Math.ceil((max - 1) / 2)
      const tail = Math.floor((max - 1) / 2)
      return value.slice(0, head) + "…" + value.slice(value.length - tail)
    }

    function Block(props: { textWidth: number; sessionID?: string; marginLeft?: number }) {
      const art = () => {
        if (props.sessionID && errorSessions().has(props.sessionID)) return ART_ERROR
        if (props.sessionID && busySessions().has(props.sessionID)) return ART_BUSY[animFrame()]
        return ART_IDLE
      }
      return (
        <box
          flexDirection="row"
          width="100%"
          justifyContent="center"
          marginLeft={props.marginLeft}
        >
          <box flexDirection="column" width={ART_WIDTH} onMouseUp={() => void pickPlacement()}>
            <text fg={ACCENT}>{art()[0]}</text>
            <text fg={ACCENT}>{art()[1]}</text>
            <text fg={ACCENT}>{art()[2]}</text>
            <text fg={ACCENT}>{art()[3]}</text>
            <text fg={ACCENT}>{art()[4]}</text>
            <text fg={ACCENT}>{art()[5]}</text>
          </box>
          <Show when={props.textWidth >= 10}>
            <box flexDirection="column">
              <text fg={ACCENT}> </text>
              <text fg={ACCENT}>{fit(`Clawstly v${version}`, props.textWidth)}</text>
              <text fg={ACCENT} onMouseUp={() => void pickTier()}>
                {fit(subtitle(), props.textWidth)}
              </text>
              <text fg={ACCENT}>{fit(directory(), props.textWidth)}</text>
            </box>
          </Show>
        </box>
      )
    }

    function HomeSplash() {
      const dimensions = useTerminalDimensions()
      const [logo, setLogo] = createSignal<LogoGeometry | null>(null)
      let overlay: BoxRenderable | undefined
      let cachedLogo: Renderable | undefined
      let framesSinceDiscovery = 0
      let discoveryAttempts = 0
      let diagnosticShown = false

      const width = () => dimensions().width
      const height = () => dimensions().height
      const natural = () =>
        [`Clawstly v${version}`, subtitle(), directory()].reduce(
          (max, line) => Math.max(max, line.length),
          TEXT_MIN,
        )
      // Keep the block no wider than the wordmark so centring stays clean.
      const textWidth = () => Math.min(TEXT_MAX, LOGO_WIDTH - ART_WIDTH, natural())

      const discover = (box: Renderable, parent: Renderable) => {
        // Search the whole renderer tree: the overlay's parent is not guaranteed
        // to be an ancestor of the home logo.
        const result = findWordmark(ctx.renderer.root, box.id)
        cachedLogo = result.node
        discoveryAttempts++
        // Wait a few layout passes before reporting a miss.
        if (!result.node && !diagnosticShown && discoveryAttempts === 3) {
          diagnosticShown = true
          ctx.ui.toast.show({
            variant: "warning",
            title: "Clawstly",
            message: `Home logo not found; mascot hidden (${ctx.renderer.root.getChildrenCount()} nodes, ${result.candidates} matches)`,
            duration: 10000,
          })
        }
      }

      // OpenCode moves the wordmark as the prompt grows, so read its live layout
      // instead of deriving its position from terminal height. `x`/`y` are screen
      // coordinates; the absolute overlay's offsets are relative to its parent.
      const syncLogo = () => {
        const box = overlay
        if (!box || box.isDestroyed) return
        const parent = box.parent as Renderable | null
        if (!parent) return
        if ((!cachedLogo || cachedLogo.isDestroyed) && framesSinceDiscovery++ % 30 === 0)
          discover(box, parent)

        const found = cachedLogo as
          | (Renderable & {
              visible?: boolean
              isVisible?: boolean
              display?: string
              opacity?: number
            })
          | undefined
        const hidden =
          !!found &&
          (found.visible === false ||
            found.isVisible === false ||
            found.display === "none" ||
            found.opacity === 0 ||
            found.width <= 0 ||
            found.height <= 0)
        const next =
          found && !found.isDestroyed && !hidden
            ? {
                x: found.x - parent.x,
                y: found.y - parent.y,
                width: found.width,
              }
            : null
        setLogo((previous) =>
          previous?.x === next?.x && previous?.y === next?.y && previous?.width === next?.width
            ? previous
            : next,
        )
      }

      ctx.renderer.on(CliRenderEvents.FRAME, syncLogo)
      onCleanup(() => ctx.renderer.off(CliRenderEvents.FRAME, syncLogo))

      // Position from the visible idle rows; the two padding rows fall below
      // the art and are empty, so the home copy stays where it was.
      const trackedTop = (current: LogoGeometry) =>
        current.y - IDLE_ROWS - TUNING.home.lift + TUNING.home.topAdjust
      const top = () => {
        const current = logo()
        return current ? Math.max(0, trackedTop(current)) : 0
      }
      // Hide when the logo is not found or moves too high: the old static
      // estimate caused the overlap this tracker is meant to remove.
      const fits = () => {
        const current = logo()
        return !!current && trackedTop(current) >= 0
      }

      return (
        <Show when={width() >= 46 && height() >= 22}>
          <box
            ref={(r) => {
              overlay = r
            }}
            visible={fits()}
            position="absolute"
            zIndex={-100}
            left={logo()?.x ?? 0}
            width={logo()?.width ?? "100%"}
            top={top()}
            flexDirection="row"
            justifyContent="center"
          >
            <Block textWidth={textWidth()} />
          </box>
        </Show>
      )
    }

    const disposeHome = ctx.ui.slot({
      prepend: "app",
      render: () => (
        <Show when={route().type === "home"}>
          <HomeSplash />
        </Show>
      ),
    })

    // Two claims, one per placement, so switching is a reactive render flip and
    // never a re-registration. Exactly one renders at a time; `hidden` renders
    // neither, leaving the home copy only.
    //
    // The session name is the sidebar's first row and has no slot above it. The
    // nearest slot is sidebar.content, whose boundary opens directly under the
    // name, so prepending there puts Clawstly at the top of the panel body.
    const disposeTop = ctx.ui.slot({
      prepend: "sidebar.content",
      render: (input) => (
        <Show when={placement() === "top"}>
          <Block
            textWidth={SESSION_TEXT_WIDTH}
            sessionID={input.sessionID}
            marginLeft={SIDEBAR_CENTER_SHIFT}
          />
        </Show>
      ),
    })

    const disposeBottom = ctx.ui.slot({
      prepend: "sidebar.footer",
      render: (input) => (
        <Show when={placement() === "bottom"}>
          <Block
            textWidth={SESSION_TEXT_WIDTH}
            sessionID={input.sessionID}
            marginLeft={SIDEBAR_CENTER_SHIFT}
          />
        </Show>
      ),
    })

    return () => {
      disposeHome()
      disposeTop()
      disposeBottom()
      for (const stop of stops) stop()
      for (const timer of timers.values()) clearTimeout(timer)
      for (const timer of errorTimers.values()) clearTimeout(timer)
      if (animTimer) clearInterval(animTimer)
      clearInterval(routeTimer)
    }
  },
})
