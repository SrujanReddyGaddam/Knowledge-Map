---
name: triage-inbox
description: File the notes in inbox/ (and any capture folders the user names) into the right folder, note type and sensitivity, after one approval. Use for "triage my inbox", "file my notes", "process my captures", or as the daily or weekly upkeep step.
---

# Triage the inbox

Turns raw captures into filed notes. Read `{{RULES}}` in the vault root first.

## 1. Collect
- Every note in `inbox/`.
- Any extra capture folders the user keeps (voice-note apps, meeting-transcript exports). Ask once which ones, and record them in this file under "Extra sources" so the next run knows. Treat those folders as read-only: copy from them, never edit, move or delete there.
- Never silently drop an item because it is old. With more than about 15 items, work in batches, oldest first, and say how many remain.

Extra sources: (none yet)

## 2. Classify each item
One capture can hold several topics: split by topic.

| What it is | Where it goes |
|---|---|
| Reusable knowledge (no customer detail) | `knowledge/<area>/`, type concept / how-to / reference / lesson / bug, `internal` |
| Customer or project material | `projects/<customer>/<project>/`, file name starts with the customer slug, `customer-confidential`, linked from the project hub |
| A meeting or call | `projects/.../`, type meeting, date first in the name; the raw transcript to `sources/` |
| An open question to investigate | `research/`, type research |
| A person worth remembering | `people/` (update the existing note if there is one) |
| A task | the user's task list (ask where it lives the first time, note it here) |
| Noise or already captured | archive it, say why in one line |

Customer details never go into `knowledge/`: split the generic part from the specific part and link both ways. Secrets (tokens, passwords, keys) never get filed: flag them and ask.

## 3. Propose, then write
Show a table: item, destination path, type, sensitivity, one-line summary. Wait for a yes (one yes covers the table). Write each note from `_templates/<type>.md` with the required frontmatter (`type`, `summary`, `sensitivity`), lower-case hyphenated unique names, no hard-wrapped prose, linked to its hub. The original capture moves to `sources/` (raw) or `archive/`; it is never deleted.

## 4. Finish
- `node {{APP_DIR}}/scripts/build-indexes.ts "<vault path>"`
- A dated line in `WORKLOG.md`: items filed per destination, items skipped, anything waiting for a decision.
