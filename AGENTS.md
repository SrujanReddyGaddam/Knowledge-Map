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
{ "vaults": [ { "name": "my-vault", "path": "/abs/path", "exclude": ["README.md"], "rootSection": "General" } ] }
```
`config.json` is git-ignored because it holds local paths. Only `config.example.json` is committed. Server restart is required after changing it.

## Layout
| File | Role |
|---|---|
| `vault-plugin.ts` | Vite plugin. Reads vaults into the virtual module `virtual:vault` (notes, edges, broken links, mtimes), watches for changes (700ms debounce then full reload), serves vault images at `/vault-assets/`, and exposes the only write path `POST /api/delete`. |
| `src/App.tsx` | State and layout: search, filters (vault/section/tag/focus), Dim/Hide mode, palettes, sound, keyboard shortcuts. |
| `src/Graph.tsx` | three.js scene, force simulation, camera, drag/pan/zoom, labels. Camera is saved to `sessionStorage` so reloads keep the view. |
| `src/Panel.tsx` | Side panel: markdown render, wikilinks, callouts, contents list, backlinks with context, hover preview cards, Excalidraw embeds, actions. |
| `src/Browse.tsx` | Left drawer: Recent, Tree, Health (broken links and orphans). |
| `src/search.ts` | Search index and ranking; operators `tag:` `vault:` `path:` `"phrase"` `-exclude`. |
| `src/palettes.ts`, `src/sound.ts` | Color palettes (tinted neutrals + one accent) and synthesized click sounds. |
| `scripts/install-launchd.sh` | macOS always-on installer. |

Data contract (`src/vault.d.ts`): a note has `id, vault, path, abs, section, title, tags, status, source, fetched, summary, body, links, backlinks, mtime`, optional `kind: 'drawing'` and `scene`. Note ids are the bare filename when unique, else `<vault>/<path>`. Wikilinks resolve within the same vault first, then across vaults.

## Conventions and gotchas
- **Port 7777 is hard-coded** in three places: `vite.config.ts` (`port`, `strictPort`), the Origin check in `vault-plugin.ts` (`/api/delete`), and the launchd script. To change it, update all three.
- **Never commit** `config.json`, vault content, screenshots of real vaults, or anything from a user's notes. Vaults can contain customer or personal data. Do not paste note content into issues, commits or logs.
- **Keep it read-only.** Do not add write paths (editing, renaming) without: a backup or git history of the vault, a secret token plus Origin check on the endpoint (localhost servers are reachable from any web page), atomic writes with mtime conflict detection, and no silent reformatting of frontmatter or hard-wrapping prose. The delete endpoint takes a note id, never a path, and checks the file is inside a configured vault.
- Excluded files never reach the browser. When a user names a secret file, add it to `exclude` and confirm the note count dropped.
- macOS: background processes may be blocked from `~/Documents`, `~/Desktop` or iCloud folders. Symptom: vault shows 0 notes or `vault not readable` in the log. Fix: grant the `node` binary Full Disk Access, then restart. iCloud notes not yet downloaded appear as `.icloud` stubs and are skipped.
- Supported content: markdown with frontmatter (`title`, `tags`, `summary`, `type`, `status`, `related`, `source`), wikilinks, `![[image]]`, `[x](./y.md)` links, callouts, Excalidraw (`*.excalidraw.md` and `*.excalidraw`). Not supported: `.canvas`, `.base`, PDF embeds, executing Dataview (the block is shown with a "not run" label).
- Hash links (`#note-id`) are read once at load; changing only the hash in a running page does not open the note.
- `window.__km` is a debug hook exposing graph nodes for browser tests.

## Checks
- `npx tsc --noEmit` (or `npm run build`, which also type-checks) must pass.
- There is no test suite. UI changes are verified by loading the page in a real browser (headless Chrome needs `--enable-unsafe-swiftshader` for WebGL) and looking at a screenshot.
- URL params for reproducible screenshots: `?theme=light|dark` `?palette=` `?zoom=` `?q=` `?vault=A,B` `?mode=dim|hide` `?filter` `?info` `?sound`, and `#<note-id>`.
