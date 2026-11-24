import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  BASE_STEPS,
  INITIAL_POWER_ENTRY,
  mapFrontToCategory,
} from '../js/data.js';

test('BASE_STEPS contains all 64 ordered steps without unscheduled event steps', () => {
  assert.equal(BASE_STEPS.length, 64);
  for (let i = 0; i < 64; i += 1) {
    const item = BASE_STEPS[i];
    assert.equal(item.step, i + 1);
    assert.equal(item.id, `base-${i + 1}`);
    assert.ok(item.mission.trim().length > 5, `Step ${i + 1} missing mission`);
    assert.ok(item.front.trim().length > 2, `Step ${i + 1} missing front`);
    assert.ok(CATEGORIES.includes(item.category), `Step ${i + 1} invalid category: ${item.category}`);
    assert.equal(item.category, mapFrontToCategory(item.front));
    assert.ok(item.deadline.trim().length > 2, `Step ${i + 1} missing deadline`);
    assert.ok(item.cost.trim().length > 1, `Step ${i + 1} missing cost`);
    assert.ok(item.gains.trim().length > 3, `Step ${i + 1} missing gains`);
    assert.notEqual(item.front, 'Coleta (Eventos)');
    assert.ok(!/Ataque ao Campo de Petróleo|Ataque da Máfia|Escolta Conjunta/i.test(`${item.mission} ${item.deadline}`));
  }
});

test('CATEGORIES contains the 7 canonical fronts and mapFrontToCategory maps every front', () => {
  assert.equal(CATEGORIES.length, 7);
  assert.equal(mapFrontToCategory('Construção (Fila 1)'), 'Construção');
  assert.equal(mapFrontToCategory('Pesquisa (Batalha)'), 'Pesquisa');
  assert.equal(mapFrontToCategory('Habilidades (Herói)'), 'Heróis & Habilidades');
  assert.equal(mapFrontToCategory('Heróis (P3)'), 'Heróis & Habilidades');
  assert.equal(mapFrontToCategory('Equip. Herói (Forja)'), 'Equip. Herói');
  assert.equal(mapFrontToCategory('Equip. do Chefe'), 'Chefe & Insígnias');
  assert.equal(mapFrontToCategory('Insígnias do Chefe'), 'Chefe & Insígnias');
  assert.equal(mapFrontToCategory('Tropas (Promoção)'), 'Tropas');
  assert.equal(mapFrontToCategory('Confisco & Recursos'), 'Recursos & Eventos');
  assert.equal(mapFrontToCategory('Coleta (Eventos)'), 'Recursos & Eventos');
});

test('INITIAL_POWER_ENTRY matches audited account state on 2026-11-24', () => {
  assert.equal(INITIAL_POWER_ENTRY.power, 24279151);
  assert.equal(INITIAL_POWER_ENTRY.officeLevel, 26);
  assert.equal(INITIAL_POWER_ENTRY.date, '2026-11-24');
});

import {
  STORAGE_KEY,
  createMemoryBackend,
  createStore,
} from '../js/storage.js';

test('createStore initializes default state with seed powerHistory and handles corrupted storage safely', () => {
  const backend = createMemoryBackend();
  const store = createStore(backend);
  const state = store.loadState();
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(state.completed, {});
  assert.deepEqual(state.inProgress, {});
  assert.equal(state.powerHistory.length, 1);
  assert.equal(state.powerHistory[0].power, 24279151);

  const corruptBackend = createMemoryBackend({ [STORAGE_KEY]: '{invalid-json' });
  const corruptStore = createStore(corruptBackend);
  const fallback = corruptStore.loadState();
  assert.equal(fallback.schemaVersion, 1);
  assert.equal(fallback.powerHistory.length, 1);
});

test('setStepStatus enforces mutually exclusive states pending <-> in_progress <-> completed', () => {
  const store = createStore(createMemoryBackend());
  let s = store.setStepStatus('base-6', 'in_progress');
  assert.ok(s.inProgress['base-6']);
  assert.equal(s.completed['base-6'], undefined);

  s = store.setStepStatus('base-6', 'completed');
  assert.ok(s.completed['base-6']);
  assert.equal(s.inProgress['base-6'], undefined);

  s = store.setStepStatus('base-6', 'pending');
  assert.equal(s.completed['base-6'], undefined);
  assert.equal(s.inProgress['base-6'], undefined);
});

