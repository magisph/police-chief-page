import { BASE_STEPS, CATEGORIES } from './data.js';
import { createStore, filterSteps } from './storage.js';
import {
  formatPowerCompact,
  formatPowerFull,
  renderFrontBarsSVG,
  renderPaceBarsSVG,
  renderPowerLineSVG,
  renderProgressRingSVG,
} from './charts.js';

const store = createStore();

const ui = {
  tab: 'today',
  statusFilter: 'pending', // pending | in_progress | completed | all
  categoryFilter: 'all',
  searchQuery: '',
  activeStripOpen: true,
  powerLogOpen: false,
  selectedPowerId: null,
  detailStepId: null,
  deferredInstallPrompt: null,
  toastTimer: null,
};

const els = {
  header: document.getElementById('app-header'),
  main: document.getElementById('main-view'),
  nav: document.getElementById('bottom-nav'),
  backdrop: document.getElementById('sheet-backdrop'),
  sheet: document.getElementById('sheet-panel'),
  toast: document.getElementById('toast'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatIsoToBr(iso) {
  if (!iso) return '';
  const str = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const d = String(parsed.getDate()).padStart(2, '0');
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const y = parsed.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return str;
}

function getTodayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

function openSheet(html) {
  els.sheet.innerHTML = html;
  els.backdrop.hidden = false;
}

function closeSheet() {
  ui.detailStepId = null;
  els.backdrop.hidden = true;
  els.sheet.innerHTML = '';
}

function isStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function renderCheckIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>`;
}

function renderSearchIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;
}

function renderPlusIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
}

function renderHeader(stats) {
  const officeLabel = stats.latestPower.officeLevel
    ? `Gab. ${stats.latestPower.officeLevel}`
    : 'Gab. 26';

  els.header.innerHTML = `
    <div class="header-brand">
      <h1 class="header-title">PC Tracker</h1>
      <span class="office-pill">${escapeHtml(officeLabel)}</span>
    </div>
    <button type="button" class="header-power-btn" data-action="open-power-sheet" aria-label="Registrar Poder Total">
      <span class="header-power-val tabular">${escapeHtml(formatPowerCompact(stats.latestPower.power))}</span>
      <span class="header-power-plus" aria-hidden="true">+</span>
    </button>
  `;
}

function renderStepRow(step) {
  const isDone = step.status === 'completed';
  const isActive = step.status === 'in_progress';
  const nextCheckStatus = isDone ? 'pending' : 'completed';

  const rowClasses = [
    'step-row',
    isDone ? 'is-completed' : '',
    isActive ? 'is-in-progress' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <article class="${rowClasses}" data-step-id="${escapeHtml(step.id)}">
      <button type="button" class="step-row-tap" data-action="open-step-detail" data-id="${escapeHtml(step.id)}">
        <div class="step-row-meta">
          <span class="step-num tabular">#${escapeHtml(step.displayNumber)}</span>
          <span>${escapeHtml(step.front)}</span>
          ${step.isCustom ? '<span class="step-custom-dot">• Extra</span>' : ''}
          ${isActive ? '<span class="step-status-tag">• Em curso</span>' : ''}
          ${step.note ? '<span class="step-note-tag">• Nota</span>' : ''}
        </div>
        <div class="step-mission">${escapeHtml(step.mission)}</div>
        <div class="step-deadline">${escapeHtml(step.deadline)}</div>
      </button>
      <button type="button"
        class="check-btn ${isDone ? 'is-completed' : ''}"
        data-action="set-status"
        data-id="${escapeHtml(step.id)}"
        data-status="${nextCheckStatus}"
        aria-label="${isDone ? 'Desmarcar etapa' : 'Concluir etapa'} ${escapeHtml(step.displayNumber)}">
        <span class="check-ring">${renderCheckIcon()}</span>
      </button>
    </article>
  `;
}

function renderTodayTab(steps, stats) {
  const inProgressSteps = steps.filter((s) => s.status === 'in_progress');
  const pendingSteps = steps.filter((s) => s.status === 'pending');
  const hero = pendingSteps[0] || null;
  const upcoming = pendingSteps.slice(1, 4);

  const activeStripHtml =
    inProgressSteps.length > 0
      ? `
      <section class="card active-strip">
        <div class="section-head">
          <h2 class="section-title">Em curso (${inProgressSteps.length})</h2>
          <button type="button" class="active-toggle-btn" data-action="toggle-active-strip">
            ${ui.activeStripOpen ? 'Recolher' : 'Mostrar'}
          </button>
        </div>
        ${
          ui.activeStripOpen
            ? `<div class="active-list">
                ${inProgressSteps
                  .map(
                    (s) => `
                  <div class="active-item">
                    <button type="button" class="active-item-tap" data-action="open-step-detail" data-id="${escapeHtml(s.id)}">
                      <span class="active-item-title">#${escapeHtml(s.displayNumber)} · ${escapeHtml(s.mission)}</span>
                      <span class="active-item-meta">${escapeHtml(s.front)} · ${escapeHtml(s.deadline)}</span>
                    </button>
                    <button type="button"
                      class="check-btn"
                      data-action="set-status"
                      data-id="${escapeHtml(s.id)}"
                      data-status="completed"
                      aria-label="Concluir etapa ${escapeHtml(s.displayNumber)}">
                      <span class="check-ring">${renderCheckIcon()}</span>
                    </button>
                  </div>
                `
                  )
                  .join('')}
              </div>`
            : ''
        }
      </section>
    `
      : '';

  const heroHtml = hero
    ? `
      <section class="card hero-card">
        <div class="hero-kicker">
          <span class="hero-kicker-tag tabular">Próxima • #${escapeHtml(hero.displayNumber)}</span>
          <span class="hero-front-label">${escapeHtml(hero.front)}</span>
        </div>
        <h2 class="hero-mission">${escapeHtml(hero.mission)}</h2>
        <div class="spec-list">
          <div class="spec-row"><strong>Prazo:</strong> ${escapeHtml(hero.deadline)}</div>
          <div class="spec-row"><strong>Custo:</strong> ${escapeHtml(hero.cost)}</div>
          <div class="spec-row"><strong>Ganhos:</strong> ${escapeHtml(hero.gains)}</div>
        </div>
        ${hero.note ? `<div class="note-callout">Nota: ${escapeHtml(hero.note)}</div>` : ''}
        <div class="hero-actions">
          <button type="button" class="btn-primary" data-action="set-status" data-id="${escapeHtml(hero.id)}" data-status="completed">
            ${renderCheckIcon()}
            <span>Concluir Etapa #${escapeHtml(hero.displayNumber)}</span>
          </button>
          <div class="hero-secondary-row">
            <button type="button" class="btn-tonal-info" data-action="set-status" data-id="${escapeHtml(hero.id)}" data-status="in_progress">
              Em curso
            </button>
            <button type="button" class="btn-secondary" data-action="open-step-detail" data-id="${escapeHtml(hero.id)}">
              Gerenciar / Nota
            </button>
          </div>
        </div>
      </section>
    `
    : `
      <section class="card hero-card">
        <h2 class="hero-mission">${
          inProgressSteps.length > 0
            ? 'Demais etapas em andamento ou concluídas'
            : 'Plano Mestre 100% concluído!'
        }</h2>
        <p class="muted" style="margin:0;font-size:13.5px">${
          inProgressSteps.length > 0
            ? 'Conclua as metas Em curso acima ou adicione novas etapas na aba Etapas.'
            : 'Todas as etapas cadastradas foram concluídas. Use a aba Etapas para incluir novos objetivos.'
        }</p>
      </section>
    `;

  const upcomingHtml =
    upcoming.length > 0
      ? `
      <section class="stack-col">
        <div class="section-head" style="margin-bottom:0;padding:0 2px">
          <h2 class="section-title">Na sequência</h2>
          <button type="button" class="inline-pill-btn" data-action="goto-steps">Ver todas</button>
        </div>
        <div class="steps-surface">
          ${upcoming.map((s) => renderStepRow(s)).join('')}
        </div>
      </section>
    `
      : '';

  return `
    <section class="card today-summary">
      <div class="ring-wrap">
        ${renderProgressRingSVG(stats)}
      </div>
      <div class="summary-metrics">
        <h2 class="summary-headline tabular">${stats.completedCount} de ${stats.total} concluídas</h2>
        <div class="summary-subline tabular">
          ${
            stats.inProgressCount > 0
              ? `<span class="text-info">${stats.inProgressCount} em curso</span>`
              : ''
          }
          <span>${stats.pendingCount} pendentes</span>
        </div>
        <div class="summary-subline tabular">
          <span>Poder: <strong style="color:var(--text)">${escapeHtml(formatPowerFull(stats.latestPower.power))}</strong></span>
          ${
            stats.powerDelta > 0
              ? `<span class="text-done">+${escapeHtml(formatPowerCompact(stats.powerDelta))}</span>`
              : ''
          }
        </div>
      </div>
    </section>
    ${activeStripHtml}
    ${heroHtml}
    ${upcomingHtml}
  `;
}

function renderStepsListHtml(steps) {
  const filtered = filterSteps(steps, {
    statusFilter: ui.statusFilter,
    categoryFilter: ui.categoryFilter,
    searchQuery: ui.searchQuery,
  });
  return filtered.length > 0
    ? filtered.map((s) => renderStepRow(s)).join('')
    : '<div class="empty-state">Nenhuma etapa encontrada para esse filtro.</div>';
}

function updateStepsListOnly() {
  const listEl = document.getElementById('steps-list');
  if (!listEl) {
    render();
    return;
  }
  const steps = store.getMergedSteps(store.loadState());
  listEl.innerHTML = renderStepsListHtml(steps);
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) {
    clearBtn.hidden = !ui.searchQuery;
  }
}

