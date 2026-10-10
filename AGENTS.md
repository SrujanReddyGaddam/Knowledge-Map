# AGENTS.md: Knowledge Map

Instructions for coding agents (Claude Code, Codex, Cursor, etc.) working in this repo, including when a user says "set this up for my vault".

## What this is
A local web app that shows one or more Obsidian vaults (folders of markdown notes with `[[wikilinks]]`) as an interactive 3D map, with a side panel that renders the selected note. It is read-only on the vaults, with one exception: the note Delete button moves a file to the OS Trash. Nothing is uploaded anywhere; all data stays on the user's machine.

Stack: Vite + React + TypeScript, three.js with d3-force-3d (graph), gsap, marked (markdown), @excalidraw/excalidraw (drawings, lazy loaded), WebAudio (click sounds).

## Setting it up for a user (do this when asked to "set it up")
Prerequisites: Node `^20.19.0 || >=22.12.0` and npm. Check with `node -v`.

Ask the user these questions (use sensible defaults if they say "you decide", and tell them which calls you made):
1. **Vault path(s):** absolute path to each Obsidian vault folder (the folder that contains `.obsidian/`). One or several.
2. **Names:** display name per vault (default: folder name).
3. **Exclude:** files to leave out, relative to the vault root. Always ask about secrets (tokens, `.env`-like notes, credentials) and meta files like `README.md`. Paths must match exactly, e.g. `"exclude": ["README.md", "private/keys.md"]`.
4. **rootSection:** label for notes sitting in the vault root (default `General`). Top-level folders become "sections" in the map.
5. **How to run:** (a) on demand with `npm run dev`, or (b) always-on at login. Always-on is macOS only (launchd), see below. On Linux/Windows suggest a systemd unit / Task Scheduler running `node node_modules/vite/bin/vite.js --port 7777` from the repo root, or just on demand.
6. **Look and feel (optional):** palette (`paper`, `sage` default, `clay`, `ocean`, `dusk`; users can also switch in the UI), sound off by default.

Then:
```
cp config.example.json config.json      # never commit config.json
# edit config.json from the answers above
npm install
npm run dev                              # http://localhost:7777  (also http://knowledge.localhost:7777)
```
Always-on on macOS: `scripts/install-launchd.sh` (add `--label com.<name>.knowledge-map` to choose the service name, `--print` to preview, `--uninstall` to remove). It uses the `node` on the current PATH, so run it from a shell where `node -v` shows the version the user wants. Restart after editing `config.json` or `vault-plugin.ts`:
`launchctl kickstart -k gui/$(id -u)/<label>`. Logs: `~/Library/Logs/knowledge-map.log`.

Verify before telling the user it works: server returns 200, the startup log line `[vault] <names>: N notes, M links, K unresolved` shows the expected counts (0 notes means a wrong path or a macOS permission problem), and open the page (screenshot if you can drive a browser).

## config.json
```json
{ "vaults": [ { "name": "my-vault", "path": "/abs/path", "exclude": ["README.md"], "rootSection": "General", "writable": false } ] }
```
`writable` (default `false`) lets the app edit that vault's markdown notes. Ask the user per vault; leave iCloud-synced vaults and anything sensitive read-only unless they opt in.

`config.json` is git-ignored because it holds local paths. Only `config.example.json` is committed. Server restart is required after changing it.

## Layout
| File | Role |
|---|---|
| `vault-plugin.ts` | Vite plugin. Reads vaults into the virtual module `virtual:vault` (notes, edges, broken links, mtimes), watches for changes (700ms debounce then full reload), serves vault images at `/vault-assets/`, and exposes the only write path `POST /api/delete`. |
| `src/App.tsx` | State and layout: search, filters (vault/section/tag/focus), Dim/Hide mode, palettes, sound, keyboard shortcuts. |
| `src/Graph.tsx` | three.js scene, force simulation, camera, drag/pan/zoom, labels. Camera is saved to `sessionStorage` so reloads keep the view. |
| `src/Panel.tsx` | Side panel: markdown render, wikilinks, callouts, contents list, backlinks with context, hover preview cards, Excalidraw embeds, actions. |
| `src/Browse.tsx` | Left drawer: New (updated since last seen), Recent, Tree, Health (broken links and orphans). |
| `src/RichText.tsx`, `src/linkSuggest.ts` | CodeMirror 6 live-preview markdown editor (syntax marks hidden off the cursor line, exact text kept, toolbar and Cmd+B/I/K, `[[` autocomplete) and the note-name suggester. |
| `src/Editor.tsx`, `src/History.tsx`, `src/diff.ts`, `src/api.ts` | In-panel markdown editor (Edit button or `e`, Cmd+S, Esc); History view (saved versions, line diff against the current file, restore); client for the write API (token handling). |
| `src/Rename.tsx`, `rename-links.ts` | Rename/Move view (live dry-run preview, apply) and the pure link rewriter used by `/api/rename`. |
| `src/seen.ts` | Per-browser record of which note versions were seen (localStorage) to flag updated notes. |
| `src/search.ts` | Search index and ranking; operators `tag:` `vault:` `path:` `"phrase"` `-exclude`. |
| `src/palettes.ts`, `src/sound.ts` | Color palettes (tinted neutrals + one accent) and synthesized click sounds. |
| `scripts/install-launchd.sh` | macOS always-on installer. |

