# {{VAULT_NAME}}

**Purpose:** {{OWNER}}'s work vault: reusable knowledge (products, domain, engineering, how the work is done) plus customer and project material, readable by coding agents and browsable in Obsidian and the Knowledge Map app.
**Status:** active (created {{DATE}} from the Knowledge Map starter vault)
**Stack:** Markdown + YAML frontmatter, `[[wikilinks]]`, Obsidian (optional), Knowledge Map app ({{APP_URL}}), local git (no remote).

## Rules in one screen

1. Every note has the frontmatter below. `type`, `summary` and `sensitivity` are required.
2. Folders say how long a note lives and who owns it. `type` says what kind of note it is. Topics are tags and hub notes, never new top-level folders.
3. Keep the generic apart from the specific. Customer notes hold only customer facts. Reusable product or domain insight goes into a `knowledge/` note, linked both ways.
4. `sources/` is raw material and is never edited. Distilled notes cite it.
5. Every note links up to at least one hub (`type: hub`). Hub lists are generated (see "Generated lists"), never maintained by hand.
6. Never hard-wrap prose. One paragraph = one line, one list item = one line (Obsidian renders a bare newline as a line break).
7. Cross-reference with `[[file-name]]` (bare file name, no `.md`), not paths.
8. Notes derived from an external doc (wiki page, ticket, chat thread, vendor docs) record `source` and `source_fetched`, so stale knowledge can be refreshed instead of silently wrong.
9. Nothing is deleted. Superseded or finished material moves to `archive/`.
10. No secrets in notes, ever: no tokens, passwords, API keys, connection strings. Write where the secret lives instead ("in the team password manager under X").

## Folders

