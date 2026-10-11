---
name: organize-vault
description: One-time cleanup of an existing vault into the schema in {{RULES}}. Takes a safety snapshot, inventories every note, finds secrets and customer details, proposes a manifest (move, type, sensitivity, split, redact, quarantine secrets), and applies it only after the user approves. Use when someone says "organize my vault", "sanitize my notes", "migrate my notes to the schema", or right after adopting an existing vault into Knowledge Map.
---

# Organize and sanitize a vault

Turns a pile of existing notes into the layout in `{{RULES}}` (read it first, completely) and makes sure nothing sensitive is mislabelled or exposed. It runs in stages. Gate 1 needs an explicit yes before anything is moved, rewritten or redacted.

Work from the vault root (the folder with this `.claude/`). The Knowledge Map app is in `{{APP_DIR}}` and runs at `{{APP_URL}}` (if the user changed the port, use theirs everywhere below).

## Ground rules

- **Back up before touching anything** (stage 0). If a step fails halfway, stop and say so. Do not improvise a fix on the user's real notes.
- **Never delete.** Superseded notes go to `archive/`. Secrets are moved out of the vault (stage 3), not deleted; the user decides what happens to them.
- **Never quote a secret or note content** in chat, commits, issues or anything outside the vault. Refer to findings by path and line ("line 12 looks like an API key").
- **Keep what the user wrote.** Frontmatter is merged: existing keys stay unless they conflict with the schema, in which case the old value goes into the body as a `Status note:` line. Prose is not rewritten, except for redaction and splits approved at gate 1.
- **Batches.** For more than about 60 notes, run stages 3 and 4 in batches by folder and report progress after each batch.
- **In scope:** every `.md` file except dot-folders, `_templates/`, `_meta/`, and the scaffold at the root (`{{RULES}}`, `CLAUDE.md`, `AGENTS.md`, `WORKLOG.md`, `index.md`). Drawings (`*.excalidraw.md`, `*.excalidraw`) are moved like notes but their content is not edited.

## Stage 0: Interview and backup

Ask in one short message:
1. Which customers or organisations appear in these notes? Their slugs (e.g. `acme`) and every other name they go by: people, product or project codenames, tenant or host names. This list stays local and is only used to find customer details.
2. Is any of this personal (health, family, money, immigration)? Personal notes go to `personal/` with `sensitivity: personal`, unless the user prefers a separate vault.
3. Where do you keep secrets (password manager and vault/folder)? Used to replace secrets with a pointer.
4. Any folders that are off-limits, or meant to stay exactly as they are?
5. Is the vault synced by iCloud, Dropbox, OneDrive or Google Drive?

Then:
- **Snapshot:** `mkdir -p ~/.knowledge-map/snapshots/<YYYY-MM-DD>` and `tar -czf ~/.knowledge-map/snapshots/<YYYY-MM-DD>/<vault-name>.tgz -C "<parent>" "<vault-folder>"`, then `chmod 600` the archive. Tell the user where it is, and that it contains everything, secrets included, so it should not be shared.
- **Baseline:** note the app's startup line (`[vault] <names>: N notes, M links, K unresolved`, in the terminal or `~/Library/Logs/knowledge-map.log`) and the Health tab counts. If several vaults are configured the line sums them; that is fine, compare the same line before and after.
- Do **not** create a git repository yet: it would capture secrets in history before the scan. That happens at the end of stage 1.

## Stage 1: Inventory

For every note in scope collect: path, size, frontmatter present or not, existing `type`/`tags`/`status`, first heading, last modified date, outgoing `[[links]]`.

Scan and record each finding with path and line only:
- **Secrets.** Use word boundaries and minimum lengths so ordinary words do not match:
  `grep -rnE --include='*.md' '\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})' .`
  plus `-----BEGIN [A-Z ]*PRIVATE KEY-----`, URLs with `user:password@`, and lines like `password: ...`, `token = ...`, `secret=...`, `api_key ...` followed by a long value. A file that is mostly credentials (`PAT.md`, `tokens.md`, `.env.md`) is a whole-file finding. Read each hit before reporting it and drop obvious false positives.
