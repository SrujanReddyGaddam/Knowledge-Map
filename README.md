# Knowledge Map

A local, 3D interactive map of your Obsidian vaults. Notes are spheres, links are flowing lines, and a side panel renders the selected note. It reads your vaults straight from disk; nothing is uploaded and no vault content lives in this repo.

Features: search with operators, filters (vault, section, tag), local graph focus, Browse drawer (recent, tree, health), backlinks with context, callouts and contents list, hover previews, Excalidraw drawings, 5 color palettes with light/dark, optional click sounds.

For the workday: a **Today** view (`h`: due and overdue tasks, where each code project was left off, today's captures), a **customer cockpit** (`k`: open tasks, changes since you last looked, open questions, projects, meetings, people, tickets, linked code projects, and a Brief me recap), **quick capture** (`c`) into the inbox with a line in the daily journal (`d`), a **Circles** view (`o`: family, friends, colleagues and acquaintances on concentric shells by closeness, told apart by color and shape, who is overdue for a call, birthdays, log a call), a **Tasks** view (`t`) with add, snooze and tick, a **command palette** (Cmd+K), **unlinked mentions** with one-click linking, pasted images in the editor, and a prompt builder for weekly Jira updates.

Also: **workspaces** (`g`: one customer as the context, with a "where was I" trail), a **weekly review** (`w`: the week per customer from the vault's git history and journals, copy as markdown), a **path finder** (`p`: the shortest chain of links between two notes, drawn on the map), **Hand to Claude** (copies a context pack for a Claude Code session), **color by age** with a "Still true?" review queue in Today, and an **MCP server** so Claude Code can search and read the vault through the map's index.

## Quick start
Needs Node `^20.19.0 || >=22.12.0`.

    git clone https://github.com/SrujanReddyGaddam/Knowledge-Map.git
    cd Knowledge-Map
    cp config.example.json config.json     # then set "path" to your vault folder(s)
    npm install
    npm run dev                             # http://localhost:7777

`config.json` accepts several vaults and a per-vault `exclude` list (put secrets there). It is git-ignored. Restart the server after changing it.

## Easiest: let a coding agent set it up (recommended)
    git clone https://github.com/SrujanReddyGaddam/Knowledge-Map.git
    cd Knowledge-Map
    claude                                   # or Codex, Cursor, ... in this folder

Then say **"Set this up for me."** The agent follows [the setup skill](.claude/skills/setup-knowledge-map/SKILL.md): it checks Node, finds the Obsidian vaults already on your machine, asks a few short questions (which vaults, a new work vault or not, which customers, editable or read-only, run at login or on demand), scans your notes for secrets and keeps them out, writes `config.json`, installs, starts the app and checks it really shows your notes. Nothing from anyone else's setup is reused, and nothing leaves your machine.

### Your own organized work vault
The setup can create a new vault from [`starter-vault/`](starter-vault): folders by lifecycle (`inbox/ sources/ journal/ projects/<customer>/<project>/ knowledge/ research/ people/ archive/`), a closed list of 16 note types with templates, required `type` / `summary` / `sensitivity` frontmatter, generated hub lists, and a few fictional `acme` examples. By hand: `npm run new-vault -- ~/Documents/Work --owner "Your Name" --customers acme,globex --config --writable`.

### Already have notes? Organize and sanitize them
`npm run new-vault -- <your vault> --adopt --config` adds only the rules, templates and agent skills (existing files are never touched). Then start your agent in the vault folder and say **"Organize my vault."** The `organize-vault` skill snapshots the vault and puts it in local git, inventories every note, finds secrets (moved out of the vault and excluded) and customer details, and proposes a manifest: where each note goes, its type and sensitivity, which notes to split into a generic `knowledge/` part and a customer part, and what to redact from generic notes. Nothing changes until you approve; it then applies the plan (moves go through the app so links are rewritten), audits for leaks, and asks once more before finishing.

Day to day, the vault skills keep it tidy: "triage my inbox", "lint the vault", "harvest <project>".

## Always-on (macOS)
    scripts/install-launchd.sh              # start at login, restart on crash
    scripts/install-launchd.sh --print      # preview the service file
    scripts/install-launchd.sh --uninstall

Then open http://knowledge.localhost:7777. Logs: `~/Library/Logs/knowledge-map.log`. Restart after editing `config.json` or `vault-plugin.ts`: `launchctl kickstart -k gui/$(id -u)/com.knowledge-map`. If a vault shows 0 notes, give the `node` binary Full Disk Access (System Settings > Privacy & Security), then restart. If you upgrade Node with nvm, rerun the install script.

## Notes
- Read-only on your vaults by default. Set `"writable": true` on a vault in `config.json` to allow editing its markdown notes: saves are atomic, back up the previous version to `~/.knowledge-map/backups` first, and refuse to overwrite a file that changed on disk meanwhile. Open a note and press `e` (or the Edit button), Cmd+S to save. The editor is a live-preview rich editor (headings, bold, lists and links render as you type; the file stays plain markdown) with a formatting toolbar, Cmd+B/I/K, and `[[` suggests note names to link; Source mode gives the raw text. Export PDF prints a note via your browser's Save as PDF. The target button on the map turns on focus mode: every note you pick becomes the focus until Esc. The Rename button renames or moves a note inside its vault and updates the links that point to it (with a preview first; every changed note is backed up). The History button lists saved versions, shows what differs from the current file and restores one (restoring is itself backed up, so it can be undone). The Delete button in the note panel moves a note to your Trash.
- Resume cards: add `"projects": { "roots": ["~/Developer"] }` to `config.json` and every folder there with a `PLAN.md`, `TODO.md` or `WORKLOG.md` shows as a card (plan, latest worklog entry and its Next line, open TODOs, git branch) in Today and in the matching customer cockpit. Folders are matched to customers by name; add `"customers": { "acme": ["acme", "some-folder"] }` under `projects` to map others. These files are only read, never written, and are hidden in Safe mode.
- `"jiraBase": "https://<site>.atlassian.net/browse/"` turns ticket keys in the cockpit into links.
- MCP server for Claude Code (read-only, stdio, no network): `claude mcp add --scope user knowledge-map -- node /abs/path/mcp-server.ts --vaults "my-vault"`. Tools: `search`, `read_note`, `neighbors`, `find_path`, `list_customers`, `customer_brief`, `open_tasks`, `recent_changes`, `context_pack`. `--safe` limits it to notes marked public or internal; leave personal vaults out of `--vaults` unless you want them in every session.
- Weekly review reads `git log` of vaults that are git repos (read-only); other vaults fall back to file dates.
- Port 7777 is fixed (see AGENTS.md to change it).
- Not supported: `.canvas`, `.base`, PDF embeds, running Dataview queries.
- Keep this app private if your vaults hold sensitive material; the code is safe to share, your notes are not.
