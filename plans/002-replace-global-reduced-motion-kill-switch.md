# 002 — Replace global reduced-motion kill switch with scoped policy

- **Status**: TODO
- **Commit**: 37c3a0a
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 1 file, medium

## Problem

Reduced-motion currently applies a global wildcard override that effectively disables all transitions and animations for all elements:

```css
/* apps/desktop/src/styles/global.css:1684-1692 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

This removes not just movement, but also useful subtle feedback (opacity/color changes) across the app.

## Target

Replace the wildcard kill switch with a scoped reduced-motion policy:

1. Keep `scroll-behavior: auto`.
2. Remove movement-heavy motion (`transform`, slide/zoom keyframes, continuous looping movement).
3. Keep low-cost feedback transitions (`opacity`, `color`, `background-color`, `border-color`) with short durations.

Target policy follows this principle from audit guidance:

```css
@media (prefers-reduced-motion: reduce) {
  /* drop movement */
  .element { transform: none; animation: none; }
  /* keep comprehension feedback */
  .element { transition: opacity 0.2s ease, color 0.2s ease; }
}
```

Use existing app tokens where possible (for example `var(--dur-fast)`, `var(--ease-out)`).

## Repo conventions to follow

- Existing reduced-motion handling already exists for specific feature motion and should be preserved:

```css
/* apps/desktop/src/styles/global.css:2305-2308 — current */
@media (prefers-reduced-motion: reduce) {
  .chat-source-image.spotlight .chat-source-highlight {
    animation: none;
  }
}
```

- Existing motion tokens:

```css
/* apps/desktop/src/styles/global.css:50-53 — current */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--dur-fast: 120ms;
--dur-base: 180ms;
```

## Steps

1. Edit `apps/desktop/src/styles/global.css` and remove the wildcard `*` reduced-motion block at lines ~1684-1692.
2. Add a new scoped `@media (prefers-reduced-motion: reduce)` block that:
   - disables movement-heavy animations/transforms for interactive surfaces that currently move,
   - retains color/opacity/border transitions with short tokenized timing.
3. Keep existing component-specific reduced-motion blocks (such as `chat-source-highlight`) unless duplicated by the new scoped rules.
4. Ensure no selector in reduced-motion uses a global wildcard for transition duration suppression.

## Boundaries

- Do NOT touch JS/TS files.
- Do NOT remove all visual feedback in reduced-motion mode.
- Do NOT add dependencies.
- Scope changes to `apps/desktop/src/styles/global.css` only.
- If there is ambiguity on whether an animation is explanatory vs decorative, prefer preserving subtle opacity/color and removing transform movement.

## Verification

- **Mechanical**:
  - `cd apps/desktop && node_modules/.bin/tsc --noEmit`
  - `cd apps/desktop && npm run build`
- **Feel check**:
  - In browser devtools, emulate `prefers-reduced-motion: reduce`.
  - Trigger: sidebar interactions, todo item interactions, chat composer actions, source image preview.
  - Confirm:
    - movement-heavy transitions are removed,
    - color/opacity state feedback still exists and is readable,
    - no abrupt “dead UI” feeling from fully stripped feedback.
  - Reset to normal motion and confirm original motion remains for non-reduced users.
- **Done when**:
  - No global wildcard reduced-motion kill switch remains.
  - Reduced-motion behavior is scoped and preserves useful non-movement feedback.
  - Typecheck and build pass.
