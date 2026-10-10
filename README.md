# Knowledge Map

Local, read-only 3D map of Obsidian vaults. Vaults are listed in `config.json`.

**Open:** http://knowledge.localhost:7777  (or http://localhost:7777)

## Always-on service (macOS launchd)
Runs at login and restarts itself if it crashes. Logs: `~/Library/Logs/knowledge-map.log`.
Service file: `~/Library/LaunchAgents/com.srujan.knowledge-map.plist`

    launchctl print gui/$(id -u)/com.srujan.knowledge-map | grep -E "state|pid"   # status
    launchctl kickstart -k gui/$(id -u)/com.srujan.knowledge-map                   # restart (after editing config.json)
    launchctl bootout   gui/$(id -u)/com.srujan.knowledge-map                      # stop and disable
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.srujan.knowledge-map.plist   # enable again

Edits to notes in the vaults reload the page automatically. Edits to `config.json` or the plugin need a restart (kickstart above).
If a vault ever shows 0 notes, macOS may be blocking background access to Documents/Desktop: add the node binary
(`~/.nvm/versions/node/v24.18.0/bin/node`) to System Settings > Privacy & Security > Full Disk Access, then restart the service.
If you upgrade Node with nvm, update the node path inside the plist.

## Develop manually
Stop the service first (port 7777 is fixed), then `npm run dev`.


## Setup on a fresh clone

`cp config.example.json config.json`, point `path` at your Obsidian vault(s), then `npm install && npm run dev`. The app only reads your vaults from disk; no vault content is stored in this repo. `config.json`, `PLAN.md` and `TODO.md` are git-ignored on purpose.
