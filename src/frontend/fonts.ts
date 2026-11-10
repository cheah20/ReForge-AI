/**
 * src/frontend/fonts.ts
 *
 * Lazy loading of UI fonts per script. Fonts are self-hosted (no third-party
 * font CDN, so no visitor IP address is shared with another service).
 *
 * Only the Latin Noto Sans file is bundled today. Other scripts fall back to
 * the system font until their Noto files are added under public/fonts/; the
 * table below is the one place to register them.
 */

/** Self-hosted font files by family name. */
export const UI_FONT_FILES: Readonly<Record<string, string>> = {
  'Noto Sans': '/fonts/NotoSans-Regular.ttf',
};

const loading = new Map<string, Promise<boolean>>();

/**
 * Load a UI font family once. Resolves true when the font is ready, false when
 * no file is registered for it or the browser cannot load fonts this way.
 */
export function loadUiFont(family: string): Promise<boolean> {
  const cached = loading.get(family);
  if (cached) return cached;

  const url = UI_FONT_FILES[family];
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!url || typeof FontFace === 'undefined' || !fonts) {
    const none = Promise.resolve(false);
    loading.set(family, none);
    return none;
  }

  const promise = new FontFace(family, `url(${url})`, { display: 'swap' })
    .load()
    .then((face) => {
      fonts.add(face);
      return true;
    })
    .catch(() => false);
  loading.set(family, promise);
  return promise;
}