function renderStepsTab(steps, stats) {
  const statusChips = [
    ['pending', 'Pendentes', stats.pendingCount],
    ['in_progress', 'Em curso', stats.inProgressCount],
    ['completed', 'Feitas', stats.completedCount],
    ['all', 'Todas', stats.total],
  ];

  return `
    <section class="steps-toolbar">
      <div class="search-input-wrap">
        <span class="search-icon">${renderSearchIcon()}</span>
        <input id="step-search-input" class="search-input" type="search" placeholder="Buscar missão, prédio, herói..." value="${escapeHtml(ui.searchQuery)}" aria-label="Buscar etapas" />
        <button id="search-clear-btn" type="button" class="search-clear" data-action="clear-search" aria-label="Limpar busca" ${ui.searchQuery ? '' : 'hidden'}>×</button>
      </div>

      <div class="status-segmented" role="tablist" aria-label="Filtro por status">
        ${statusChips
          .map(
            ([val, label, count]) => `
          <button type="button" class="seg-btn ${ui.statusFilter === val ? 'is-selected' : ''}" data-action="set-status-filter" data-value="${val}">
            <span>${label}</span>
            <span class="seg-count tabular">${count}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <div class="chip-scroll" role="tablist" aria-label="Filtro por frente">
        <button type="button" class="filter-chip ${ui.categoryFilter === 'all' ? 'is-selected' : ''}" data-action="set-category-filter" data-value="all">
          Todas frentes
        </button>
        ${CATEGORIES.map(
          (cat) => `
          <button type="button" class="filter-chip ${ui.categoryFilter === cat ? 'is-selected' : ''}" data-action="set-category-filter" data-value="${escapeHtml(cat)}">
            ${escapeHtml(cat)}
          </button>
        `
        ).join('')}
      </div>
    </section>

    <section id="steps-list" class="steps-surface">
      ${renderStepsListHtml(steps)}
    </section>

    <button type="button" class="fab-add-btn" data-action="open-add-step-sheet" aria-label="Adicionar nova etapa">
      ${renderPlusIcon()}
      <span>Etapa</span>
    </button>
  `;
}

function renderChartsTab(state, stats) {
  const sortedPower = [...state.powerHistory].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );
  const activePowerId =
    ui.selectedPowerId && sortedPower.some((p) => p.id === ui.selectedPowerId)
      ? ui.selectedPowerId
      : sortedPower[sortedPower.length - 1]?.id;
  const selectedPower =
    sortedPower.find((p) => p.id === activePowerId) || stats.latestPower;

  const deltaSign = stats.powerDelta > 0 ? '+' : '';

  return `
    <section class="kpi-bar">
      <div class="kpi-cell">
        <span class="kpi-label">Concluídas</span>
        <span class="kpi-val tabular">${stats.completedCount}/${stats.total}</span>
      </div>
      <div class="kpi-cell">
        <span class="kpi-label">Poder Atual</span>
        <span class="kpi-val tabular">${escapeHtml(formatPowerCompact(stats.latestPower.power))}</span>
      </div>
      <div class="kpi-cell">
        <span class="kpi-label">Crescimento</span>
        <span class="kpi-val tabular ${stats.powerDelta > 0 ? 'is-positive' : ''}">${deltaSign}${escapeHtml(formatPowerCompact(stats.powerDelta))}</span>
      </div>
    </section>

    <section class="card">
      <div class="section-head">
        <h2 class="section-title">Curva de Poder Total</h2>
        <button type="button" class="inline-pill-btn" data-action="open-power-sheet">+ Registrar</button>
      </div>
      ${renderPowerLineSVG(sortedPower, activePowerId)}
      ${
        selectedPower
          ? `
        <div class="power-selected-bar">
          <div>
            <strong class="tabular">${escapeHtml(formatPowerFull(selectedPower.power))}</strong>
            <span class="muted"> · ${escapeHtml(formatIsoToBr(selectedPower.date))}${
              selectedPower.officeLevel ? ` · Gab. ${escapeHtml(selectedPower.officeLevel)}` : ''
            }</span>
            ${selectedPower.note ? `<div class="muted" style="font-size:12px">${escapeHtml(selectedPower.note)}</div>` : ''}
          </div>
          <button type="button" class="active-toggle-btn" data-action="toggle-power-log">
            ${ui.powerLogOpen ? 'Ocultar' : `Lista (${sortedPower.length})`}
          </button>
        </div>
      `
          : ''
      }
      ${
        ui.powerLogOpen
          ? `
        <div class="power-log-list">
          ${[...sortedPower]
            .reverse()
            .map(
              (item) => `
            <div class="power-log-row">
              <div>
                <strong class="tabular">${escapeHtml(formatPowerFull(item.power))}</strong>
                <span class="muted"> · ${escapeHtml(formatIsoToBr(item.date))}${
                item.officeLevel ? ` · Gab. ${escapeHtml(item.officeLevel)}` : ''
              }</span>
                ${item.note ? `<div class="muted" style="font-size:12px">${escapeHtml(item.note)}</div>` : ''}
              </div>
              ${
                sortedPower.length > 1
                  ? `<button type="button" class="discrete-btn is-danger" data-action="delete-power-log" data-id="${escapeHtml(item.id)}">Remover</button>`
                  : ''
              }
            </div>
          `
            )
            .join('')}
        </div>
      `
          : ''
      }
    </section>

    <section class="card">
      <div class="section-head">
        <h2 class="section-title">Avanço por Frente</h2>
      </div>
      ${renderFrontBarsSVG(stats.byCategory)}
    </section>

    <section class="card">
      <div class="section-head">
        <h2 class="section-title">Ritmo Diário (Concluídas)</h2>
      </div>
      ${renderPaceBarsSVG(state.completed, 7)}
    </section>
  `;
}

function renderDataTab(state) {
  const installed = isStandaloneMode();
  const installBlock = installed
    ? `<span class="text-done" style="font-size:13.5px">Aplicativo instalado e rodando em modo nativo offline.</span>`
    : ui.deferredInstallPrompt
      ? `<button type="button" class="btn-primary" data-action="trigger-install">Instalar App no Poco X6</button>`
      : `
        <p class="muted" style="margin:0;font-size:13.5px">Para instalar como aplicativo no Chrome do Poco X6:</p>
        <ol class="guide-list">
          <li>Toque no menu <strong>⋮</strong> (canto superior direito do Chrome).</li>
          <li>Toque em <strong>Adicionar à tela inicial</strong> (ou <strong>Instalar aplicativo</strong>).</li>
          <li>Confirme em <strong>Instalar</strong> para abrir em tela cheia e offline.</li>
        </ol>
      `;

  return `
    <section class="card stack-col">
      <h2 class="section-title" style="margin:0">Instalação no Poco X6</h2>
      ${installBlock}
    </section>

    <section class="card stack-col">
      <h2 class="section-title" style="margin:0">Backup Local (JSON)</h2>
      <p class="muted" style="margin:0;font-size:13px">
        Salvo no aparelho: ${Object.keys(state.completed).length} concluídas, ${Object.keys(state.notes).length} notas, ${state.customSteps.length} extras, ${state.powerHistory.length} registros de Poder.
      </p>
      <button type="button" class="btn-secondary" data-action="export-backup">Exportar Backup (.json)</button>
      <button type="button" class="btn-secondary" data-action="pick-import-file">Importar Backup (.json)</button>
      <input id="import-file-input" class="hidden-file-input" type="file" accept=".json,application/json" />
    </section>

    <section class="card stack-col">
      <h2 class="section-title" style="margin:0">Manutenção</h2>
      <button type="button" class="btn-danger" data-action="open-reset-sheet">Resetar progresso</button>
    </section>
  `;
}

function render() {
  const state = store.loadState();
  const steps = store.getMergedSteps(state);
  const stats = store.getStats(state);

  renderHeader(stats);

  for (const btn of els.nav.querySelectorAll('.nav-btn')) {
    btn.classList.toggle('is-active', btn.dataset.tab === ui.tab);
  }

  let html = '';
  if (ui.tab === 'today') {
    html = renderTodayTab(steps, stats);
  } else if (ui.tab === 'steps') {
    html = renderStepsTab(steps, stats);
  } else if (ui.tab === 'charts') {
    html = renderChartsTab(state, stats);
  } else {
    html = renderDataTab(state);
  }

  els.main.innerHTML = html;
}

function openStepDetailSheet(stepId) {
  const state = store.loadState();
  const step = store.getMergedSteps(state).find((s) => s.id === stepId);
  if (!step) return;
  ui.detailStepId = stepId;

  const statusButtons = [
    ['pending', 'Pendente'],
    ['in_progress', 'Em curso'],
    ['completed', 'Concluída'],
  ];

  openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title tabular">Etapa #${escapeHtml(step.displayNumber)} · ${escapeHtml(step.front)}</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Fechar</button>
    </div>

    <p class="sheet-mission">${escapeHtml(step.mission)}</p>

    <div class="detail-status-switch" role="group" aria-label="Alterar status da etapa">
      ${statusButtons
        .map(
          ([val, label]) => `
        <button type="button"
          class="status-choice-btn ${step.status === val ? 'is-active' : ''}"
          data-action="sheet-set-status"
          data-id="${escapeHtml(step.id)}"
          data-status="${val}">
          ${label}
        </button>
      `
        )
        .join('')}
    </div>

    <div class="spec-list" style="margin-bottom:12px">
      <div class="spec-row"><strong>Prazo:</strong> ${escapeHtml(step.deadline)}</div>
      <div class="spec-row"><strong>Custo:</strong> ${escapeHtml(step.cost)}</div>
      <div class="spec-row"><strong>Ganhos:</strong> ${escapeHtml(step.gains)}</div>
      ${
        step.completedAt
          ? `<div class="spec-row"><strong>Concluída em:</strong> ${escapeHtml(formatIsoToBr(step.completedAt))}</div>`
          : ''
      }
    </div>

    <form id="detail-note-form" class="form-stack" data-id="${escapeHtml(step.id)}">
      <label class="field-label">
        Nota pessoal
        <textarea name="note" class="field-textarea" placeholder="Ex.: Faltam 12 Moldes; anotar janela do evento...">${escapeHtml(step.note)}</textarea>
      </label>
      <div class="sheet-actions">
        ${
          step.note
            ? `<button type="button" class="btn-danger" data-action="clear-note" data-id="${escapeHtml(step.id)}">Apagar nota</button>`
            : ''
        }
        <button type="submit" class="btn-secondary">Salvar nota</button>
      </div>
    </form>

    <div class="sheet-footer-links">
      <button type="button" class="discrete-btn" data-action="open-add-after-step" data-id="${escapeHtml(step.id)}">
        + Etapa após #${escapeHtml(step.displayNumber)}
      </button>
      ${
        step.isCustom
          ? `<button type="button" class="discrete-btn" data-action="open-edit-step-sheet" data-id="${escapeHtml(step.id)}">Editar extra</button>
             <button type="button" class="discrete-btn is-danger" data-action="open-delete-step-sheet" data-id="${escapeHtml(step.id)}">Excluir</button>`
          : ''
      }
    </div>
  `);
}

