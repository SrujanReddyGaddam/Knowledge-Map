---
title: Retry with exponential backoff
type: concept
summary: Example concept note: why retries need backoff and jitter, and the defaults worth starting from.
sensitivity: internal
tags: [example, reliability, http]
source: none
source_fetched: {{DATE}}
status: current
related: ["[[confirm-the-data-shape-first]]"]
---

## Summary
Retrying a failed call immediately and in lockstep with every other client turns a short outage into a long one. Wait longer after each failure (exponential backoff) and add randomness (jitter).

## How it works
Delay before attempt n is roughly `base * 2^n`, capped, plus a random part. Typical start: base 0.5 s, cap 30 s, 5 attempts, only for errors that can succeed later (timeouts, 429, 5xx).

## Gotchas
- Never retry validation errors (4xx other than 429): they fail the same way every time.
- Make the operation idempotent first, or a retry can do the work twice.

## Sources
Part of [[knowledge]].
