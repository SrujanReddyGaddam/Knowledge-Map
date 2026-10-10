// Client for the guarded write API in vault-plugin.ts. The token is fetched once per page load (and again if the server restarted).
let tokenP: Promise<string> | null = null;
const fetchToken = () => (tokenP = fetch('/api/session', { headers: { 'X-KM': '1' } })
  .then(r => { if (!r.ok) throw new Error('session HTTP ' + r.status); return r.json(); })
  .then(j => j.token as string)
  .catch(e => { tokenP = null; throw e; }));

export type Reply = { status: number; json: any };
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