function openPowerSheet() {
  const state = store.loadState();
  const stats = store.getStats(state);
  const lastOffice = stats.latestPower.officeLevel || 26;
  openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Registrar Poder Total</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Fechar</button>
    </div>
    <form id="power-form" class="form-stack">
      <label class="field-label">
        Poder Total atual
        <input name="power" class="field-input tabular" type="number" inputmode="numeric" min="1" step="1" required value="${escapeHtml(stats.latestPower.power)}" />
      </label>
      <label class="field-label">
        Data
        <input name="date" class="field-input" type="date" required value="${escapeHtml(getTodayIso())}" />
      </label>
      <label class="field-label">
        Nível do Gabinete (opcional)
        <input name="officeLevel" class="field-input tabular" type="number" inputmode="numeric" min="1" max="55" value="${escapeHtml(lastOffice)}" />
      </label>
      <label class="field-label">
        Observação curta (opcional)
        <input name="note" class="field-input" type="text" maxlength="80" placeholder="Ex.: Pós-Gabinete 27" />
      </label>
      <div class="sheet-actions">
        <button type="submit" class="btn-primary">Salvar Poder</button>
      </div>
    </form>
  `);
}

function openCustomStepSheet(editStepId = null, preselectedAfterId = null) {
  const state = store.loadState();
  const merged = store.getMergedSteps(state);
  const editing = editStepId ? merged.find((s) => s.id === editStepId && s.isCustom) : null;
  const firstPending = merged.find((s) => s.status === 'pending');
  const fallbackEndId = BASE_STEPS[BASE_STEPS.length - 1]?.id || 'base-1';
  const defaultAfter = editing
    ? editing.insertAfterId
    : preselectedAfterId || firstPending?.id || merged[merged.length - 1]?.id || fallbackEndId;

  openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">${editing ? 'Editar Etapa Extra' : 'Nova Etapa Personalizada'}</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Fechar</button>
    </div>
    <form id="custom-step-form" class="form-stack" data-edit-id="${escapeHtml(editStepId || '')}">
      <label class="field-label">
        Missão (ex.: evento aberto, obra ou meta extra)
        <input name="mission" class="field-input" type="text" required maxlength="200" placeholder="Ex.: Ataque ao Campo de Petróleo — Zona 2" value="${escapeHtml(editing?.mission || '')}" />
      </label>
      <label class="field-label">
        Categoria (Frente)
        <select name="category" class="field-select">
          ${CATEGORIES.map(
            (cat) => `<option value="${escapeHtml(cat)}" ${editing?.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`
          ).join('')}
        </select>
      </label>
      ${
        !editing
          ? `<label class="field-label">
              Inserir após qual etapa
              <select name="insertAfterId" class="field-select">
                <option value="__start__" ${defaultAfter === '__start__' ? 'selected' : ''}>No início (antes da #1)</option>
                ${merged
                  .filter((s) => s.id !== editStepId)
                  .map(
                    (s) =>
                      `<option value="${escapeHtml(s.id)}" ${defaultAfter === s.id ? 'selected' : ''}>#${escapeHtml(s.displayNumber)} — ${escapeHtml(s.mission.slice(0, 44))}</option>`
                  )
                  .join('')}
              </select>
            </label>`
          : ''
      }
      <label class="field-label">
        Prazo / Janela
        <input name="deadline" class="field-input" type="text" maxlength="100" placeholder="Ex.: Hoje (evento aberto)" value="${escapeHtml(editing?.deadline || '')}" />
      </label>
      <label class="field-label">
        Custo (opcional)
        <input name="cost" class="field-input" type="text" maxlength="120" placeholder="Ex.: 0 mortes / 10M Mun" value="${escapeHtml(editing?.cost || '')}" />
      </label>
      <label class="field-label">
        Ganhos (opcional)
        <input name="gains" class="field-input" type="text" maxlength="140" placeholder="Ex.: Moldes e Mandados" value="${escapeHtml(editing?.gains || '')}" />
      </label>
      <div class="sheet-actions">
        <button type="submit" class="btn-primary">${editing ? 'Salvar alterações' : 'Adicionar etapa'}</button>
      </div>
    </form>
  `);
}

function openDeleteCustomStepSheet(stepId) {
  const state = store.loadState();
  const step = store.getMergedSteps(state).find((s) => s.id === stepId && s.isCustom);
  if (!step) return;
  openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Excluir etapa extra</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Cancelar</button>
    </div>
    <div class="form-stack">
      <p class="muted" style="margin:0;font-size:13.5px">Deseja excluir permanentemente a etapa <strong>#${escapeHtml(step.displayNumber)}</strong>?</p>
      <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(step.mission)}</p>
      <div class="sheet-actions">
        <button type="button" class="btn-danger" data-action="confirm-delete-custom-step" data-id="${escapeHtml(step.id)}">Confirmar exclusão</button>
      </div>
    </div>
  `);
}

function openDeletePowerSheet(powerId) {
  const state = store.loadState();
  const entry = state.powerHistory.find((p) => p.id === powerId);
  if (!entry) return;
  if (state.powerHistory.length <= 1) {
    showToast('Mantenha ao menos um registro de Poder no histórico.');
    return;
  }
  openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Remover registro de Poder</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Cancelar</button>
    </div>
    <div class="form-stack">
      <p class="muted" style="margin:0;font-size:13.5px">Deseja remover este lançamento do histórico?</p>
      <div class="spec-list">
        <div class="spec-row"><strong>Poder:</strong> ${escapeHtml(formatPowerFull(entry.power))}</div>
        <div class="spec-row"><strong>Data:</strong> ${escapeHtml(formatIsoToBr(entry.date))}</div>
        ${entry.note ? `<div class="spec-row"><strong>Nota:</strong> ${escapeHtml(entry.note)}</div>` : ''}
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn-danger" data-action="confirm-delete-power" data-id="${escapeHtml(entry.id)}">Confirmar remoção</button>
      </div>
    </div>
  `);
}

