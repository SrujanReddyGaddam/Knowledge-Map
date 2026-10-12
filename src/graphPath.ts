import type { Note } from 'virtual:vault';

// Shortest link path between two notes (links and backlinks both count, so direction does not matter). Plain BFS:
// every hop costs the same. Ties go to the neighbour that sorts first, so the same two notes always give the same path.
export function shortestPath(notes: Note[], from: string, to: string): string[] | null {
  if (from === to) return [from];
  const byId = new Map(notes.map(n => [n.id, n]));
  if (!byId.has(from) || !byId.has(to)) return null;
  const prev = new Map<string, string>([[from, '']]);
  let ring = [from];
  while (ring.length) {
    const next: string[] = [];
    for (const id of ring) {
      const n = byId.get(id)!;
      for (const o of [...new Set([...n.links, ...n.backlinks])].sort()) {
        if (prev.has(o) || !byId.has(o)) continue;
        prev.set(o, id);
        if (o === to) { const out = [to]; let c = id; while (c) { out.push(c); c = prev.get(c)!; } return out.reverse(); }
        next.push(o);
      }
    }
    ring = next;
  }
  return null;
}
