#!/usr/bin/env node
// Creates a vault from starter-vault/, or adds the scaffold (rules, templates, agent skills) to an existing vault.
//
//   node scripts/new-vault.mjs <vault-path> [options]
//
//   --name <name>         display name (default: folder name)
//   --owner <name>        whose vault it is, used in the rules file (default: "the owner")
//   --adopt               the folder already has notes: add only the scaffold, never touch or overwrite existing files
//   --no-examples         new vault without the fictional acme example notes
//   --customers a,b       create projects/<slug>/<slug>.md customer hubs
//   --config              add the vault to config.json (created if missing)
//   --writable            with --config: let the app edit this vault (default read-only)
//   --dry-run             print what would happen, write nothing
//
// Existing files are never overwritten. In --adopt mode the rules go to README.md if there is none, else VAULT-RULES.md.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STARTER = path.join(APP, 'starter-vault');
const EXAMPLES = ['inbox/welcome.md', 'knowledge/retry-with-backoff.md', 'knowledge/confirm-the-data-shape-first.md', 'projects/acme/acme.md', 'projects/acme/demo/acme-demo.md', 'projects/acme/demo/2026-01-15-acme-demo-kickoff.md', 'people/jane-doe.md'];
const SCAFFOLD = ['CLAUDE.md', 'AGENTS.md', 'WORKLOG.md', 'index.md'];   // plus the rules file, _templates/ and .claude/skills/ (adopt mode copies only these)

const argv = process.argv.slice(2), flag = f => argv.includes(f), opt = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const target = argv.find((a, i) => !a.startsWith('--') && !['--name', '--owner', '--customers'].includes(argv[i - 1]));
if (!target) { console.error('usage: node scripts/new-vault.mjs <vault-path> [--name X] [--owner X] [--adopt] [--no-examples] [--customers a,b] [--config] [--writable] [--dry-run]'); process.exit(2); }
const vault = path.resolve(target.replace(/^~(?=$|\/)/, os.homedir()));
const adopt = flag('--adopt'), dry = flag('--dry-run'), examples = !flag('--no-examples') && !adopt;
const name = opt('--name') || path.basename(vault);
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
const customers = (opt('--customers') || '').split(',').map(s => slug(s)).filter(Boolean);
const port = Number(process.env.KM_PORT) || 7777;

// a folder counts as empty when it only holds Obsidian settings, git, or OS clutter
const exists = fs.existsSync(vault);
if (exists && !fs.statSync(vault).isDirectory()) { console.error(`not a folder: ${vault}`); process.exit(1); }
const content = exists ? fs.readdirSync(vault).filter(e => !['.obsidian', '.git', '.DS_Store', '.trash'].includes(e)) : [];
if (content.length && !adopt) { console.error(`${vault} already has files (${content.slice(0, 5).join(', ')}${content.length > 5 ? ', ...' : ''}).\nRerun with --adopt to add the scaffold next to your notes (nothing existing is changed).`); process.exit(1); }
if (!content.length && adopt) console.log('note: the folder is empty, --adopt only adds the scaffold (no example notes, no folders)');

const ownReadme = path.join(vault, 'README.md');   // a README.md that already holds these rules (an earlier run) is reused, any other README is kept and the rules go beside it
const rules = adopt && fs.existsSync(ownReadme) && !fs.readFileSync(ownReadme, 'utf8').includes('## Rules in one screen') ? 'VAULT-RULES.md' : 'README.md';
const vars = { VAULT_NAME: name, OWNER: opt('--owner') || 'the owner', DATE: new Date().toISOString().slice(0, 10), APP_DIR: APP, APP_URL: `http://localhost:${port}`, VAULT_PATH: vault, RULES: rules };
const fill = t => t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));   // lower-case {{title}}/{{date}} in templates are left for the app