- **Customer details:** each name from the stage 0 list as a whole word, case-insensitive (`grep -rniwE --include='*.md' 'acme|jane doe|...' .`), plus email addresses, customer hostnames and tenant URLs, ticket ids tied to a customer, patient or employee data, contract numbers, prices.
- **Personal details** (if the user said some notes are personal).
- **Mixed notes:** reusable knowledge and customer specifics in one note (split candidates).
- **Duplicates:** same title, or mostly the same text.
- **Broken links**, and notes with no links in or out.

**Then start git** (skip if the vault is synced; the snapshot is the backup then): `git init`, a `.gitignore` with `.obsidian/workspace*.json`, `.trash/`, `.DS_Store`, **plus every file with a secret finding** (whole-file or inline), then commit everything else as "Before organize-vault". Local only, never add a remote. Files with inline secrets are added to git in stage 3, after they are redacted. If the vault already was a git repo, say plainly that secrets already in its history stay there, and that the fix is rotating the credentials.

## Stage 2: Manifest (gate 1)

Write `_meta/migration-manifest.md` (frontmatter `type: reference`, `sensitivity: customer-confidential`). One row per note:

| current path | action | target path | type | sensitivity | customer | project | summary | notes |
|---|---|---|---|---|---|---|---|---|

- `action`: `keep`, `move`, `split` (into a generic `knowledge/` note and a customer `projects/` note, linked both ways), `merge` (into the named note; the leftover goes to `archive/`), `archive`, `redact` (remove customer specifics from a note that will be `internal`), `secret` (credential moved out of the vault, a stub stays, see stage 3), `skip` (off-limits). Combine where needed (`move + redact`).
- Targets follow the folders and naming in `{{RULES}}`.
- Sensitivity: anything that names a customer or its people, data, tenants, contracts or numbers is `customer-confidential`. Generic knowledge is `internal` (or `public` if the user says so). Personal is `personal`. When unsure, pick the stricter level and mark the row "check".
- Hubs to create: always `knowledge/knowledge.md` (if missing); one per customer (`projects/<customer>/<customer>.md`) and one per project (`projects/<customer>/<project>/<customer>-<project>.md`); `personal/personal.md` if there are personal notes; an extra area hub for any `knowledge/<area>/` with 3 or more notes. Every note must end up linked from or linking to a hub: a note in an area without its own hub links to `[[knowledge]]`.

Show the user a summary, not the whole table: counts per action; every `secret`, `redact` and `split` row; every "check" row; the hubs; and any guesses (project slugs, types). **Wait for an explicit approval.** Apply requested changes to the manifest first.

## Stage 3: Apply (after gate 1)

In this order, committing after each step ("organize-vault: secrets", "organize-vault: moves", ...):

1. **Secrets.**
   - Whole-file: move the file to `~/.knowledge-map/quarantine/<vault-name>/` (`mkdir -p`, `chmod 700` the folder, `chmod 600` the file). In its place write a stub note with the same name: `type: reference`, `sensitivity: internal` (or `customer-confidential` if the context names a customer), a summary like "Credentials for X", the non-secret context the file had (which system, which host), and "Stored in <the user's secret store>". Remove the file's line from `.gitignore` once the stub has replaced it.
   - Inline: replace only the value with `<redacted: stored in <secret store>>`, remove the file's line from `.gitignore`, then `git add` it.
   - Add each quarantined file's original path to the vault's `exclude` list in `{{APP_DIR}}/config.json` only if no stub took its place (a stub with the same path must stay visible). The exclude guards against the file coming back from the snapshot or a sync conflict.
   - Tell the user: rotate every real credential that was in a note, and the snapshot still holds the old values.