function openResetSheet() {
  openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Resetar progresso</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Cancelar</button>
    </div>
    <form id="reset-form" class="form-stack">
      <p class="muted" style="margin:0;font-size:13.5px">
        Por padrão, limpa apenas os checks (<strong>concluídas</strong> e <strong>em curso</strong>), mantendo notas, etapas extras e histórico de Poder.
      </p>
      <label class="checkbox-row">
        <input type="checkbox" name="clearNotesAndCustom" />
        <span>Apagar também notas e etapas personalizadas</span>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" name="clearPower" />
        <span>Restaurar histórico de Poder para o inicial (24.279.151)</span>
      </label>
      <div class="sheet-actions">
        <button type="submit" class="btn-danger">Confirmar reset</button>
      </div>
    </form>
  `);
}

function openImportPreviewSheet(jsonString, parsed) {
  openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Confirmar importação</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Cancelar</button>
    </div>
    <div class="form-stack">
      <p class="muted" style="margin:0;font-size:13.5px">Backup validado com sucesso:</p>
      <div class="spec-list">
        <div class="spec-row"><strong>Concluídas:</strong> ${Object.keys(parsed.completed).length}</div>
        <div class="spec-row"><strong>Em curso:</strong> ${Object.keys(parsed.inProgress).length}</div>
        <div class="spec-row"><strong>Notas pessoais:</strong> ${Object.keys(parsed.notes).length}</div>
        <div class="spec-row"><strong>Etapas extras:</strong> ${parsed.customSteps.length}</div>
        <div class="spec-row"><strong>Registros de Poder:</strong> ${parsed.powerHistory.length}</div>
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn-primary" id="confirm-import-btn">Substituir dados locais</button>
      </div>
    </div>
  `);
  document.getElementById('confirm-import-btn')?.addEventListener('click', () => {
    try {
      store.importBackup(jsonString);
      closeSheet();
      render();
      showToast('Backup restaurado com sucesso');
    } catch (err) {
      showToast(err.message || 'Erro ao restaurar backup');
    }
  });
}

