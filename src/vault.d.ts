declare module 'virtual:vault' {
  export type Note = {
    id: string; vault: string; path: string; abs: string; section: string; title: string; tags: string[]; status: string;
    source: string; fetched: string; summary: string; body: string; links: string[]; backlinks: string[]; mtime: number; writable: boolean;
    type: string; customer: string; project: string; sensitivity: string; meta: Record<string, string>;
    kind?: 'drawing'; scene?: { elements: any[]; appState?: { viewBackgroundColor?: string }; files?: any };
  };
  const data: { vaultName: string; vaults: string[]; lintVaults: string[]; writableVaults: string[]; generated: string; sections: string[]; notes: Note[]; edges: [string, string][]; broken: string[]; brokenLinks: { from: string; target: string }[];
    jiraBase: string; hasProjects: boolean; projectCustomers: Record<string, string[]> };
  export default data;
}
