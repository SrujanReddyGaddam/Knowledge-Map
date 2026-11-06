// Graphics quality: machines without a graphics card (virtual desktops: SwiftShader, Microsoft Basic Render Driver, llvmpipe)
// render WebGL on the CPU, so they draw at 1x resolution without antialiasing. Detected once per page load, in the browser.
// Override: ?lowgfx=1 or ?lowgfx=0 forces a mode and is remembered (localStorage lowgfx); a bare ?lowgfx goes back to auto.
function detectSoftware(): boolean {
  try {
    const c = document.createElement('canvas');
    // Chrome refuses a context with this flag when it would have to render in software
    const strict = c.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!strict) return true;
    const ext = strict.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? strict.getParameter(ext.UNMASKED_RENDERER_WEBGL) : strict.getParameter(strict.RENDERER));
    strict.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|basic render|llvmpipe|softpipe|software/i.test(name);
  } catch { return false; }
}

function decide(): boolean {
  let forced: string | null = null;
  try {
    const p = new URLSearchParams(location.search);
    if (p.has('lowgfx')) {
      const v = p.get('lowgfx');
      if (v === '1' || v === '0') localStorage.setItem('lowgfx', v); else localStorage.removeItem('lowgfx');
    }
    forced = localStorage.getItem('lowgfx');
  } catch {}
  if (forced === '1') return true;
  if (forced === '0') return false;
  return detectSoftware();
}

export const LOW_GFX = decide();
/** renderer pixel ratio; point sizes are in drawing-buffer pixels, so scale them by this too */
export const PIXEL_RATIO = LOW_GFX ? 1 : Math.min(devicePixelRatio || 1, 2);
try { document.documentElement.dataset.gfx = LOW_GFX ? 'low' : 'full'; } catch {}   // for browser tests and a quick look in devtools
