---
# datastar_sw-eo04
title: WebRTC peer-to-peer board sync
status: draft
type: feature
priority: normal
created_at: 2026-03-04T23:21:42Z
updated_at: 2026-03-04T23:21:42Z
---

Sync board event logs between two browsers via WebRTC data channels — no server at all. Two devices discover each other (manual code exchange or local network discovery), establish a peer connection, and stream events bidirectionally. Changes on one side appear on the other in real-time. The ultimate 'there is no server' demo moment.

## Open Questions

- Signaling mechanism: manual room code? QR code scan? Local network mDNS?
- Conflict resolution: last-writer-wins per entity? CRDTs? Causal ordering via vector clocks?
- Event deduplication: events already have UUIDs, so replay is idempotent
- How to handle divergent histories gracefully

## Tasks

- [ ] Research WebRTC data channel API
- [ ] Design signaling flow (room code exchange)
- [ ] Implement WebRTC connection setup in SW or client
- [ ] Stream events over data channel
- [ ] Merge incoming events into local IndexedDB
- [ ] Handle conflicts and deduplication
- [ ] Live presence indicator (connected peer count)
- [ ] Test cross-device
