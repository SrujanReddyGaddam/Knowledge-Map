---
name: distill
description: Fold new notes into the "## Current state" section of customer, project and component hubs in the vault, a chunk at a time, continuing where the last run stopped. Use for "/distill", "distill", "distill <hub>", "use my spare tokens on the vault", "what is the current state of <project>" when the hub is behind.
---

# Distill hubs into Current state

Notes pile up and facts change. Each customer/project/component hub carries `## Current state` (the answer) and the other notes are the history. This skill keeps that section current. Rules: the "Current state" section of `{{RULES}}` in this vault (read it once per session).

**Arguments:** none = 3 chunks; a number = that many chunks; `all` = until the queue is empty; a hub file name = only that hub (`--hub <name>`). Stop early whenever the user interrupts: every chunk ends with a complete write, so stopping between chunks loses nothing, and stopping inside a chunk only repeats that chunk next time.

Paths: vault `"{{VAULT_PATH}}"`, queue script `node {{APP_DIR}}/scripts/distill-queue.ts "{{VAULT_PATH}}"`.

## 0. Apply approved proposals
Read `_meta/distill-proposals.md` (create it from the format below if missing). For every ticked line (`- [x]`):
- **supersede A by B:** in A's frontmatter set `status: superseded` and add `superseded_by: "[[B]]"` (edit only those keys, keep the rest of the text exactly). Do not move or rename it.
- **promote A to knowledge:** write or extend a generic `knowledge/` note per README rule 3 (type, template, `sensitivity: internal`, no customer names, people, ids or numbers in prose), link it both ways.
- **answer:** a ticked question line with `Answer: ...` at the end (or a `[[note]]` there to read): fold it into the hub's Current state (drop it from Open questions; update Decisions in force or Where it stands if it changes them) and move `distilled_through` only if new notes were read. A ticked question without an answer stays in Waiting, unticked, with `(no answer yet)` added.
Move each applied line to `## Applied` at the bottom of the file with today's date. Leave unticked lines alone.

## 1. Take the next chunk
Run the queue script with `--next --json` (plus `--hub <name>` if asked). If it says nothing to distill, go to step 5. The result names the hub, its `childHubs`, the `chunk` notes (oldest first) and `set_distilled_through`.

## 2. Read
- The hub: its current `## Current state` (if any) and its own dated lines (a `## Log` or similar) after `distilled_through` and up to and including `set_distilled_through`. Later lines belong to a later chunk.
- Each child hub's `## Current state` only (not their notes).
- Every note in the chunk. Notes under about 25 KB whole; bigger ones by summary, headings and the parts that carry status, decisions, open questions and next steps (skip appendices, data tables, transcripts). A chunk can exceed 12 notes because a date is never split; that is expected. Do not open `sources/` unless a note's claim is unclear and the source is short.

## 3. Rewrite `## Current state`, then move the date
Format (README, "Current state"): italic line `_Distilled through <set_distilled_through>. Read this first; the notes below are the history._`, then **Where it stands**, **Decisions in force**, **Open questions**, **Next**, **Changed recently**. Rules:
- Merge, do not append: the result must read as if written fresh today. A fact that changed is replaced. A reversed decision disappears; the newer one stays with a link to its note. A resolved question leaves Open questions.
- Every claim that came from a note links it (`[[file-name]]`). Keep it under about 40 lines; detail belongs in the notes.
- **Changed recently** = what this chunk added or changed (replace the previous list, max 5 lines). On a first distill: the 3 to 5 biggest things.
- If two notes disagree and the newer one does not clearly win, do not guess: say so under Open questions and add a question line to the proposals.
- Place the section right after the hub's intro paragraph (before the first `## ` heading), or replace it if it exists. Then, and only then, set `distilled_through: <set_distilled_through>` in the hub frontmatter (add the key after `status:` if missing): if the run dies between the two edits, the date has not moved and the chunk is simply redone. Edit only these two places; generated lists and the rest of the hub stay untouched.
- Older hand-kept hub summaries that the Current state now covers (a numbered `## Open questions`, a status table, a hand-written `## Summary`) are not edited: queue a `retire section` proposal for each (once per section). Never retire a live log that sessions still append to (a `## Log` the hub's intro or workflow tells people to add to): it is the history, not a competing summary. If a hand-kept section sits before the first `## ` heading slot, put Current state above it.

## 4. Queue proposals, log, loop
Append to `_meta/distill-proposals.md` (skip any already there):
- `- [ ] supersede [[A]] by [[B]]: <why, one line>` when B fully replaces A (a later plan or version, a question list answered by the call notes, a draft that was sent). Not for notes that are merely older.
- `- [ ] promote [[A]] to knowledge: <the generic finding, one line>` for product behaviour, limits, workarounds or patterns that would help on another engagement and have no `knowledge/` note yet (search first).
- `- [ ] question (<hub>): <what conflicts or is unclear>`. The user answers by ticking it and adding `Answer: ...` at the end of the line.
- `- [ ] retire section "<heading>" in [[hub]]: <why it is now covered>`. Applying it moves that section, unchanged, under a `## Earlier working notes` heading at the bottom of the hub (created once), so nothing is lost and Current state is the only live summary.

Add or extend today's `## <date> (distill)` entry at the top of the vault root `WORKLOG.md` (newest first): hubs touched and the date each now stands at. Then back to step 1 until the chunk budget is spent.

## 5. Finish
Run `node {{APP_DIR}}/scripts/build-indexes.ts "{{VAULT_PATH}}"` if a proposal created a note or changed a status (the proposals file itself is in `_meta/`, which lists skip). Report in a few lines: the chunks done, the queue status line from the script without `--next` (e.g. "4 of 9 hubs up to date, 38 notes pending"), and how many proposals wait for a tick.

## Never
- Edit, move or rename log notes except through ticked proposals; touch `sources/`; delete anything.
- Put PHI, patient data or secrets into a hub. Change a note's `sensitivity`.
- Set `distilled_through` past the date the script returned (that would skip notes).

## Proposals file format
```
---
title: Distill proposals
type: capture
summary: Changes the distill skill wants a yes for. Tick to approve, delete the line to reject, write an answer after a question; the next /distill applies them.
sensitivity: customer-confidential
status: current
---

## Waiting

## Applied
```
