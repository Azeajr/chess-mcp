# Responsive / Mobile UI Design

Status: **proposed**.

Goal: make the PWA usable on phones and correct under window/viewport resize. The desktop and
tablet layouts stay as they are; this adds a phone layout and fixes mobile-only breakage. The app
ships as an installable `display: standalone` PWA, so "mobile" includes the home-screen app where
the OS chrome (notch, home indicator) overlaps the viewport.

---

## Current State

Layout lives in `apps/ui/src/styles.css` + `App.tsx`, with persisted panel widths in
`store/layout.ts`. Three regimes today:

- **Wide (> 1100px):** `.workspace` is a flex row. `.board-panel` is `flex:1`; `.side-panel` and
  `.chat-wrap` are `flex:0 0 auto` with explicit px widths the `Divider`s drag. Widths persist to
  localStorage (`chess.layout.side` / `chess.layout.chat`, clamped 240–800).
- **Tablet (≤ 1100px):** `.workspace` becomes a 2-col grid `minmax(260px,1fr) 320px`; chat spans
  full width below; dividers hidden; inline widths neutralised with `width:auto !important`.
- **Phone (≤ 720px):** single column `1fr`; topbar `flex-wrap`; board capped at `min(70vh,94vw)`.

### Defects

1. **No `viewport-fit=cover`, no safe-area padding.** `index.html` viewport is
   `width=device-width, initial-scale=1` only. In the installed standalone app on notched phones,
   the topbar sits under the notch and the chat input sits under the home indicator.
2. **`.app { height: 100vh }`.** On mobile, `100vh` is the *largest* viewport (toolbar hidden);
   when the URL bar is shown the bottom (the chat input) is pushed off-screen. Needs `dvh`.
3. **Board + eval-bar horizontal overflow.** `.board-wrap` is `min(70vh,94vw)` and the eval-bar
   (16px) + gap (~10px) sit *beside* it, so the row exceeds `100vw` on small phones → sideways
   scroll. The eval-bar width is never subtracted from the board width.
4. **iOS input zoom.** The chat textarea (`0.88rem` ≈ 14px) and settings inputs are < 16px, so
   iOS Safari auto-zooms on focus and jolts the layout.
5. **Resize starves the board.** Persisted px widths (up to 800 each) are honoured down to 1101px.
   With large saved widths, `side + chat` can exceed the window; `.board-panel` (`min-width:0`)
   collapses toward 0 and `.workspace { overflow:hidden }` clips it. Nothing re-clamps on resize.
6. **Touch targets / topbar.** Topbar controls are ~30px tall (< 44px touch minimum) and the 9
   controls `flex-wrap` into a cramped block on phones.
7. **Phone is one long scroll.** Board → analysis → repertoire → move tree → chat all stack;
   reaching chat means scrolling past everything.

---

## Recommendation

Keep desktop/tablet untouched. Add a **phone breakpoint (≤ 720px) with a pinned board + tab bar**,
and apply a set of **global mobile-correctness fixes** that are safe at every size.

Why this shape:

- The pinned board + tabs (Analysis / Moves / Chat) removes the long scroll without changing how
  any panel is built — tabs are a *visibility filter*, not a rebuild.
- Panels stay **mounted**; tabs toggle `display`, so chessground never re-inits, chat keeps its
  log/scroll, and engine/analysis stores are untouched. Tab state is phone-only chrome.
- The global fixes (`dvh`, safe-area, overflow math, 16px inputs, resize clamp) are CSS/plumbing
  that also harden tablet and desktop; no behaviour change there.

---

## Plan

### 1. Global correctness (all breakpoints)

`index.html`
- `viewport` → `width=device-width, initial-scale=1, viewport-fit=cover`.
- Add `<meta name="theme-color" content="#1e1e21">` for the mobile browser chrome before the SW
  manifest applies.

`styles.css`
- `.app` height: `100vh` fallback then `100dvh` (dynamic viewport — tracks toolbar show/hide).
- `body { overscroll-behavior: none }` — kill pull-to-refresh / scroll chaining while panning the
  board or scrolling chat.
- Safe-area insets via `env(safe-area-inset-*)` (resolves to 0 where unsupported): top/left/right
  on `.topbar`; left/right/bottom on `.workspace`.
- **Board overflow fix (global):** `.board-wrap { width: min(70vh, calc(100% - 26px)) }` — the
  `26px` reserves the eval-bar (16px) + gap (10px) so the row can't exceed its container. Binds
  only when width-constrained (exactly the narrow case); on desktop `70vh` wins, so no visual
  change.

### 2. Resize clamp (`store/layout.ts`)

Split *desired* (persisted, divider-driven) from *effective* (rendered) widths. Track viewport
width in a signal updated on `resize`; derive `effSideWidth` / `effChatWidth` memos that shrink
chat-then-side so the board keeps a floor (`BOARD_MIN ≈ 300px`), never below `MIN_PX`. `App.tsx`
uses the effective widths for inline styles; dividers still write the raw desired value, so
re-widening the window restores the saved layout. Only relevant in the wide flex regime (the grid
breakpoints ignore inline widths already).

### 3. Phone layout — pinned board + tabs (≤ 720px)

`store/ui.ts`
```ts
export type MobileTab = "analysis" | "moves" | "chat";
export const [mobileTab, setMobileTab] = createSignal<MobileTab>("analysis");
```

`components/MobileTabs.tsx` — a small segmented control (Analysis / Moves / Chat), rendered in
`App.tsx` between the board and the panels. `display:none` above 720px.

`App.tsx`
- Add `data-mtab={mobileTab()}` to `.workspace`.
- Render `<MobileTabs />` after `.board-panel`.

`styles.css` `@media (max-width: 720px)`
- `.workspace` becomes a **flex column**, `overflow:hidden`: board (`flex:0 0 auto`) + tab bar +
  active panel (`flex:1 1 0; min-height:0; overflow:auto`) — only the active panel scrolls, the
  page does not.
- `.mobile-tabs { display:flex }`.
- Visibility driven by the attribute (panels stay mounted):
  - `[data-mtab="analysis"]` → hide `.move-tree`, `.chat-wrap`
  - `[data-mtab="moves"]` → hide `.analysis`, `.rep-panel`, `.chat-wrap`
  - `[data-mtab="chat"]` → hide `.side-panel`
- Inputs to 16px (`.chat-input textarea`, `.field input`) to stop iOS zoom.

### 4. Touch targets (`@media (pointer: coarse)`)

`min-height: 44px` + roomier padding on `.topbar button/select`, `.chat-input button`,
`.mobile-tabs button`, `.scan-btn`. Scoped to coarse pointers so mouse/desktop density is unchanged.

---

## Non-Goals

- No change to desktop/tablet behaviour beyond the shared correctness fixes.
- No gesture nav, no bottom-sheet chat, no landscape-specific layout (portrait is the target).
- No board-size user setting; board stays auto-sized to the viewport.

---

## Test / Verify

- Type-check + build (`pnpm -C apps/ui build`).
- DevTools device emulation at 360×800 (phone), 768×1024 (tablet), desktop: no horizontal scroll;
  tab switch shows one panel; board never clipped to 0 when dragging dividers then narrowing.
- iOS standalone (if available): topbar clear of the notch, chat input clear of the home bar, no
  zoom on input focus.