Data contract (`src/vault.d.ts`): a note has `id, vault, path, abs, section, title, tags, status, source, fetched, summary, body, links, backlinks, mtime`, optional `kind: 'drawing'` and `scene`. Note ids are the bare filename when unique, else `<vault>/<path>`. Wikilinks resolve within the same vault first, then across vaults.

## Conventions and gotchas
- **Port:** defaults to 7777 and is read from env `KM_PORT` by both `vite.config.ts` and `vault-plugin.ts` (Host and Origin allowlists). The launchd script still passes `--port 7777`; if you change the port also set `KM_PORT` there. Other env: `KM_CONFIG` (alternate config file) and `KM_BACKUP_DIR` (default `~/.knowledge-map/backups`). Use all three to run a throwaway instance for tests beside a real one.
- **Never commit** `config.json`, vault content, screenshots of real vaults, or anything from a user's notes. Vaults can contain customer or personal data. Do not paste note content into issues, commits or logs.
- **Write paths are guarded; keep them that way.** `vault-plugin.ts` exposes `GET /api/session` (per-start token), `GET /api/raw?id=` (exact file text + sha256), `POST /api/save`, `GET /api/history?id=` and `GET /api/version?id=&name=` (saved versions; the name must match the timestamp pattern and is never used as a path), `POST /api/rename` (rename or move inside one vault: `dryRun` returns a plan with a hash, applying must send that hash back; backs up every touched file, rewrites `[[links]]`, `![[embeds]]` and relative `.md` links in other writable notes atomically, skips code blocks, rolls back on failure, moves the note's history along, refuses name clashes; links in read-only vaults are only warned about and need an explicit ack), `POST /api/delete`. Restoring a version is just a normal save of the old text, so the current text is backed up first. Every call goes through `guard()`: Host allowlist (DNS rebinding), `X-KM: 1` header (forces a CORS preflight we never answer), and for writes our own Origin plus the token. Save works on the raw file text (frontmatter and CRLF untouched), returns 409 with the current text if the file changed since load (hash compare), writes a backup first to `KM_BACKUP_DIR/<vault>/<path>.history/<timestamp>.md` (keeps 50 versions / 90 days, always the newest), then writes atomically (dotfile temp in the same folder, fsync, rename). Ids map to files server-side and must resolve inside a `writable` vault (realpath checked, so symlinks cannot escape); only `.md`, never drawings, max 2 MB. Do not loosen any of this, and test any new write path on a throwaway instance (scratch vault, `KM_PORT`/`KM_CONFIG`/`KM_BACKUP_DIR`), never on the user's real vaults.
- **Editor behavior to preserve:** it edits the exact file text; CRLF files are shown as LF and converted back on save (browsers normalize textarea newlines), files with mixed endings are refused; own saves do not reload the page mid-edit (server sends `km:self-write`, the page refreshes when the editor closes) while external changes still reload; an unsaved draft is kept in sessionStorage (`kmDraft`) and reopens after a reload, with a conflict banner if the file changed on disk meanwhile; leaving the note or closing the tab with unsaved changes asks first; the default editor is the rich one (`RichText.tsx`: it only styles and hides syntax marks, the document is always the exact markdown, so saving never reformats; "Source mode" in the toolbar switches to a plain textarea, remembered in localStorage `editorMode`); typing `[[` opens a note-name suggestion list (arrows, Enter/Tab accept, first Esc only closes the list) and inserts the bare file name plus `]]`. Key handlers in the editor must stop Esc from reaching the page-level handler in `App.tsx`.
- Excluded files never reach the browser. When a user names a secret file, add it to `exclude` and confirm the note count dropped.
- macOS: background processes may be blocked from `~/Documents`, `~/Desktop` or iCloud folders. Symptom: vault shows 0 notes or `vault not readable` in the log. Fix: grant the `node` binary Full Disk Access, then restart. iCloud notes not yet downloaded appear as `.icloud` stubs and are skipped.
- Supported content: markdown with frontmatter (`title`, `tags`, `summary`, `type`, `status`, `related`, `source`), wikilinks, `![[image]]`, `[x](./y.md)` links, callouts, Excalidraw (`*.excalidraw.md` and `*.excalidraw`). Not supported: `.canvas`, `.base`, PDF embeds, executing Dataview (the block is shown with a "not run" label).
- Hash links (`#note-id`) are read once at load; changing only the hash in a running page does not open the note.
- `window.__km` is a debug hook exposing graph nodes for browser tests.

## Checks
- Focus mode (canvas button, target icon): while on, every selection (map, search, Browse, links) becomes the focus; Esc turns it off and clears the focus. Export PDF uses the browser print dialog with `@media print` rules in `styles.css` that show only the note body on white.
- `npx tsc --noEmit` (or `npm run build`, which also type-checks) must pass.
- There is no test suite. UI changes are verified by loading the page in a real browser (headless Chrome needs `--enable-unsafe-swiftshader` for WebGL) and looking at a screenshot.
- URL params for reproducible screenshots: `?theme=light|dark` `?palette=` `?zoom=` `?q=` `?vault=A,B` `?mode=dim|hide` `?filter` `?info` `?sound`, and `#<note-id>`.
