---
name: "THỜI KHẮC"
description: "Cream paper, gold and muted teal for the exhibition welcome, drawing and operations UI."
colors:
  paper: "#faf3db"
  surface: "#fffbee"
  ink: "#253e40"
  muted: "#71664e"
  teal: "#306874"
  gold: "#a97520"
  line: "#dcd0ae"
  control-line: "#908b76"
  danger: "#993d2d"
  soft-teal: "#e8edde"
  sand: "#ffe1a0"
  warning: "#825711"
typography:
  display:
    fontFamily: '"Avenir Next", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "clamp(54px, 6.5vw, 88px)"
    fontWeight: 650
    lineHeight: 1.12
    letterSpacing: "-.04em"
  headline:
    fontFamily: '"Avenir Next", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-.025em"
  title:
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "-.02em"
  body:
    fontFamily: '"Avenir Next", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontSize: "12px"
rounded:
  field-small: "4px"
  panel: "6px"
  control: "8px"
spacing:
  tool-gap: "8px"
  field-gap: "12px"
  group-gap: "16px"
  section-gap: "24px"
  workspace-gap: "32px"
  welcome-gap: "40px"
components:
  welcome-action:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "16px 28px"
  carve-action:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "56px"
    width: "112px"
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  input-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  library-tabs:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "8px 0"
  stage-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  draw-tool-selected:
    backgroundColor: "{colors.soft-teal}"
    textColor: "{colors.teal}"
    rounded: "{rounded.control}"
    padding: "8px"
---

# Design System: THỜI KHẮC

## Overview

**Creative North Star: "THỜI KHẮC — cream paper, gold and muted teal"**

The existing tower-and-waves identity anchors a calm, inviting, artwork-first exhibition UI. Cream paper and ivory surfaces support restrained teal controls; gold belongs to the supplied identity and operational artwork emphasis.

Welcome and Draw give visitors generous space around one clear task. Control uses the same colors, system typography and focus treatment at a higher information density. This system covers `/`, `/draw/` and `/control/` only; Display and the Ending renderer retain their separate materials, motion and visual identity.

**Key Characteristics:**

- Existing tower-and-waves identity, cream paper, gold and muted teal.
- Calm visitor surfaces; compact, precise operator surfaces.
- Native controls, visible keyboard focus and restrained motion.
- Artwork remains the visual center.

## Colors

The frontmatter records shipping UI values; the CSS in `frontend/shared/exhibition-ui.css` is the implementation source. Drawing ink presets and renderer materials are separate from these UI roles.

### Primary

- **Muted teal:** welcome action, submission, operator primary actions, selected tools and keyboard focus.

### Secondary

- **Ochre gold:** supplied identity and the outline around artworks already on stage.
- **Soft teal:** selected drawing tool, live-status strip and library target context.
- **Warm sand:** operator synchronization warnings and favorite emphasis.

### Neutral

- **Cream paper:** page background; **ivory surface:** canvas framing, inputs, topbar and stage container.
- **Dark teal ink:** main copy; **warm muted ink:** supporting labels and guidance.
- **Paper divider:** structural separators; **control stroke:** visible boundaries around interactive fields and secondary actions.
- **Brick error:** failure feedback and destructive actions; **ochre warning:** stale connection or off-air state. Each accompanies text or an observable state.

**The Scope Rule.** These tokens style the visitor and operator interface; never recolor the Display or Ending renderer from this document.

## Typography

The operational UI uses a local system stack, beginning with Avenir Next where available. Draw alone uses the supplied, self-hosted DFVN Aostora for “Khắc” and DFVN STAMPA V2 for the visitor invitation, with system fallbacks and swap loading. V2 uses conventional Vietnamese diacritics; V1 uses stylized detached marks and is retained only as an alternate through `--draw-cta-font`, not loaded unless used. No external font service is required.

- **Display:** welcome title; portrait uses `clamp(44px,9vw,76px)` and short landscape uses (42px).
- **Headline:** Control page title; phone uses (27px).
- **Title:** Control section titles. Draw's heading is screen-reader-only so visitors focus directly on the canvas.
- **Body:** Control's base text. Welcome invitation uses (20px), line height (1.6), width (32ch), falling to (17px) on phones and (16px) in short landscape.
- **Label:** compact operational descriptions and tool captions. Numeric operational values use tabular figures. Draw RGB fields and Control fields at widths up to (820px) use (16px) to avoid small-input Safari zoom.

