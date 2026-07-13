# 001 — Replace `transition-all` in high-frequency primitives

- **Status**: TODO
- **Commit**: 37c3a0a
- **Severity**: HIGH
- **Category**: Performance + Purpose & frequency
- **Estimated scope**: 4 files, small-to-medium

## Problem

Core UI primitives that users hit constantly still use `transition-all`, which animates unintended properties and increases style/composite work on every interaction.

```ts
// apps/desktop/src/components/ui/button.tsx:8 — current
"... whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring ..."
```

```ts
// apps/desktop/src/components/ui/badge.tsx:8 — current
"... text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring ..."
```

```ts
// apps/desktop/src/components/ui/tabs.tsx:66 — current
"... text-foreground/60 transition-all group-data-vertical/tabs:w-full ..."
```

```ts
// apps/desktop/src/components/ui/accordion.tsx:45 — current
"... text-sm font-medium transition-all outline-none hover:underline ..."
```

These components are used throughout the desktop app (buttons, tabs, badges, accordion triggers), so this is a high-frequency feel/perf issue.

## Target

Replace `transition-all` with explicit transition properties and repo tokenized rhythm:

- Easing: `var(--ease-out)` (existing token)
- Durations: `--dur-fast`/`--dur-base` (existing tokens)
- Property sets:
  - Button / badge / accordion: `background-color, border-color, color, opacity, transform, box-shadow`
  - Tabs trigger: `background-color, border-color, color, opacity, box-shadow`

Example target shape:

```ts
// target style string shape (example)
"... transition-[background-color,border-color,color,opacity,transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] ..."
```

No `transition-all` remains in these four files.

## Repo conventions to follow

- Motion tokens already exist in `apps/desktop/src/styles/global.css:50-53`:

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--dur-fast: 120ms;
--dur-base: 180ms;
```

- Existing exemplar of explicit property transitions:

```css
/* apps/desktop/src/styles/global.css:583 — current */
transition: background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), transform 150ms var(--ease-out);
```

## Steps

1. Edit `apps/desktop/src/components/ui/button.tsx` and replace `transition-all` in `buttonVariants` base class with explicit transition properties for button interactions.
2. Edit `apps/desktop/src/components/ui/badge.tsx` and replace `transition-all` with explicit transition properties (no layout properties).
3. Edit `apps/desktop/src/components/ui/tabs.tsx` and replace `transition-all` in `TabsTrigger` with explicit properties suitable for tab state changes.
4. Edit `apps/desktop/src/components/ui/accordion.tsx` and replace `transition-all` in `AccordionTrigger` with explicit properties.
5. Run a repo search to confirm there is no `transition-all` left in these four files.

## Boundaries

- Do NOT add new dependencies.
- Do NOT change component structure, semantics, or public props.
- Do NOT touch files outside:
  - `apps/desktop/src/components/ui/button.tsx`
  - `apps/desktop/src/components/ui/badge.tsx`
  - `apps/desktop/src/components/ui/tabs.tsx`
  - `apps/desktop/src/components/ui/accordion.tsx`
- If class-string token syntax for `duration-[var(--dur-fast)]` is unsupported in this setup, STOP and report; do not improvise with `transition-all`.

## Verification

- **Mechanical**:
  - `cd apps/desktop && node_modules/.bin/tsc --noEmit`
  - `cd apps/desktop && npm run build`
- **Feel check**:
  - In app UI, repeatedly hover/press buttons and tabs for 10+ seconds and confirm no “laggy” or over-broad animation side effects.
  - Open DevTools Rendering/Performance and confirm no unexpected layout-driven animation spikes when interacting with these controls.
  - Keyboard-focus through controls and confirm focus ring remains clear while motion feels snappy.
  - With playback slowed to 10%, confirm only intended properties animate (not width/position).
- **Done when**:
  - All four files use explicit property transitions.
  - No `transition-all` remains in those files.
  - Typecheck and build pass.