test('addCustomStep numbers N.1/N.2 and deleteCustomStep cleans orphan keys and preserves children', () => {
  const store = createStore(createMemoryBackend());
  const r1 = store.addCustomStep({
    insertAfterId: 'base-11',
    mission: 'Subir Armazém 23 → 24',
    front: 'Construção (Fila 2)',
    deadline: 'Quando sobrar fila',
    cost: '10M Mun',
    gains: 'Proteção',
  });
  const r2 = store.addCustomStep({
    insertAfterId: r1.newStep.id,
    mission: 'Subir Posto 24 → 25',
    front: 'Construção (Fila 2)',
    deadline: 'Depois',
    cost: '12M Mun',
    gains: 'Recurso',
  });
  store.setStepStatus(r1.newStep.id, 'in_progress');
  store.setNote(r1.newStep.id, 'Nota temporária');

  let merged = store.getMergedSteps(store.loadState());
  assert.equal(merged.length, 66);
  const idx11 = merged.findIndex((x) => x.id === 'base-11');
  assert.equal(merged[idx11].displayNumber, '11');
  assert.equal(merged[idx11 + 1].id, r1.newStep.id);
  assert.equal(merged[idx11 + 1].displayNumber, '11.1');
  assert.equal(merged[idx11 + 2].id, r2.newStep.id);
  assert.equal(merged[idx11 + 2].displayNumber, '11.2');
  assert.equal(merged[idx11 + 3].id, 'base-12');
  assert.equal(merged[idx11 + 3].displayNumber, '12');

  const afterDel = store.deleteCustomStep(r1.newStep.id);
  assert.equal(afterDel.inProgress[r1.newStep.id], undefined);
  assert.equal(afterDel.notes[r1.newStep.id], undefined);
  merged = store.getMergedSteps(afterDel);
  assert.equal(merged.length, 65);
  assert.equal(merged[idx11 + 1].id, r2.newStep.id);
  assert.equal(merged[idx11 + 1].displayNumber, '11.1');
});

test('importBackup rejects malformed JSON without overwriting existing state', () => {
  const store = createStore(createMemoryBackend());
  store.setStepStatus('base-1', 'completed');
  store.setNote('base-1', 'Conferido');

  assert.throws(() => store.importBackup('not-json'), /JSON inválido/i);
  assert.throws(() => store.importBackup(JSON.stringify({ schemaVersion: 99 })), /versão/i);

  const current = store.loadState();
  assert.ok(current.completed['base-1']);
  assert.equal(current.notes['base-1'], 'Conferido');

  const exported = store.exportBackup(current);
  store.resetState({ clearNotesAndCustom: true, clearPower: true });
  assert.equal(store.loadState().completed['base-1'], undefined);

  const restored = store.importBackup(exported);
  assert.ok(restored.completed['base-1']);
  assert.equal(restored.notes['base-1'], 'Conferido');
});

test('resetState defaults to preserving notes, customSteps, and powerHistory', () => {
  const store = createStore(createMemoryBackend());
  store.setStepStatus('base-1', 'completed');
  store.setStepStatus('base-2', 'in_progress');
  store.setNote('base-1', 'Minha nota');
  store.addCustomStep({
    insertAfterId: 'base-1',
    mission: 'Etapa extra',
    front: 'Pesquisa (Desenv.)',
    deadline: 'Hoje',
    cost: '0',
    gains: 'Teste',
  });
  store.addPowerLog({ date: '2026-11-28', power: 25100000, officeLevel: 27, note: 'Gab 27' });

  const afterSafeReset = store.resetState({});
  assert.deepEqual(afterSafeReset.completed, {});
  assert.deepEqual(afterSafeReset.inProgress, {});
  assert.equal(afterSafeReset.notes['base-1'], 'Minha nota');
  assert.equal(afterSafeReset.customSteps.length, 1);
  assert.equal(afterSafeReset.powerHistory.length, 2);
});

test('getStats computes completion strictly on completed steps and aggregates by canonical category', () => {
  const store = createStore(createMemoryBackend());
  store.setStepStatus('base-1', 'completed');
  store.setStepStatus('base-2', 'in_progress');
  const stats = store.getStats(store.loadState());
  assert.equal(stats.total, 64);
  assert.equal(stats.completedCount, 1);
  assert.equal(stats.inProgressCount, 1);
  assert.equal(stats.pendingCount, 62);
  assert.equal(stats.byCategory.length, 7);
});

