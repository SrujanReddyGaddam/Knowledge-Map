import { useEffect, useState } from 'react';
import vault, { safeMode } from './data';
import { gitLog, type Commit } from './api';
import { activityFrom, type Activity } from './realTime';
export { realTime, bulkOnly, type Activity } from './realTime';

// git history of every vault for the last 120 days, fetched once per page load (not in Safe mode)
let cache: Promise<Activity | null> | null = null;
export function loadActivity() {
  if (safeMode) return Promise.resolve(null);
  const until = new Date(Date.now() + 864e5).toISOString().slice(0, 10), since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  return (cache ??= Promise.all(vault.vaults.map(v => gitLog(v, since, until).then(x => [v, x.status === 200 && x.json.git ? x.json.commits as Commit[] : []] as const)))
    .then(rs => activityFrom(new Map(rs)))
    .catch(() => null));
}
export function useActivity() {
  const [a, setA] = useState<Activity | null>(null);
  useEffect(() => { let live = true; loadActivity().then(x => { if (live) setA(x); }); return () => { live = false; }; }, []);
  return a;
}
