---
name: harvest-project
description: At project close or a milestone, lift reusable knowledge out of a project's customer-confidential notes into generic knowledge/ notes, close the project hub, and offer to archive the project. Use for "harvest <project>", "close out <project>", "what did we learn on <project>".
---

# Harvest a project

Customer work produces generic knowledge that is easy to lose inside customer-confidential notes. Read `{{RULES}}` first.

1. **Inventory.** Read the project hub `projects/<customer>/<project>/<hub>.md` and every note it lists. If the project has a code repo with a plan or worklog, ask for its path and read that too.
2. **Find what is reusable:** product behaviour (bugs, limits, workarounds), how-tos that worked, patterns, lessons, domain knowledge. Check `knowledge/` first and update an existing note rather than creating a near-duplicate.
3. **Propose** a table: candidate, target (`knowledge/<area>/<name>.md`, new or existing), type, what gets made generic. Wait for a yes.
4. **Write.** New or updated `knowledge/` notes are `internal`: no customer names, people, tenants, ids, data or numbers in prose (wikilinks to the project notes are fine). Link both ways. Lessons are type `lesson`; decisions that apply beyond the customer are type `decision` in `knowledge/`.
5. **Close.** Project hub gets `status: closed` and a short "Outcome" section (what shipped, what was learned, links to the harvested notes). Notes that are no longer true get `status: stale`. Offer to move the project folder to `archive/projects/<customer>/<project>/` with the app's Rename/Move (links are rewritten); do it after a yes.
6. **Finish.** `node {{APP_DIR}}/scripts/build-indexes.ts "<vault path>"` and a dated entry in `WORKLOG.md`.
