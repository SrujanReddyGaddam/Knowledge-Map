---
name: setup-knowledge-map
description: Interview a new user and set up Knowledge Map end to end on their machine. Finds or creates their vault(s), scans for secrets, writes config.json, installs, optionally runs it at login, verifies it in a browser, and offers to organize and sanitize existing notes. Use when someone says "set this up", "set up Knowledge Map for me", "install this", or opens this repo for the first time.
---

# Set up Knowledge Map for a new user

Goal: the person ends with the app running on their own notes, in one sitting, without editing files by hand. You do the work; they answer questions. Assume they know nothing about this repo or anyone else's setup: never reuse paths, names or customers from examples.

Keep the interview short. Ask at most 3 or 4 questions per message, offer a default for every question ("Enter = default"), and tell them which calls you made for them. Read `AGENTS.md` once for the details referenced below.

## 1. Check the machine (no questions yet)
- `node -v`: the app needs `^20.19.0 || >=22.12.0`, the vault scripts need 22.18 or newer. If missing or older, offer to install Node 24 LTS (Homebrew `brew install node@24`, or nvm), and wait for a yes.
- `git --version` (optional, used for the vault safety net), OS (macOS, Linux or Windows), whether port 7777 is free (`lsof -i :7777` or `netstat`). If it is busy, pick 7778 and set `KM_PORT` everywhere below.
- Look for existing Obsidian vaults: folders that contain `.obsidian/`, at most 4 levels deep under the home folder, plus `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/*` on macOS. Skip `Library/` (except that iCloud path), `node_modules`, and dot-folders. Do not open any note yet.

## 2. Interview
**Round 1: what they have.**
1. Show the vaults you found (path, rough note count from `find -name '*.md' | wc -l`) and ask which to include. Also: "Any other folders of markdown notes, even without Obsidian?"
2. "Do you want a new, organized work vault as well?" Default: yes if they have no vault, otherwise ask. If yes: where (default `~/Documents/<FirstName>-Work`), and the display name (default "Work").
3. Their name (used in the vault's rules file).

**Round 2: per vault** (one short block per vault).
4. Display name (default: folder name).
5. "Should the app be allowed to edit notes in it?" (`writable`). Default: yes for the new vault, no for existing ones until they have a backup. Leave iCloud-synced vaults read-only unless they opt in.
6. "Does it hold customer or other confidential material?" If yes, explain Safe mode in one line (the shield button hides everything not marked `public` or `internal`, for screen sharing).
7. For an existing vault: "Do you want the standard layout for it (folders by lifecycle, note types, sensitivity labels, agent skills)? I add the rules now, and organizing the notes is a separate, careful step you approve." Default: ask, do not assume.
8. For a new vault: "Which customers do you work with?" (slugs for `projects/<customer>/`, optional) and "Keep the fictional `acme` example notes for a tour?" (default yes).

**Round 3: how to run.**
9. On demand (`npm run dev`) or always on at login? Always-on is macOS only here (launchd). On Linux suggest a systemd user unit, on Windows a Task Scheduler entry, both running `node node_modules/vite/bin/vite.js --port 7777` in this folder.
10. Palette (paper, sage, clay, ocean, dusk). Default sage; they can switch in the app.

## 3. Secrets scan (before the app ever reads a vault)
For every existing vault, scan the markdown for likely secrets (same patterns as `starter-vault/.claude/skills/organize-vault/SKILL.md`, stage 1) and for files whose names suggest secrets (`PAT`, `token`, `secret`, `password`, `.env`, `credentials`). Report path and line only, never the value. Propose an `exclude` entry for each whole-file hit and for meta files (`README.md` at the root, `_templates/`). Confirm with the user. Excluded files never reach the browser.

## 4. Build it
1. `npm install` in this repo.
2. New vault: `node scripts/new-vault.mjs "<path>" --name "<name>" --owner "<their name>" [--customers a,b] [--no-examples] --config [--writable]`.
3. Existing vault they want the schema for (only if they said yes in question 7): `node scripts/new-vault.mjs "<path>" --adopt --name "<name>" --config [--writable]`. It only adds files that do not exist. If it says to add `@VAULT-RULES.md` (or `@README.md`) to their `CLAUDE.md`, ask, then add that one line.
4. Existing vault without the schema: add it to `config.json` yourself, using `config.example.json` as the shape, with the `exclude` list from step 3 and `writable` from the interview. No `lint`.
5. If `config.json` did not exist, `new-vault.mjs --config` creates it. Check that every vault from the interview is in it and that nothing from any example is.
6. Run mode: on demand, start `npm run dev` in the background. Always on (macOS): `scripts/install-launchd.sh --label com.<their-short-name>.knowledge-map [--port <port>]` from a shell where `node -v` is the version you checked (`--port` also sets `KM_PORT` for the service).

## 5. Verify (do not skip)
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/` returns 200.
- The startup log line `[vault] <names>: N notes, M links, K unresolved` (terminal, or `~/Library/Logs/knowledge-map.log` for launchd). N must roughly match the note counts from step 1 minus the excluded files. 0 notes on macOS usually means the `node` binary lacks Full Disk Access for `~/Documents`, `~/Desktop` or iCloud: walk them through System Settings > Privacy & Security > Full Disk Access, add the `node` binary (`which node`, resolve symlinks), then restart.
- Open the page in their browser (`open http://knowledge.localhost:<port>` on macOS). If you can drive a browser, take a screenshot; headless Chrome needs `--enable-unsafe-swiftshader`. Never send screenshots of their notes anywhere.
- For a writable vault: open one note, press `e`, confirm the editor opens, press Esc. Do not save anything.

## 6. Hand over
Tell them, briefly:
- The URL, how to start or stop it (or that it runs at login), and where the log is.
- Keys: `/` search, `b` browse, `t` tasks (every open checkbox from all notes), `n` new note, `e` edit, drag to rotate, scroll to zoom, the shield for Safe mode.
- Their vault has agent skills in `<vault>/.claude/skills/`: start Claude Code in the vault folder and say "triage my inbox", "lint the vault", "harvest <project>", or "organize my vault".
- Offer the next step: "Want me to organize and sanitize your existing notes now?" If yes, follow `<vault>/.claude/skills/organize-vault/SKILL.md` (for a vault that was not adopted, run step 4, item 3 first so the skill and rules are there). It snapshots everything first and asks twice before changing anything.
- What stays private: everything. `config.json` is git-ignored, vault content never enters this repo, and nothing is uploaded. Do not commit, push or open issues with their paths or notes.