2. **Moves and renames.** Preferred: the running app with the vault set `"writable": true`, through `POST {{APP_URL}}/api/rename`, which rewrites links in every other note.
   - Token: `GET {{APP_URL}}/api/session` with header `X-KM: 1` returns `{"token": ...}`.
   - Note id: the file name without `.md` when that name is unique across all configured vaults, otherwise `<vault name>/<path inside the vault>` (e.g. `Work/index.md`). A 404 on the dry run usually means you need the long form.
   - Dry run: `POST` JSON `{"id": "<id>", "to": "<new path inside the vault, with .md>", "dryRun": true}` with headers `X-KM: 1`, `X-KM-Token: <token>`, `Origin: {{APP_URL}}`, `Content-Type: application/json`. Check the plan (`blocked` must be empty).
   - Apply: the same body with `"dryRun": false, "planHash": "<planHash from the dry run>"`. After each rename the server rescans the vault (about 0.7 s); wait 1 to 2 s before the next dry run.
   - Remove folders the moves left empty (list them with `find . -type d -empty -not -path './.git*'`, check, then `rmdir`).
   - Without the app: `git mv` and fix `[[links]]` and relative `.md` links yourself. Wikilinks resolve by file name, so a pure folder move only breaks path-style links.
3. **Splits and merges.** Start new notes from `_templates/<type>.md`: fill `title`, remove the `km_folder` and `km_dated` lines and any `{{...}}` placeholders, and set `source_fetched` only when the note really comes from an external source (with the date it was fetched, not today). Keep the user's wording, link the generic and specific parts both ways, and put merged leftovers in `archive/` with a line saying where the content went.
4. **Redaction.** In notes that end up `internal` or `public`, replace customer names, people, codenames, tenants, ids and numbers with neutral words ("the customer", "a payer", `<tenant>`), in the body and in the frontmatter (`title`, `summary`, `tags`). `[[wikilinks]]` to customer notes may stay: Safe mode shows them as "(hidden note)". Never put a customer name in a link alias. Do not redact `customer-confidential` notes.
5. **Frontmatter.** Add or merge `title`, `type`, `summary`, `sensitivity`, `tags`, `customer`, `project`, `status`, and `source`/`source_fetched` where known. Keep CRLF files CRLF. Do not reformat YAML you are not changing.
6. **Hubs.** Create the hubs from the manifest with `km:list` markers (see `{{RULES}}`, "Generated lists"), and check that every note links to or is listed by a hub.

## Stage 4: Check

- `node {{APP_DIR}}/scripts/build-indexes.ts "<vault path>"`, then the same with `--check` (expect nothing out of date).
- **Leak audit:** for every `internal`/`public` note, search body and frontmatter, with links removed (`sed -E 's/\[\[[^]]*\]\]//g'`), for each stage 0 name as a whole word (`grep -iwE`) and for email addresses. Expected: zero hits. Fix and repeat until it is.
- **Secrets re-scan** with the stage 1 patterns over the whole vault: zero hits (stubs say where a secret lives, never the value).
- Restart the app if `config.json` changed (macOS launchd: `launchctl kickstart -k gui/$(id -u)/<label>`), and compare the `[vault]` line with the stage 0 baseline (notes go up by the splits and stubs; unresolved links must not go up).
- **Health and Safe mode:** ask the user to open the Health tab (Browse drawer, key `b`) and Safe mode (`{{APP_URL}}/?safe=1`), or check yourself in a headless browser. Expected: lint close to zero (explain what remains), and in Safe mode only `public`/`internal` notes, none naming a customer.

## Stage 5: Report (gate 2)

Everything is already committed step by step, so gate 2 is the user's review: anything they dislike can be undone with `git revert` (or from the snapshot) before you wrap up. Report counts (moved, split, merged, archived, redacted, secrets quarantined, stubs written, hubs created), anything skipped and why, the backup and quarantine locations, and the credentials to rotate. After a yes: a dated entry in `WORKLOG.md`, a final commit, and ask whether to keep `_meta/migration-manifest.md` for reference (it is customer-confidential and excluded from the map).
