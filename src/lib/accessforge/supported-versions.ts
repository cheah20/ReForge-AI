/**
 * src/lib/accessforge/supported-versions.ts
 *
 * accessforge-skeleton task 5.9 (design Question 1): the Page_Versions the
 * revival was built and tested against. A registration page with any other
 * version is not revived in Slice 1 (Requirement 3.8). A deliberate template
 * change updates this file, the generated templates, the table in design.md
 * and any precomputed page plans together; a unit test checks they agree.
 */

export const SUPPORTED_PAGE_VERSIONS = {
  home: 'bb3e7f080dcfd5a27e573fc5925b17eabbb0f1f6dfe71e71aa1a1c5165905e50',
  register: 'a3250afede9c6413c0a3a170ae4baef4aa6a34681d16ef723a0652cb1e0733d9',
} as const;
