import { useEffect, useRef, useState } from 'react';
import type { Note } from 'virtual:vault';

type Scene = NonNullable<Note['scene']>;

// Renders an Excalidraw scene to an inline SVG. The (large) Excalidraw library is only loaded the first time a drawing is shown.
export default function Drawing({ scene, dark }: { scene: Scene; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading');

  useEffect(() => {
    let off = false;
    setState('loading');
    (async () => {
      try {
        (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
        const { exportToSvg } = await import('@excalidraw/excalidraw');
        const svg = await exportToSvg({
          elements: scene.elements,
          appState: { exportBackground: false, exportWithDarkMode: dark, exportEmbedScene: false },
          files: scene.files || {},
          exportPadding: 18,
        });
        if (off) return;
        const w = Number(svg.getAttribute('width')) || 0;
        svg.removeAttribute('width'); svg.removeAttribute('height');
        svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
        if (w) svg.style.maxWidth = Math.max(w, 320) + 'px';
        ref.current?.replaceChildren(svg);
        setState('ok');
      } catch (e) {
        console.error('Excalidraw render failed', e);
        if (!off) setState('err');
      }
    })();
    return () => { off = true; };
  }, [scene, dark]);

  return (
    <div className="xl">
      {state === 'loading' && <div className="xl-msg">Rendering drawing...</div>}
      {state === 'err' && <div className="xl-msg">Could not render this drawing.</div>}
      {scene.elements.length === 0 && <div className="xl-msg">This drawing is empty.</div>}
      <div ref={ref} />
    </div>
  );
}
