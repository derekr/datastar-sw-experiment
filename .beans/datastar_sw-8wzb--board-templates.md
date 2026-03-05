---
# datastar_sw-8wzb
title: Board templates
status: completed
type: feature
priority: normal
created_at: 2026-03-04T23:21:58Z
updated_at: 2026-03-05T17:10:05Z
---

One-click board creation from pre-built templates. Gives new users something to play with immediately and shows off the board's capabilities. Templates are just pre-defined event sequences replayed into a new board.

## Template Ideas

- Kanban (To Do / In Progress / Done)
- Sprint Board (Backlog / Sprint / In Review / Done)
- Personal (Today / This Week / Later / Done)
- Project Tracker (Ideas / Planning / Active / Shipped)

## Tasks

Leverage the share URL import feature — templates are just pre-compressed event arrays.

- [x] Define template event arrays (Kanban, Sprint, Personal, Project Tracker)
- [x] Compress to base64url hash fragments (hardcoded in SW)
- [x] Add template picker UI to boards list page
- [x] Style template cards

## Summary of Changes

Implemented one-click board creation from 4 pre-built templates (Kanban, Sprint Board, Personal, Project Tracker).

- Template event arrays are built server-side and compressed to base64url hash fragments on first access (cached)
- Template picker UI rendered below the boards grid with icon, title, and description for each template
- Template cards are buttons that POST the pre-compressed hash directly to the validated `/import` route (same path as share URLs)
- Import creates a new board with remapped IDs and redirects to it
- Also fixed the file-based Import button to compress events to base64url and go through the validated import route (previously it posted raw JSON to a removed route)