| Folder | What goes there | Lifetime |
|---|---|---|
| `inbox/` | Unprocessed captures. Dump first, organize later. Target: empty each week. | days |
| `sources/` | Raw, unedited material: transcripts, exports, pasted docs. File names start with the date. | forever, read-only |
| `journal/` | One note per workday (`YYYY-MM-DD.md`): what happened, links to everything touched, tasks. | forever |
| `projects/<customer>/<project>/` | Work with an end date: customer engagements and internal projects. Each customer and each project has a hub note. | until archived |
| `knowledge/` | Evergreen, reusable, customer-free. One subfolder per area, e.g. `knowledge/<product>/`, `knowledge/domain/<area>/`, `knowledge/engineering/<area>/`, `knowledge/craft/`. | forever |
| `research/` | Open questions being investigated. When closed, the verdict is promoted into `knowledge/`. | until closed |
| `people/` | Colleagues and customer contacts: role, org, what they own, context. | forever |
| `personal/` | Optional. Personal notes kept in this vault (health, money, family), `sensitivity: personal`, with a `personal/personal.md` hub. A separate personal vault is better if you have one. | forever |
| `archive/` | Closed projects and superseded notes. Out of the way, still searchable. | forever |
| `_templates/` | One template per note type (used by the app's New note, hidden from the map). | |
| `_meta/` | Working files about the vault itself (e.g. a migration manifest). | |

Rule of thumb for a new note: is it about one customer or project? `projects/`. Would it help on the next engagement? `knowledge/`. Not sure yet? `inbox/`.

## Note types

Closed list. Each has a template in `_templates/` with the sections it needs. A genuinely new kind of note means adding one type and one template here, deliberately.

| type | Use for | Default folder |
|---|---|---|
| `capture` | a raw thought, pasted question list, screenshot dump | `inbox/` |
| `daily` | the journal note for one day | `journal/` |
| `meeting` | who, decisions, action items, link to the source transcript | `projects/...` |
| `concept` | how something works | `knowledge/...` |
| `how-to` | steps to get something done (procedures, runbooks) | `knowledge/...` |
| `reference` | facts to look up: limits, APIs, settings | `knowledge/...` |
| `bug` | a product defect: symptom, repro, root cause, workaround, tickets | `knowledge/...` |
| `incident` | what happened at a customer: timeline, impact, cause, links to the generic `bug`/`concept` | `projects/...` |
| `decision` | context, options, choice, why | `projects/...` or `knowledge/...` |
| `lesson` | a lesson learned, with where it came from and how to apply it | `knowledge/...` |
| `research` | question, sources, findings, verdict | `research/` |
| `explainer` | plain-language story for a non-expert | `knowledge/...` |
| `code-walkthrough` | what a piece of code does: inputs, outputs, logic, file refs | `projects/...` or `knowledge/...` |
| `assessment` | scored evaluation or gap analysis | `projects/...` |
| `hub` | entry point for a customer, project, product or topic, with generated lists | any |
| `person` | a colleague or customer contact | `people/` |

## Frontmatter

```yaml
---
title: Short human title
type: concept            # one of the types above
summary: One line that tells a reader (or an agent scanning summaries) whether to open this note.
sensitivity: internal    # public | internal | customer-confidential | personal
tags: [retries, http]
customer: acme           # only for customer material (slug)
project: demo            # only for project material (slug)
status: current          # draft | current | needs-verification | stale | closed
source: https://...      # or "none" if original
source_fetched: 2026-01-15
tickets: [ABC-123]       # ticket ids, searchable as tickets:ABC-123
related: ["[[other-note]]"]
---
```

Sensitivity decides what the app's Safe mode (for screen sharing) shows: only `public` and `internal` notes. A note without `sensitivity` is hidden in Safe mode. Anything naming a customer, its people, data, tenants, contracts or numbers is `customer-confidential`. `knowledge/` notes are `internal` or `public`, so they never name customers in prose, title, summary or tags. A `[[wikilink]]` to the project note it came from is fine (Safe mode shows it as "(hidden note)"), but never put a customer name in a link alias.

## Naming

- File names are unique across the vault (wikilinks resolve by name). Lower-case, hyphens: `retry-with-backoff.md`.
- Time-bound notes start with the date: `2026-01-15-acme-demo-kickoff.md`. Evergreen notes do not.
- Customer-specific notes start with the customer slug (`acme-...`), so their names never clash with generic notes. Dated customer notes: date first, then the slug (`2026-01-15-acme-...`).
- Hubs: `projects/<customer>/<customer>.md` for a customer, `projects/<customer>/<project>/<customer>-<project>.md` for a project, `knowledge/knowledge.md` for knowledge, plus `knowledge/<area>/<area>.md` once an area has 3 or more notes.

## Generated lists

Hub notes and `index.md` contain marker pairs that the Knowledge Map list builder regenerates from frontmatter:

```
<!-- km:list type=bug customer=acme group=type sort=updated -->
<!-- km:end -->
```

Run `node {{APP_DIR}}/scripts/build-indexes.ts "{{VAULT_PATH}}"` after adding or moving notes (`--check` only reports). Never edit between the markers.

## For agents (Claude Code and others)

- Retrieval: read `index.md`, then the relevant hub, then 1 to 3 notes. Scan `summary` fields before opening bodies. `grep -l "type: bug"` and `grep -l "customer: acme"` work across the vault.
- Allowed without asking: create notes in `inbox/` and `journal/`; edit notes (the vault is in git and the app keeps backups); fix frontmatter; add links; regenerate lists.
- Ask first: moving, renaming, merging or archiving notes; anything in `sources/`; changing these rules.
- Record what you changed in `WORKLOG.md` (newest first, dated). Do not paste note content into commits, issues or logs outside this vault.
- Prefer the Knowledge Map app's Rename (or `POST /api/rename`) for moves, because it rewrites links in other notes.
- Skills for upkeep live in `.claude/skills/` (Claude Code picks them up when started in this folder; other agents can read the `SKILL.md` files directly): `organize-vault` (one-time cleanup and sanitizing of existing notes), `triage-inbox`, `lint-vault`, `harvest-project`.

## Maintenance

| When | What | Skill |
|---|---|---|
| Daily, or when `inbox/` piles up | Each capture becomes a filed note, a task, part of an existing note, or is archived. The raw original goes to `sources/`. | `triage-inbox` |
| After an incident or working session | Write the `incident`, pull the generic `bug`/`concept` into `knowledge/`, add a `lesson` if there is one, link everything to the hubs and the day's journal. | |
| Weekly | The app's Health tab (missing fields, stale sources, old inbox items, notes without a hub, broken links, orphans), then the list builder. | `lint-vault` |
| Project close | Harvest lessons and reusable material into `knowledge/`, move the project to `archive/`. | `harvest-project` |
| Once, when adopting old notes | Inventory, classify, sanitize, move, add frontmatter, with two approval gates. | `organize-vault` |

## How to run

Open {{APP_URL}} (Knowledge Map), or open this folder as an Obsidian vault. Claude Code reads the files directly: start it in this folder.
