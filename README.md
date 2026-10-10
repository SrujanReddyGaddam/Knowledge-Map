# Knowledge Map

A local, 3D interactive map of your Obsidian vaults. Notes are spheres, links are flowing lines, and a side panel renders the selected note. It reads your vaults straight from disk; nothing is uploaded and no vault content lives in this repo.

Features: search with operators, filters (vault, section, tag), local graph focus, Browse drawer (recent, tree, health), backlinks with context, callouts and contents list, hover previews, Excalidraw drawings, 5 color palettes with light/dark, optional click sounds.

## Quick start
Needs Node `^20.19.0 || >=22.12.0`.

    git clone https://github.com/SrujanReddyGaddam/Knowledge-Map.git
    cd Knowledge-Map
    cp config.example.json config.json     # then set "path" to your vault folder(s)
    npm install
    npm run dev                             # http://localhost:7777

`config.json` accepts several vaults and a per-vault `exclude` list (put secrets there). It is git-ignored. Restart the server after changing it.

## Let a coding agent set it up
Point your coding agent (Claude Code, Codex, Cursor, ...) at this repo and say, for example: "Set up Knowledge Map for my vault at ~/Documents/MyVault and keep it running at login." The agent reads [AGENTS.md](AGENTS.md), asks you for vault paths, files to exclude and how you want to run it, then configures and verifies it.

## Always-on (macOS)
    scripts/install-launchd.sh              # start at login, restart on crash
    scripts/install-launchd.sh --print      # preview the service file
    scripts/install-launchd.sh --uninstall

Then open http://knowledge.localhost:7777. Logs: `~/Library/Logs/knowledge-map.log`. Restart after editing `config.json` or `vault-plugin.ts`: `launchctl kickstart -k gui/$(id -u)/com.knowledge-map`. If a vault shows 0 notes, give the `node` binary Full Disk Access (System Settings > Privacy & Security), then restart. If you upgrade Node with nvm, rerun the install script.

## Notes
- Read-only on your vaults by default. Set `"writable": true` on a vault in `config.json` to allow editing its markdown notes: saves are atomic, back up the previous version to `~/.knowledge-map/backups` first, and refuse to overwrite a file that changed on disk meanwhile. Open a note and press `e` (or the Edit button), Cmd+S to save. Typing `[[` suggests note names to link. The Rename button renames or moves a note inside its vault and updates the links that point to it (with a preview first; every changed note is backed up). The History button lists saved versions, shows what differs from the current file and restores one (restoring is itself backed up, so it can be undone). The Delete button in the note panel moves a note to your Trash.
- Port 7777 is fixed (see AGENTS.md to change it).
- Not supported: `.canvas`, `.base`, PDF embeds, running Dataview queries.
- Keep this app private if your vaults hold sensitive material; the code is safe to share, your notes are not.
