/**
 * src/lib/legacy-build/templates.ts
 *
 * The legacy portal pages as h() trees (accessforge-skeleton task 4.3, design
 * "Templates and content" and "Reproducing the legacy traits"). Build and test
 * only. Every visible string comes from the Malay content file; links point
 * only to Allow_List GET paths and, on the confirmation page, SAMPLE_FORM_PATH.
 *
 * The legacy traits are deliberate: table layout, unlabelled inputs with the
 * abbreviated label in the neighbouring cell, a free-text date box with only a
 * format abbreviation, the consent explanation in the next row with no
 * association, and reset right after submit.
 */

import { SAMPLE_FORM_PATH } from '../../shared/app-paths.js';
import { LEGACY_FORM_ACTION } from '../accessforge/allow-list.js';
import { LEGACY_FORM } from '../../worker/legacy/form-spec.js';
import { c, type ContentKey } from './content.js';
import { h, slot, type Node } from './html.js';

export type TemplateName = 'home' | 'register' | 'confirmation' | 'error' | 'notFound';
export type PageMeta = 'home' | 'register' | 'confirmation' | 'error' | 'not-found';

const STYLESHEET = '/legacy-assets/portal.css';

function head(page: PageMeta, titleKey: ContentKey, versioned: boolean): Node {
  return h(
    'head',
    {},
    h('meta', { charset: 'utf-8' }),
    h('meta', { name: 'portal-page', content: page }),
    ...(versioned ? [h('meta', { name: 'portal-page-version', content: '' })] : []),
    h('title', {}, c(titleKey)),
    h('link', { rel: 'stylesheet', href: STYLESHEET }),
  );
}

/** First visible element of every document (Requirement 1.2). */
function banner(): Node {
  return h('div', { class: 'banner' }, h('span', {}, c('banner.ms')), h('span', {}, c('banner.en')));
}

/** Five entries; the register link is nested in the last ("others") entry (Requirement 1.4). */
function menu(): Node {
  return h(
    'ul',
    { class: 'menu' },
    h('li', {}, h('a', { href: '/legacy/' }, c('menu.home'))),
    h('li', {}, c('menu.about')),
    h('li', {}, c('menu.services')),
    h('li', {}, c('menu.notices')),
    h(
      'li',
      { class: 'others' },
      c('menu.others'),
      h('ul', { class: 'submenu' }, h('li', {}, h('a', { href: '/legacy/register' }, c('menu.register')))),
    ),
  );
}

function layout(page: PageMeta, titleKey: ContentKey, versioned: boolean, ...content: Node[]): Node {
  return h(
    'html',
    { lang: 'ms' },
    head(page, titleKey, versioned),
    h(
      'body',
      {},
      banner(),
      h(
        'table',
        { class: 'page', width: '760' },
        h(
          'tbody',
          {},
          h('tr', {}, h('td', { class: 'titlebar' }, c('portal.name'))),
          h('tr', {}, h('td', { class: 'menubar' }, menu())),
          h('tr', {}, h('td', { class: 'content' }, ...content)),
          h('tr', {}, h('td', { class: 'footer' }, c('footer.text'))),
        ),
      ),
    ),
  );
}

export function homePage(): Node {
  return layout('home', 'page.title.home', true, h('p', {}, c('home.welcome')), h('p', {}, c('home.hours')), h('p', {}, c('home.notice')));
}

const field = (name: string) => LEGACY_FORM.fields.find((f) => f.name === name)!;
const maxlength = (name: string) => {
  const f = field(name);
  return 'maxLength' in f ? String(f.maxLength) : '';
};

/** A row with the abbreviated label in the neighbouring cell and the control(s) beside it. */
function row(labelKey: ContentKey, ...controls: Array<Node | string>): Node {
  return h('tr', {}, h('td', { class: 'label' }, c(labelKey)), h('td', { class: 'field' }, ...controls));
}

function textInput(name: string): Node {
  return h('input', { type: 'text', name, maxlength: maxlength(name), required: 'required' });
}

