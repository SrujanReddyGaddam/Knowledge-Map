// Minimal YAML frontmatter reader shared by the Vite plugin and scripts/build-indexes.ts (flat keys, inline [a, b] lists and "- item" lists).
// No imports on purpose, so Node can run the scripts directly (type stripping).
export function parseFrontmatter(raw: string) {
  if (!raw.startsWith('---\n')) return { fm: {} as Record<string, any>, body: raw, hasFm: false };
  const end = raw.indexOf('\n---', 4);
  if (end < 0) return { fm: {} as Record<string, any>, body: raw, hasFm: false };
  const block = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n/, '');
  const fm: Record<string, any> = {};
  let listKey: string | null = null;
  for (const line of block.split('\n')) {
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && listKey) { fm[listKey].push(li[1].trim().replace(/^["']|["']$/g, '')); continue; }
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (v === '') { fm[k] = []; listKey = k; continue; }
    listKey = null;
    if (v.startsWith('[') && v.endsWith(']')) fm[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else fm[k] = v.replace(/^["']|["']$/g, '');
  }
  return { fm, body, hasFm: true };
}
