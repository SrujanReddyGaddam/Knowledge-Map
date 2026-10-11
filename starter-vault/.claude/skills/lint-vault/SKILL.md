---
name: lint-vault
description: Weekly health check of the vault against {{RULES}} (missing frontmatter, notes without a hub, orphans, broken links, stale sources, customer names in generic notes, secrets, contradictions, gaps). Proposes fixes and changes nothing without a yes. Use for "lint the vault", "vault health check", "what needs cleaning up".
---

# Lint the vault

Read `{{RULES}}` first. The Knowledge Map app's Health tab ({{APP_URL}}, Browse drawer, key `b`) shows the structural checks live; use it as the starting list. `inbox/`, `sources/`, `archive/` and `journal/` get lighter rules.

## Checks
1. **Frontmatter:** every note has `type` (from the closed list), `summary`, `sensitivity`; `status` is one of `draft | current | needs-verification | stale | closed`. Customer material has `customer:` and is `customer-confidential`.
2. **Structure:** notes that no hub lists or links (skip hubs themselves), orphans (no links in or out), broken `[[links]]`, duplicate file names.
3. **Leaks:** customer names, people, codenames, emails or tenant URLs in `internal`/`public` notes, in the body and in `title`/`summary`/`tags`, with `[[...]]` links removed first. Match whole words, case-insensitive (`grep -iwE`), so short names do not hit inside other words. Collect the names from the `customer:` values and the people and codenames listed in the customer hubs.
4. **Secrets:** tokens, keys, passwords, private keys, connection strings anywhere in the vault, using the patterns in `.claude/skills/organize-vault/SKILL.md` (stage 1). Report path and line only, never the value.
5. **Staleness:** `status: current` notes whose `source_fetched` is over 90 days old; inbox items over 7 days; older notes that overlap newer ones.
6. **Contradictions:** notes sharing tags or a hub that state different facts. Say which one looks current and why.
7. **Gaps:** concepts, people or tools mentioned in 3 or more notes without a note of their own (name the 3 places).

## Output
```
Lint pass YYYY-MM-DD
Frontmatter: ...
Structure: ...
Leaks: ...
Secrets: ...
Stale: ...
Contradictions: ...
Gaps: ...
Nothing has been changed. Confirm items to fix, or "all".
```

## Rules
- Propose only. Fix after a yes. Moves and renames go through the app's Rename (it rewrites links).
- Hub lists are generated: if a list is wrong, fix the note's frontmatter and run `node {{APP_DIR}}/scripts/build-indexes.ts "<vault path>"`.
- Add one dated line to `WORKLOG.md` with the counts.