export function registerPage(): Node {
  const tujuan = field('tujuan');
  const optionKey = (v: string): ContentKey => (v === '' ? 'option.empty' : (`option.${v}` as ContentKey));
  const form = h(
    'form',
    { action: LEGACY_FORM_ACTION, method: 'post', 'accept-charset': 'utf-8' },
    h(
      'table',
      { class: 'form' },
      h(
        'tbody',
        {},
        row('field.nama.label', textInput('nama')),
        row('field.nokp.label', textInput('nokp')),
        row('field.tlahir.label', textInput('tlahir'), ' ', h('span', { class: 'hint' }, c('field.tlahir.hint'))),
        row(
          'field.jantina.label',
          h('input', { type: 'radio', name: 'jantina', value: 'L', required: 'required' }),
          c('option.L'),
          ' ',
          h('input', { type: 'radio', name: 'jantina', value: 'P', required: 'required' }),
          c('option.P'),
        ),
        row('field.tel.label', textInput('tel')),
        row('field.poskod.label', textInput('poskod')),
        row(
          'field.tujuan.label',
          h(
            'select',
            { name: 'tujuan', required: 'required' },
            ...('values' in tujuan ? tujuan.values : []).map((v) => h('option', { value: v }, c(optionKey(v)))),
          ),
        ),
        row('field.akuan.label', h('input', { type: 'checkbox', name: 'akuan', value: 'YA', required: 'required' })),
        // The consent purpose sits in the next row, in small print, with no association and no control (decision F).
        h('tr', {}, h('td', { class: 'label' }), h('td', { class: 'field' }, h('small', { class: 'consent' }, c('consent.explanation')))),
        h(
          'tr',
          {},
          h('td', { class: 'label' }),
          h('td', { class: 'field' }, h('input', { type: 'submit', value: c('button.submit') }), h('input', { type: 'reset', value: c('button.reset') })),
        ),
      ),
    ),
  );
  return layout('register', 'page.title.register', true, h('h1', {}, c('register.heading')), h('p', {}, c('register.intro')), form);
}

export function confirmationPage(): Node {
  return layout(
    'confirmation',
    'page.title.confirmation',
    false,
    h('h1', {}, c('confirm.heading')),
    h('p', {}, c('confirm.received')),
    h('p', {}, c('confirm.notAppointment')),
    h('p', {}, c('confirm.summaryHeading')),
    h('table', { class: 'ringkasan', id: 'ringkasan-diterima' }, h('tbody', {}, slot('summaryRows'))),
    h('p', { id: 'no-rujukan' }, c('confirm.referenceLabel'), ' ', h('b', { id: 'rujukan' }, slot('reference'))),
    h('div', { id: 'mesej-pengesahan' }, c('confirm.message')),
    h('p', {}, h('a', { href: SAMPLE_FORM_PATH }, c('confirm.formLink'))),
  );
}

export function errorPage(): Node {
  return layout(
    'error',
    'page.title.error',
    false,
    h('h1', {}, c('error.heading')),
    h('p', {}, c('error.intro')),
    h('ul', { class: 'gagal' }, slot('failingNames')),
    h('p', {}, h('a', { href: '/legacy/register' }, c('error.back'))),
  );
}

/** Banner, a short message and exactly one link, to /legacy/ (Requirement 1.10). No menu, no form. */
export function notFoundPage(): Node {
  return h(
    'html',
    { lang: 'ms' },
    head('not-found', 'page.title.notFound', false),
    h('body', {}, banner(), h('p', {}, c('notFound.message')), h('p', {}, h('a', { href: '/legacy/' }, c('notFound.home')))),
  );
}

export const PAGE_BUILDERS: Record<TemplateName, () => Node> = {
  home: homePage,
  register: registerPage,
  confirmation: confirmationPage,
  error: errorPage,
  notFound: notFoundPage,
};

/** One summary row: the name (also in data-name) and the value exactly as received. */
export function summaryRow(): Node {
  return h('tr', {}, h('th', { scope: 'row', 'data-name': slot('name') }, slot('name')), h('td', { 'data-value': '' }, slot('value')));
}

/** One failing field, named by its `name` attribute. */
export function failingNameRow(): Node {
  return h('li', {}, slot('name'));
}

/** Fixed sentence for a body with a name outside the form; the name itself is never shown. */
export function unknownFieldRow(): Node {
  return h('li', {}, c('error.unknownField'));
}

export const ROW_BUILDERS = { summaryRow, failingName: failingNameRow, unknownField: unknownFieldRow } as const;
