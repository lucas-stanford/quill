---
id: qui-tgp9
status: open
deps: [qui-snlw]
links: []
created: 2026-07-31T20:41:59Z
type: task
priority: 1
parent: qui-7m9o
tags: [ferricket, lane]
---
# M5/tickets — plan to ferricket breakdown

A plan's job is to become work. Headings become epics, numbered steps become tasks parented to them, and ordering stated in the plan becomes fer dep edges. Approving lands the user on a populated board rather than an approved document nobody acts on.

Dogfood note: this whole project is already tracked this way, so the shape is known to work.

## Design

Shell out to the fer CLI rather than writing .tickets files directly, so ferricket owns its own format.

## Acceptance Criteria

An approved plan produces a populated fer board with correct parents and dependencies.

