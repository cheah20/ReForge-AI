// Minimal declaration for the one jsdom class the cache script uses (no @types/jsdom in this repo).
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    window: { document: Document };
  }
}