import {
  formatPowerCompact,
  formatPowerFull,
  renderProgressRingSVG,
  renderFrontBarsSVG,
  renderPowerLineSVG,
  renderPaceBarsSVG,
} from '../js/charts.js';

test('power formatting helpers render Brazilian locale-style compact and full strings', () => {
  assert.equal(formatPowerFull(24279151), '24.279.151');
  assert.equal(formatPowerCompact(24279151), '24,28M');
  assert.equal(formatPowerCompact(850000), '850K');
});

test('renderPowerLineSVG handles 0, 1, equal values and unsorted dates without NaN', () => {
  const emptySvg = renderPowerLineSVG([]);
  assert.ok(!emptySvg.includes('NaN'));
  assert.ok(!emptySvg.includes('undefined'));

  const singleSvg = renderPowerLineSVG([
    { id: 'p1', date: '2026-11-24', power: 24279151, officeLevel: 26, note: 'Inicial' },
  ]);
  assert.ok(singleSvg.includes('<svg'));
  assert.ok(singleSvg.includes('data-power-id="p1"'));
  assert.ok(!singleSvg.includes('NaN'));

  const equalSvg = renderPowerLineSVG([
    { id: 'p2', date: '2026-11-26', power: 25000000 },
    { id: 'p1', date: '2026-11-24', power: 25000000 },
  ], 'p2');
  assert.ok(equalSvg.includes('<svg'));
  assert.ok(!equalSvg.includes('NaN'));
  // p1 (24/11) must appear before p2 (26/11) in SVG coordinate order
  assert.ok(equalSvg.indexOf('data-power-id="p1"') < equalSvg.indexOf('data-power-id="p2"'));
});

test('renderProgressRingSVG, renderFrontBarsSVG and renderPaceBarsSVG output valid SVGs without NaN', () => {
  const ring = renderProgressRingSVG({ completedCount: 17, total: 67, inProgressCount: 3 });
  assert.ok(ring.includes('<svg'));
  assert.ok(ring.includes('25%'));
  assert.ok(!ring.includes('NaN'));

  const bars = renderFrontBarsSVG([
    { category: 'Construção', total: 22, completed: 4, inProgress: 1, percent: 18 },
    { category: 'Pesquisa', total: 8, completed: 2, inProgress: 0, percent: 25 },
  ]);
  assert.ok(bars.includes('<svg'));
  assert.ok(bars.includes('Construção'));
  assert.ok(!bars.includes('NaN'));

  const pace = renderPaceBarsSVG({
    'base-1': '2026-11-24T12:00:00.000Z',
    'base-2': '2026-11-24T18:00:00.000Z',
    'base-3': '2026-11-26T10:00:00.000Z',
  }, 7);
  assert.ok(pace.includes('<svg'));
  assert.ok(!pace.includes('NaN'));
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('manifest.webmanifest and sw.js use relative paths and reference existing assets', () => {
  const manifestRaw = fs.readFileSync(path.join(rootDir, 'manifest.webmanifest'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('./'), `Icon src must be relative: ${icon.src}`);
    const full = path.join(rootDir, icon.src.slice(2));
    assert.ok(fs.existsSync(full), `Missing icon file: ${icon.src}`);
    assert.ok(fs.statSync(full).size > 100, `Icon file too small: ${icon.src}`);
  }

  const swText = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
  const matches = [...swText.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);
  assert.ok(matches.includes('./index.html'));
  assert.ok(matches.includes('./js/app.js'));
  for (const rel of matches) {
    if (rel === './') continue;
    const target = path.join(rootDir, rel.slice(2));
    assert.ok(fs.existsSync(target), `Missing precache asset in sw.js: ${rel}`);
  }
});

import { filterSteps } from '../js/storage.js';

test('formatPowerCompact formats negative deltas cleanly in M and K', () => {
  assert.equal(formatPowerCompact(-1500000), '-1,50M');
  assert.equal(formatPowerCompact(-850000), '-850K');
  assert.equal(formatPowerCompact(-420), '-420');
});

test('styles.css enforces >= 44px touch targets on interactive controls', () => {
  const css = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
  const selectors = [
    '.active-toggle-btn',
    '.search-clear',
    '.filter-chip',
    '.discrete-btn',
    '.inline-pill-btn',
    '.seg-btn',
    '.fab-add-btn',
    '.step-row-tap',
    '.check-btn',
  ];
  for (const sel of selectors) {
    const idx = css.indexOf(`${sel} {`);
    assert.ok(idx !== -1, `Missing selector ${sel}`);
    const block = css.slice(idx, css.indexOf('}', idx) + 1);
    const match = /min-height:\s*(\d+)px/.exec(block);
    assert.ok(match && Number(match[1]) >= 44, `${sel} min-height must be >= 44px, got ${match?.[1]}`);
  }
});

test('filterSteps filters by status, category and query, and app.js updates #steps-list without destroying search input', () => {
  const store = createStore(createMemoryBackend());
  store.setStepStatus('base-1', 'completed');
  store.setStepStatus('base-2', 'in_progress');
  const merged = store.getMergedSteps(store.loadState());

  const activeOnly = filterSteps(merged, { statusFilter: 'in_progress', categoryFilter: 'all', searchQuery: '' });
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0].id, 'base-2');

  const queryFiltered = filterSteps(merged, { statusFilter: 'all', categoryFilter: 'all', searchQuery: 'Scarlett' });
  assert.ok(queryFiltered.length >= 2);

  const appSrc = fs.readFileSync(path.join(rootDir, 'js', 'app.js'), 'utf8');
  assert.ok(appSrc.includes("id=\"steps-list\""), 'Steps list container must have id="steps-list"');
  assert.ok(appSrc.includes('updateStepsListOnly'), 'Search input handler must use incremental updateStepsListOnly');
});