## Layout

Shared spacing values record recurring distances, not a new universal grid. Welcome caps its two-column composition at (1200px), with its supplied illustration beside the invitation; portrait up to (900px) stacks and centers the composition. Phone and short-landscape rules reduce padding and type without adding navigation.

Draw centers a square paper within (720px), without a visible header or navigation. The visitor invitation sits above the paper, with a separate fullscreen icon in the upper-right viewport corner. Paper width respects dynamic viewport height: `min(720px, 100%, calc(100dvh - 284px))`, with an `svh` fallback; short landscape reserves (220px). The tool row sits below the paper and may exceed its width while respecting viewport width. Insets account for safe areas; status feedback uses the existing toast. New visitor ink defaults to dark green `#096120`, sampled from the supplied scroll title; saved preferences and older artwork keep their original colors and metallic material.

Control caps at (1720px): a flexible operational column and a sticky (380px) library, shifting to (420px) above (1500px) and (330px) below (1100px). At (820px) it becomes a single flow with a static library. On wide but short screens, the library also becomes static. Preserve this operational hierarchy rather than copying Welcome's composition.

## Elevation & Depth

Most surfaces use background tone, borders and whitespace. The welcome and canvas frame have no card shadow. Draw's tool panel uses a small ambient shadow (`0 8px 24px #253e401c`); Control's library menu uses (`0 8px 24px #253e4025`) and notice uses (`0 8px 30px #253e4025`). Native dialogs use a dim backdrop (`#253e4066`). The sidecar records these existing treatments and their sources.

## Shapes

Gently curved controls share the control radius; compact library contexts and thumbnails use the small radius, and stage containers/dialogs use the panel radius. The drawing paper remains square with a (2px) outline, without painting its UI background or frame into submitted artwork. Control's operational sections remain flat and separated by lines; library tabs use straight underlines rather than pills. Draw color swatches alone are circular.

## Components

- **Welcome action:** native link, ivory text on teal, minimum height (60px), with an inline arrow. Phone height is (56px); short landscape height is (48px). Active state darkens the existing teal.
- **Draw submission:** teal Khắc action with an explicit muted disabled state. Existing submitting, success and retry messages remain near the paper; submitting uses soft teal. Disabled state and color never replace the text or live feedback.
- **Draw tools:** compact outlined SVG icons with accessible labels and tooltips, without visible captions. Selected tools use soft teal, teal border and `aria-pressed`; history controls retain disabled states. Minimum targets are (44px), with larger default tool heights of (56px).
- **Operator buttons:** teal primary, transparent secondary with a control stroke, and brick-text destructive variants. All have minimum height (44px), native disabled behavior and visible focus.
- **Fields:** ivory surface and control stroke, minimum height (44px). Retain visible labels, native number/color/select behavior and error semantics. RGB fields use the smaller radius.
- **Navigation:** visitor welcome has the single Draw action; Draw exposes only the canvas and drawing controls. Control has its own topbar and operational section links. Library filters are native pressed buttons with a teal active underline; they are not a public application menu.
- **Cards and containers:** stage preview has an ivory container with toolbar and footer; saved moments use compact rounded containers. Library artwork tiles use teal backing, with a gold outline when already on stage. These preview treatments do not redefine renderer materials.

**The Focus Rule.** Keyboard focus remains a distinct teal outline (3px) with offset (4px), including on links, buttons, inputs, selects and disclosure summaries.

Motion is limited to existing state feedback: Draw control fades, a tool panel entering over (.18s), and Control button transitions over (.16s). Reduced-motion preferences disable those transitions/animations and smooth scrolling.

## Do's and Don'ts

### Do:

- Do reuse the supplied tower-and-waves identity and shared UI tokens.
- Do keep artwork central and match density to visitors or operators.
- Do retain text labels, native disabled/pressed states and visible keyboard focus.
- Do preserve square canvas geometry, safe-area spacing and normal-flow feedback.

### Don't:

- Don't apply this UI palette, typography or motion to Display or the Ending renderer.
- Don't expose Control, Display, diagnostics or Ending as visitor menu destinations.
- Don't paint the paper frame or UI background into transparent submitted artwork.
- Don't introduce a font service, framework or decorative interaction to express this identity.
