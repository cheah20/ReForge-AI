/**
 * src/shared/app-paths.ts
 *
 * In-app paths that other modules link to. The Worker serves every non-API
 * path with the single-page app, so these need no Worker route.
 */

/**
 * "Try a sample form" (formbridge-pdf task 28.5): opens FormBridge with the
 * synthetic clinic registration form loaded and every field empty. AccessForge
 * links here from its confirmation screens. Same-origin, no query string.
 */
export const SAMPLE_FORM_PATH = '/forms/sample';
