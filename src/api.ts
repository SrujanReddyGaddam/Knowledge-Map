// Client for the guarded write API in vault-plugin.ts. The token is fetched once per page load (and again if the server restarted).
let tokenP: Promise<string> | null = null;
const fetchToken = () => (tokenP = fetch('/api/session', { headers: { 'X-KM': '1' } })
  .then(r => { if (!r.ok) throw new Error('session HTTP ' + r.status); return r.json(); })
  .then(j => j.token as string)
  .catch(e => { tokenP = null; throw e; }));

export type Reply = { status: number; json: any };
// while n > 0 our own writes do not reload the page (a bulk import reloads once at the end)
export const reloadHold = { n: 0 };
async function call(path: string, body?: object): Promise<Reply> {
  for (let attempt = 0; ; attempt++) {
    const token = await (tokenP ?? fetchToken());
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-KM': '1', 'X-KM-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await r.json().catch(() => ({}));
    if (r.status === 403 && json.error === 'bad token' && attempt === 0) { tokenP = null; continue; }   // server restarted: new token
    return { status: r.status, json };
  }
}
export const rawNote = (id: string) => call('/api/raw?id=' + encodeURIComponent(id));
export const saveNote = (id: string, text: string, baseHash: string, force = false) => call('/api/save', { id, text, baseHash, force });
export const trashNote = (id: string) => call('/api/delete', { id });
export type Version = { name: string; time: string; size: number };
export const historyOf = (id: string) => call('/api/history?id=' + encodeURIComponent(id));
export const versionOf = (id: string, name: string) => call('/api/version?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name));
export type RenamePlan = {
  from: string; to: string; planHash: string; links: number; selfCount: number; blocked: string[]; extraRefs: number;
  updates: { id: string; title: string; path: string; vault: string; count: number }[];
  readOnly: { id: string; title: string; vault: string; path: string; count: number }[];
};
export const planRename = (id: string, to: string) => call('/api/rename', { id, to, dryRun: true });
export const renameNote = (id: string, to: string, planHash: string, ack: boolean) => call('/api/rename', { id, to, planHash, ack });
export const listTemplates = (vault: string) => call('/api/templates?vault=' + encodeURIComponent(vault));
export const createNote = (vault: string, path: string, text: string) => call('/api/create', { vault, path, text });
export const appendLine = (vault: string, path: string, heading: string, line: string, init?: string) => call('/api/append', { vault, path, heading, line, init });
export const attachImage = (id: string, ext: string, data: string) => call('/api/attach', { id, ext, data });
export const listProjects = () => call('/api/projects');
export type Commit = { hash: string; date: string; subject: string; files: { status: 'A' | 'M' | 'D'; path: string }[] };
export const gitLog = (vault: string, since: string, until: string) => call(`/api/gitlog?vault=${encodeURIComponent(vault)}&since=${since}&until=${until}`);