function handleStatusChange(id, status, reopenDetail = false) {
  try {
    store.setStepStatus(id, status);
    render();
    if (reopenDetail) openStepDetailSheet(id);
    if (status === 'completed') showToast('Etapa concluída');
    else if (status === 'in_progress') showToast('Movida para Em curso');
    else showToast('Etapa marcada como pendente');
  } catch (err) {
    showToast(err.message);
  }
}

// Navigation
els.nav.addEventListener('click', (event) => {
  const btn = event.target.closest('.nav-btn');
  if (!btn) return;
  ui.tab = btn.dataset.tab || 'today';
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
});

// Header actions
els.header.addEventListener('click', (event) => {
  const actionEl = event.target.closest('[data-action="open-power-sheet"]');
  if (actionEl) openPowerSheet();
});

// Main delegated clicks
els.main.addEventListener('click', async (event) => {
  const powerNode = event.target.closest('.power-node');
  if (powerNode && powerNode.dataset.powerId) {
    ui.selectedPowerId = powerNode.dataset.powerId;
    render();
    return;
  }

  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, status, value } = btn.dataset;

  if (action === 'set-status' && id && status) {
    handleStatusChange(id, status, false);
  } else if (action === 'open-step-detail' && id) {
    openStepDetailSheet(id);
  } else if (action === 'toggle-active-strip') {
    ui.activeStripOpen = !ui.activeStripOpen;
    render();
  } else if (action === 'toggle-power-log') {
    ui.powerLogOpen = !ui.powerLogOpen;
    render();
  } else if (action === 'goto-steps') {
    ui.tab = 'steps';
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else if (action === 'set-status-filter' && value) {
    ui.statusFilter = value;
    render();
  } else if (action === 'set-category-filter' && value) {
    ui.categoryFilter = value;
    render();
  } else if (action === 'clear-search') {
    ui.searchQuery = '';
    const input = document.getElementById('step-search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    updateStepsListOnly();
  } else if (action === 'open-power-sheet') {
    openPowerSheet();
  } else if (action === 'open-add-step-sheet') {
    openCustomStepSheet(null, null);
  } else if (action === 'delete-power-log' && id) {
    openDeletePowerSheet(id);
  } else if (action === 'export-backup') {
    const json = store.exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `police-chief-backup-${getTodayIso()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Backup exportado');
  } else if (action === 'pick-import-file') {
    document.getElementById('import-file-input')?.click();
  } else if (action === 'open-reset-sheet') {
    openResetSheet();
  } else if (action === 'trigger-install' && ui.deferredInstallPrompt) {
    ui.deferredInstallPrompt.prompt();
    const outcome = await ui.deferredInstallPrompt.userChoice;
    ui.deferredInstallPrompt = null;
    render();
    if (outcome?.outcome === 'accepted') showToast('Instalação iniciada');
  }
});

// Search & File Input delegation
els.main.addEventListener('input', (event) => {
  if (event.target.id === 'step-search-input') {
    ui.searchQuery = event.target.value;
    updateStepsListOnly();
  }
});

els.main.addEventListener('change', async (event) => {
  if (event.target.id !== 'import-file-input') return;
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = store.parseAndValidateBackup(text);
    openImportPreviewSheet(text, parsed);
  } catch (err) {
    showToast(err.message || 'Falha ao ler backup');
  }
});

// Bottom sheet backdrop & actions
els.backdrop.addEventListener('click', (event) => {
  if (event.target === els.backdrop) {
    closeSheet();
    return;
  }
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, status } = btn.dataset;

  if (action === 'close-sheet') {
    closeSheet();
  } else if (action === 'sheet-set-status' && id && status) {
    handleStatusChange(id, status, true);
  } else if (action === 'clear-note' && id) {
    try {
      store.setNote(id, '');
      render();
      openStepDetailSheet(id);
      showToast('Nota removida');
    } catch (err) {
      showToast(err.message);
    }
  } else if (action === 'open-add-after-step' && id) {
    openCustomStepSheet(null, id);
  } else if (action === 'open-edit-step-sheet' && id) {
    openCustomStepSheet(id, null);
  } else if (action === 'open-delete-step-sheet' && id) {
    openDeleteCustomStepSheet(id);
  } else if (action === 'confirm-delete-custom-step' && id) {
    try {
      store.deleteCustomStep(id);
      closeSheet();
      render();
      showToast('Etapa personalizada removida');
    } catch (err) {
      showToast(err.message);
    }
  } else if (action === 'confirm-delete-power' && id) {
    try {
      store.deletePowerLog(id);
      if (ui.selectedPowerId === id) ui.selectedPowerId = null;
      closeSheet();
      render();
      showToast('Registro de Poder removido');
    } catch (err) {
      showToast(err.message);
    }
  }
});

els.sheet.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const fd = new FormData(form);

  if (form.id === 'power-form') {
    try {
      const next = store.addPowerLog({
        date: fd.get('date'),
        power: Number(fd.get('power')),
        officeLevel: fd.get('officeLevel'),
        note: fd.get('note'),
      });
      ui.selectedPowerId = next.powerHistory[next.powerHistory.length - 1]?.id || null;
      closeSheet();
      render();
      showToast('Poder registrado');
    } catch (err) {
      showToast(err.message);
    }
  } else if (form.id === 'detail-note-form') {
    try {
      const stepId = form.dataset.id;
      store.setNote(stepId, fd.get('note'));
      render();
      openStepDetailSheet(stepId);
      showToast('Nota salva');
    } catch (err) {
      showToast(err.message);
    }
  } else if (form.id === 'custom-step-form') {
    const editId = form.dataset.editId;
    const category = String(fd.get('category') || CATEGORIES[0]);
    try {
      if (editId) {
        store.updateCustomStep(editId, {
          mission: fd.get('mission'),
          front: category,
          category,
          deadline: fd.get('deadline'),
          cost: fd.get('cost'),
          gains: fd.get('gains'),
        });
        closeSheet();
        render();
        showToast('Etapa atualizada');
      } else {
        store.addCustomStep({
          insertAfterId: fd.get('insertAfterId'),
          mission: fd.get('mission'),
          front: category,
          category,
          deadline: fd.get('deadline'),
          cost: fd.get('cost'),
          gains: fd.get('gains'),
        });
        closeSheet();
        render();
        showToast('Nova etapa adicionada');
      }
    } catch (err) {
      showToast(err.message);
    }
  } else if (form.id === 'reset-form') {
    try {
      store.resetState({
        clearNotesAndCustom: fd.get('clearNotesAndCustom') === 'on',
        clearPower: fd.get('clearPower') === 'on',
      });
      ui.selectedPowerId = null;
      closeSheet();
      render();
      showToast('Progresso reiniciado');
    } catch (err) {
      showToast(err.message);
    }
  }
});

// PWA install prompt & service worker registration
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  ui.deferredInstallPrompt = event;
  if (ui.tab === 'data') render();
});

window.addEventListener('appinstalled', () => {
  ui.deferredInstallPrompt = null;
  if (ui.tab === 'data') render();
  showToast('PC Tracker instalado!');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

render();
