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

/**
 * AccessForge (accessforge-skeleton task 16.11): the revival of the fictional
 * demonstration portal. Opening it skips the language picker; any other site
 * named in the address only shows the scope message and loads nothing.
 */
export const ACCESSFORGE_PATH = '/accessforge';
