# 003 — Remove layout-driven sidebar width animation

- **Status**: TODO
- **Commit**: 37c3a0a
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1–2 files, small

## Problem

Sidebar collapse/expand currently animates layout properties (`width`, `min-width`, `max-width`), which causes layout recalculation during the transition:

```css
/* apps/desktop/src/styles/global.css:3552-3558 — current */
.app-sidebar {
  width: 336px;
  position: relative;
  min-width: 260px;
  max-width: min(520px, 48vw);
  transition: width 160ms var(--ease-out), min-width 160ms var(--ease-out),
    max-width 160ms var(--ease-out);
}
```

This is exactly the class of motion that tends to stutter under load because it animates layout instead of composited properties.

## Target

Do not animate sidebar layout properties. Use either:

1. **Discrete layout change** (preferred minimal fix): no transition on width/min-width/max-width; sidebar snaps between widths.
2. **If motion is required**, animate only composited properties (`transform`/`opacity`) on inner visual content while width change stays discrete.

No width/min-width/max-width transition remains.

## Repo conventions to follow

- Existing durations/easing tokens:

```css
/* apps/desktop/src/styles/global.css:50-53 — current */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--dur-fast: 120ms;
--dur-base: 180ms;
```

- Existing explicit property transition exemplar:

```css
/* apps/desktop/src/styles/global.css:583 — current */
transition: background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), transform 150ms var(--ease-out);
```

## Steps

1. Edit `apps/desktop/src/styles/global.css` and remove the `width/min-width/max-width` transition from `.app-sidebar`.
2. Keep `.app-sidebar.resizing { transition: none; }` behavior intact for drag-resize.
3. (Optional, only if required by UX) add a subtle transform/opacity transition to non-layout inner elements, not to width/min/max itself.
4. Verify collapse and expand interactions remain functionally correct with no visual tearing.

## Boundaries

- Do NOT animate width, min-width, max-width.
- Do NOT change collapse width values (`46px` collapsed) unless explicitly required by product requirements.
- Do NOT modify todo/chat business logic.
- Primary scope: `apps/desktop/src/styles/global.css` (and only minimal companion JSX changes if optional step 3 is used).

## Verification

- **Mechanical**:
  - `cd apps/desktop && node_modules/.bin/tsc --noEmit`
  - `cd apps/desktop && npm run build`
- **Feel check**:
  - Rapidly toggle sidebar collapse/expand 10+ times.
  - Confirm no stretched/intermediate layout artifacts while toggling.
  - In Performance panel, compare before/after: fewer long layout slices during toggle.
  - Ensure drag-resize still behaves as before.
- **Done when**:
  - Sidebar no longer transitions width/min/max.
  - Collapse/expand interaction remains stable and feels crisp.
  - Typecheck and build pass.
