import { useEffect, useState } from 'react';
import vault, { safeMode } from './data';
import { listProjects } from './api';

// Resume cards data: the code projects' tracking files, read by the server on request (never in Safe mode: these files have no sensitivity).
export type Project = {
  name: string; path: string; title: string; status: string;
  plan: { title: string; status: string; open: string[]; done: number; total: number } | null;
  last: { date: string; title: string; next: string } | null;
  todo: number; branch: string; mtime: number; files: string[]; planText: string; logText: string;
};
export const projectsOn = vault.hasProjects && !safeMode;

let cache: Promise<Project[]> | null = null;
const load = (fresh = false) => {
  if (!projectsOn) return Promise.resolve([] as Project[]);
  if (fresh || !cache) cache = listProjects().then(r => { if (r.status !== 200) throw new Error(r.json.error || 'HTTP ' + r.status); return r.json.projects as Project[]; }).catch(e => { cache = null; throw e; });
  return cache;
};
export function useProjects() {
  const [list, setList] = useState<Project[] | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; load(n > 0).then(p => live && setList(p), e => live && setErr(String(e.message || e))); return () => { live = false; }; }, [n]);
  return { list, err, refresh: () => { setErr(''); setN(x => x + 1); } };
}

// which customer a project belongs to: config "projects.customers" ({"acme": ["acme", "acme-portal"]}) first,
// else the first word of the customer slug found in the folder or branch name (acme-corp -> "acme")
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function customerOf(p: Project, customers: string[]): string {
  const hay = squash(p.name) + ' ' + squash(p.branch);
  for (const [c, words] of Object.entries(vault.projectCustomers)) if (words.some(w => squash(w) && hay.includes(squash(w)))) return c;
  for (const c of customers) { const w = squash(c.split('-')[0]); if (w.length >= 3 && hay.includes(w)) return c; }
  return '';
}