const plan = [], skipped = [];
const add = (rel, text) => {
  const abs = path.join(vault, rel);
  if (fs.existsSync(abs)) { skipped.push(rel); return; }
  plan.push([rel, abs, text]);
};
const walk = (dir, cb) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); e.isDirectory() ? walk(p, cb) : cb(path.relative(STARTER, p).split(path.sep).join('/'), p); } };
walk(STARTER, (rel, p) => {
  const scaffold = rel === 'README.md' || SCAFFOLD.includes(rel) || rel.startsWith('_templates/') || rel.startsWith('.claude/skills/');
  if (adopt && !scaffold) return;
  if (!examples && EXAMPLES.includes(rel)) return;
  if (adopt && rel.endsWith('/.gitkeep')) return;
  const text = fs.readFileSync(p, 'utf8');
  add(rel === 'README.md' ? rules : rel, rel.endsWith('.md') ? fill(text) : text);
});
for (const c of customers) {
  const title = c.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  add(`projects/${c}/${c}.md`, `---\ntitle: ${title}\ntype: hub\nsummary: Customer hub for ${title}: projects, people and every note tagged customer ${c}.\nsensitivity: customer-confidential\ntags: [hub]\ncustomer: ${c}\nstatus: current\n---\n\n## Summary\nUp: [[index]]\n\n## Projects\n\n## People\n\n## All notes\n<!-- km:list customer=${c} group=type sort=updated -->\n<!-- km:end -->\n`);
}

console.log(`${dry ? '[dry run] ' : ''}${adopt ? 'Adding the scaffold to' : 'Creating'} ${vault}  (rules file: ${rules})`);
for (const [rel] of plan) console.log('  + ' + rel);
for (const rel of skipped) console.log('  = ' + rel + '  (exists, left alone)');
if (dry) process.exit(0);

for (const [, abs, text] of plan) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text, { flag: 'wx' }); }

// fill the generated lists in index.md and the hubs
try { execFileSync(process.execPath, [path.join(APP, 'scripts/build-indexes.ts'), vault], { stdio: 'inherit' }); }
catch { console.log(`lists: could not run the list builder (needs Node 22.18+); later run: node ${APP}/scripts/build-indexes.ts "${vault}"`); }

// git: a local safety net for new vaults (never a remote), skipped inside synced folders
const synced = /Mobile Documents|CloudStorage|Dropbox|OneDrive|Google Drive/i.test(vault);
if (!adopt && !synced && !fs.existsSync(path.join(vault, '.git'))) {
  try {
    execFileSync('git', ['init', '-q'], { cwd: vault });
    fs.writeFileSync(path.join(vault, '.gitignore'), '.obsidian/workspace*.json\n.trash/\n.DS_Store\n', { flag: 'wx' });
    execFileSync('git', ['add', '-A'], { cwd: vault });
    execFileSync('git', ['commit', '-q', '-m', 'New vault from the Knowledge Map starter'], { cwd: vault, stdio: 'ignore' });
    console.log('git: initialised with a first commit (local only)');
  } catch { console.log('git: repository created, first commit skipped (set git user.name and user.email, then commit)'); }
}

if (flag('--config')) {
  const cfgPath = process.env.KM_CONFIG ? path.resolve(process.env.KM_CONFIG) : path.join(APP, 'config.json');
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : { vaults: [] };
  cfg.vaults ||= [];
  if (cfg.vaults.some(v => path.resolve(v.path) === vault)) console.log(`config: ${vault} is already in ${path.basename(cfgPath)}`);
  else {
    if (cfg.vaults.some(v => v.name === name)) { console.error(`config: a vault named "${name}" already exists, rerun with --name`); process.exit(1); }
    cfg.vaults.push({ name, path: vault, exclude: [rules, 'CLAUDE.md', 'AGENTS.md', 'WORKLOG.md', '_templates/', '_meta/'], rootSection: 'General', writable: flag('--writable'), lint: true, sectionDepth: { projects: 2, knowledge: 2 } });
    const tmp = cfgPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n'); fs.renameSync(tmp, cfgPath);
    console.log(`config: added "${name}" to ${cfgPath} (restart the app to load it)`);
  }
}
if (skipped.includes('CLAUDE.md') && !fs.readFileSync(path.join(vault, 'CLAUDE.md'), 'utf8').includes('@' + rules)) console.log(`note: you already have a CLAUDE.md; add the line "@${rules}" to it so agents read the vault rules`);
console.log('done');