test('storage.js throws user-friendly error if backend.setItem throws QuotaExceededError', () => {
  const failingBackend = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  const store = createStore(failingBackend);
  assert.throws(() => store.setStepStatus('base-1', 'completed'), /armazenamento local/i);
});

test('renderPaceBarsSVG converts ISO timestamps with time into local calendar day', () => {
  const ts = '2026-11-25T01:30:00.000Z';
  const d = new Date(ts);
  const expectedBr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const svg = renderPaceBarsSVG({ 'base-1': ts }, 7);
  assert.ok(svg.includes(expectedBr), `Expected local date ${expectedBr} in pace SVG`);
});

test('sw.js uses network-first for navigation, ignoreSearch, and waitUntil for clients.claim', () => {
  const swText = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
  assert.ok(swText.includes("mode === 'navigate'"));
  assert.ok(swText.includes('ignoreSearch: true'));
  assert.ok(/waitUntil\([\s\S]*clients\.claim\(\)/.test(swText));
});

test('styles.css suppresses native webkit search cancel button and app.js confirms power deletion and uses unified step detail sheet', () => {
  const css = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
  assert.ok(css.includes('::-webkit-search-cancel-button'));
  assert.ok(css.includes('prefers-reduced-motion'));

  const appSrc = fs.readFileSync(path.join(rootDir, 'js', 'app.js'), 'utf8');
  assert.ok(appSrc.includes('openDeletePowerSheet'));
  assert.ok(appSrc.includes('confirm-delete-power'));
  assert.ok(appSrc.includes('openStepDetailSheet'));
  assert.ok(appSrc.includes('fab-add-btn'));
  assert.ok(!appSrc.includes('base-67'));
});

test('styles.css clears FAB height in .main-view bottom padding and places .toast above FAB', () => {
  const css = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
  const mainMatch = /\.main-view\s*\{[\s\S]*?padding:\s*14px 14px calc\((\d+)px/.exec(css);
  const fabBottomMatch = /\.fab-add-btn\s*\{[\s\S]*?bottom:\s*calc\((\d+)px/.exec(css);
  const fabHeightMatch = /\.fab-add-btn\s*\{[\s\S]*?min-height:\s*(\d+)px/.exec(css);
  const toastBottomMatch = /\.toast\s*\{[\s\S]*?bottom:\s*calc\((\d+)px/.exec(css);

  assert.ok(mainMatch && fabBottomMatch && fabHeightMatch && toastBottomMatch);
  const fabTop = Number(fabBottomMatch[1]) + Number(fabHeightMatch[1]);
  assert.ok(Number(mainMatch[1]) >= fabTop + 16, `.main-view bottom padding (${mainMatch[1]}) must clear FAB top (${fabTop})`);
  assert.ok(Number(toastBottomMatch[1]) >= fabTop + 8, `.toast bottom (${toastBottomMatch[1]}) must sit above FAB top (${fabTop})`);
});
