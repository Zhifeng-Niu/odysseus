// Catppuccin Mocha palette + Nolan Odyssey cinematography semantics.
//
// The palette is the canonical Catppuccin Mocha values (https://catppuccin.com).
// The semantic mapping is tuned for the Orchestrator event stream:
//   - Waypoint lifecycle gets distinct, identifiable hues
//   - Status accents (success/failure/info) lean warm rather than neon
//   - "Voyage timeline" backgrounds use mantle/crust for layered depth
//
// All colors are hex strings; Ink's <Text color="#..."> accepts them directly.
export const palette = {
    // ─── Base surfaces ───────────────────────────────────────────────
    base: '#1e1e2e',
    mantle: '#181825',
    crust: '#11111b',
    // ─── Text ────────────────────────────────────────────────────────
    text: '#cdd6f4',
    subtext0: '#a6adc8',
    subtext1: '#bac2de',
    // ─── Elevated surfaces ───────────────────────────────────────────
    surface0: '#313244',
    surface1: '#45475a',
    surface2: '#585b70',
    // ─── Overlay (muted, for borders/hints) ──────────────────────────
    overlay0: '#6c7086',
    overlay1: '#7f849c',
    overlay2: '#9399b2',
    // ─── Accents (cool) ──────────────────────────────────────────────
    blue: '#89b4fa',
    lavender: '#b4befe',
    sapphire: '#74c7ec',
    sky: '#89dceb',
    teal: '#94e2d5',
    // ─── Accents (warm — Nolan's amber sun) ──────────────────────────
    green: '#a6e3a1',
    yellow: '#f9e2af',
    peach: '#fab387',
    maroon: '#eba0ac',
    red: '#f38ba8',
    mauve: '#cba6f7',
    pink: '#f5c2e7',
    flamingo: '#f2cdcd',
    rosewater: '#f5e0dc',
};
/**
 * Semantic colors mapped to Orchestrator concepts.
 *
 * Use these in components rather than reaching into `palette` directly —
 * keeping the mapping centralized means a re-skin only edits this file.
 */
export const theme = {
    palette,
    // ─── Waypoint lifecycle ──────────────────────────────────────────
    waypoint: {
        started: palette.lavender,
        iteration: palette.sky,
        awaitingApproval: palette.peach,
        committed: palette.green,
        rolledBack: palette.maroon,
        failed: palette.red,
    },
    // ─── Planner ─────────────────────────────────────────────────────
    // Iteration 16 — planner observability. Distinct hue (teal) so plan
    // decomposition events are visually separable from waypoint lifecycle.
    // Teal sits between sky (iteration, cool) and green (committed, success)
    // — a plan is "structured intent", cooler than a commit but warmer than
    // a raw iteration counter.
    plan: {
        badge: palette.teal,
        goal: palette.sapphire,
        step: palette.sky,
        meta: palette.subtext0,
    },
    // ─── Self-evolution (curiosity, memory, self-monitor) ────────────
    // Iteration 17 — surface previously-hidden events. These describe the
    // agent's autonomous inner life: curiosity exploration, memory
    // consolidation, self-monitor nudges, recovery interventions, and
    // protocol-signal misuse. Palette picks:
    //   - pink/flamingo for curiosity (warm, forward-looking)
    //   - green for memory (growth, accumulation)
    //   - peach for self-monitor (attention, nudge)
    //   - maroon for recovery (alert, but not failure-red)
    //   - red for misuse (protocol violation, must be loud)
    evolution: {
        curiosity: palette.pink,
        memory: palette.green,
        selfMonitor: palette.peach,
        recovery: palette.maroon,
        misuse: palette.red,
    },
    // ─── Tool calls ──────────────────────────────────────────────────
    toolCall: {
        name: palette.sapphire,
        argsKey: palette.subtext0,
        argsValue: palette.text,
        success: palette.green,
        error: palette.red,
    },
    // ─── Verify gate ─────────────────────────────────────────────────
    verify: {
        running: palette.yellow,
        passed: palette.green,
        failed: palette.red,
    },
    // ─── Assistant message ───────────────────────────────────────────
    assistant: {
        label: palette.mauve,
        text: palette.text,
    },
    // ─── User prompt + chrome ────────────────────────────────────────
    user: {
        label: palette.peach,
        text: palette.rosewater,
    },
    chrome: {
        border: palette.surface1,
        borderDim: palette.surface0,
        hint: palette.overlay1,
        prompt: palette.peach,
        cursor: palette.text,
        divider: palette.surface2,
        background: palette.mantle,
        backgroundElevated: palette.base,
    },
    // ─── Typography ──────────────────────────────────────────────────
    text: {
        primary: palette.text,
        secondary: palette.subtext1,
        muted: palette.overlay1,
        dim: palette.overlay0,
    },
};
//# sourceMappingURL=theme.js.map