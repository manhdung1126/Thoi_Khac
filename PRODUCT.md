# THỜI KHẮC — Cloud of Strokes

An interactive exhibition where visitors contribute handwritten drawings to a live LED
composition. This document records existing product decisions, not a new feature proposal.

## Audiences and surfaces

- Visitors: `/` is a themed welcome with one action leading to `/draw/`. Organizer-provided
  iPad Safari is the primary device; iPhone Safari is secondary.
- Operators: `/control/` is directly accessed by exhibition staff. Existing PIN and privileged
  API authorization remain in force; removing public links is not a security mechanism.
- Projection: `/display/` renders the existing LED composition and Ending. Its visual identity,
  motion, materials and fullscreen behavior are separate from the public/operator UI system.
- Ending operations belong inside Control. `frontend/ending/` contains required runtime modules,
  not a standalone visitor product.

## Existing capabilities and invariants

Draw supports solid monoline drawing, pressure behavior, eraser, undo/redo, draft recovery,
five widths, preset and custom RGB colors, metallic material, submission retry and deduplication.
There is no manual Clear action. A successful submission clears the drawing through the
existing implementation. Preserve transparent raster/vector output and coordinate mapping.

Control manages pages, cells, artwork, favorites, saved moments and Ending. Preserve Live vs
Editing, selected-cell semantics, 72-card pagination, full-dataset search, reusable cards,
failed-refresh recovery, existing auth, and Ending prepare → ready signal → start → reset.
Readiness signals must not imply that every Display is ready unless the protocol proves it.

## Binding visual identity

Cream paper, gold/ochre and muted teal, with the supplied tower-and-waves logo. Public pages
are calm, inviting and artwork-first; Control is compact and operational, in the same family.
This is a local FastAPI application with native HTML, CSS and browser modules. Do not introduce
a framework, font service, router, drawing library or new authentication architecture merely
to express this identity.

## Validation limits

Automated browser captures establish responsive geometry and observable workflow behavior.
They do not replace physical iPad/iPhone Safari checks of keyboard, native color picker,
safe-area, touch latency and orientation changes on exhibition hardware.
