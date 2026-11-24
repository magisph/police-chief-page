import { CATEGORIES } from './data.js';
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
  statusFilter: 'pending', // pending | in_progress | all | completed
  categoryFilter: 'all',
  searchQuery: '',
  expandedIds: new Set(),
  activeStripOpen: true,
  powerLogOpen: false,
  selectedPowerId: null,
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
  }, 2400);
}

function openSheet(html) {
  els.sheet.innerHTML = html;
  els.backdrop.hidden = false;
}

function closeSheet() {
  els.backdrop.hidden = true;
  els.sheet.innerHTML = '';
}

function isStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function renderHeader(stats) {
  const officeLabel = stats.latestPower.officeLevel
    ? `Gabinete ${stats.latestPower.officeLevel}`
    : 'Gabinete 26';

  els.header.innerHTML = `
    <div class="header-brand">
      <div class="header-title-row">
        <h1 class="header-title">PC Tracker</h1>
        <span class="office-pill">${escapeHtml(officeLabel)}</span>
      </div>
      <span class="header-sub tabular">${stats.completedCount}/${stats.total} etapas • ${stats.percent}%</span>
    </div>
    <button type="button" class="header-power-btn" data-action="open-power-sheet" aria-label="Registrar Poder Total">
      <span class="header-power-val tabular">${escapeHtml(formatPowerFull(stats.latestPower.power))}</span>
      <span class="header-power-cta">+ Registrar Poder</span>
    </button>
  `;
}

function renderCheckIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" fill="currentColor"/></svg>`;
}

function renderPauseIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor"/></svg>`;
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
                    <div class="active-item-body">
                      <p class="active-item-title">#${escapeHtml(s.displayNumber)} • ${escapeHtml(s.mission)}</p>
                      <div class="active-item-meta">${escapeHtml(s.front)} • ${escapeHtml(s.deadline)}</div>
                    </div>
                    <div class="mini-action-row">
                      <button type="button" class="icon-btn is-active" data-action="set-status" data-id="${escapeHtml(s.id)}" data-status="pending" title="Voltar para pendente" aria-label="Voltar etapa ${escapeHtml(s.displayNumber)} para pendente">
                        ${renderPauseIcon()}
                      </button>
                      <button type="button" class="icon-btn is-done" data-action="set-status" data-id="${escapeHtml(s.id)}" data-status="completed" title="Concluir etapa" aria-label="Concluir etapa ${escapeHtml(s.displayNumber)}">
                        ${renderCheckIcon()}
                      </button>
                    </div>
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
          <span class="step-badge">Próxima • #${escapeHtml(hero.displayNumber)}</span>
          <span class="front-badge">${escapeHtml(hero.front)}</span>
        </div>
        <h2 class="hero-mission">${escapeHtml(hero.mission)}</h2>
        <div class="detail-grid">
          <div class="detail-row"><strong>Prazo:</strong> ${escapeHtml(hero.deadline)}</div>
          <div class="detail-row"><strong>Custo:</strong> ${escapeHtml(hero.cost)}</div>
          <div class="detail-row"><strong>Ganhos:</strong> ${escapeHtml(hero.gains)}</div>
          ${hero.note ? `<div class="note-preview">Nota: ${escapeHtml(hero.note)}</div>` : ''}
        </div>
        <div class="hero-actions">
          <button type="button" class="btn-primary" data-action="set-status" data-id="${escapeHtml(hero.id)}" data-status="completed">
            ${renderCheckIcon()}
            <span>Concluir Etapa #${escapeHtml(hero.displayNumber)}</span>
          </button>
          <button type="button" class="btn-ghost-link" data-action="set-status" data-id="${escapeHtml(hero.id)}" data-status="in_progress">
            Mover para Em curso / Aguardando
          </button>
        </div>
      </section>
    `
    : `
      <section class="card hero-card">
        <h2 class="hero-mission">${
          inProgressSteps.length > 0
            ? 'Todas as demais etapas estão Em curso ou Concluídas'
            : 'Plano Mestre 100% concluído!'
        }</h2>
        <p class="header-sub">${
          inProgressSteps.length > 0
            ? 'Finalize suas etapas em andamento no bloco acima ou adicione novas metas na aba Etapas.'
            : 'Você completou todas as etapas cadastradas. Adicione novas metas quando avançar para os próximos patamares.'
        }</p>
      </section>
    `;

  const upcomingHtml =
    upcoming.length > 0
      ? `
      <section class="card">
        <div class="section-head">
          <h2 class="section-title">Na sequência</h2>
          <button type="button" class="inline-pill-btn" data-action="goto-steps">Ver todas</button>
        </div>
        <div class="steps-list">
          ${upcoming.map((s) => renderStepCard(s)).join('')}
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
        <div class="metric-row">
          <span class="status-pill is-done tabular">${stats.completedCount} concluídas</span>
          ${
            stats.inProgressCount > 0
              ? `<span class="status-pill is-active tabular">${stats.inProgressCount} em curso</span>`
              : ''
          }
          <span class="status-pill tabular">${stats.pendingCount} pendentes</span>
        </div>
        <div class="header-sub">
          Poder atual: <strong class="tabular" style="color:var(--text)">${escapeHtml(formatPowerFull(stats.latestPower.power))}</strong>
          ${
            stats.powerDelta > 0
              ? `<span style="color:var(--done)">(+${escapeHtml(formatPowerCompact(stats.powerDelta))})</span>`
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

function renderStepCard(step) {
  const expanded = ui.expandedIds.has(step.id);
  const isDone = step.status === 'completed';
  const isActive = step.status === 'in_progress';

  const nextCheckStatus = isDone ? 'pending' : 'completed';
  const stateClasses = [
    'step-card',
    isDone ? 'is-completed' : '',
    isActive ? 'is-in-progress' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <article class="${stateClasses}" data-step-id="${escapeHtml(step.id)}">
      <div class="step-card-main">
        <button type="button" class="step-card-tap" data-action="toggle-expand" data-id="${escapeHtml(step.id)}" aria-expanded="${expanded}">
          <div class="step-top-meta">
            <span class="step-num tabular">#${escapeHtml(step.displayNumber)}</span>
            <span class="step-front">${escapeHtml(step.front)}</span>
            ${step.isCustom ? '<span class="step-custom-tag">Extra</span>' : ''}
          </div>
          <div class="step-mission">${escapeHtml(step.mission)}</div>
          <div class="step-subline">
            <span>${escapeHtml(step.deadline)}</span>
            ${isActive ? '<span class="dot-badge is-active">● Em curso</span>' : ''}
            ${step.note ? '<span class="dot-badge is-note">● Nota</span>' : ''}
          </div>
        </button>
        <button type="button"
          class="check-btn ${isDone ? 'is-completed' : ''}"
          data-action="set-status"
          data-id="${escapeHtml(step.id)}"
          data-status="${nextCheckStatus}"
          aria-label="${isDone ? 'Desmarcar etapa' : 'Concluir etapa'} ${escapeHtml(step.displayNumber)}">
          ${renderCheckIcon()}
        </button>
      </div>
      ${
        expanded
          ? `
        <div class="step-expanded">
          <div class="detail-row"><strong>Custo:</strong> ${escapeHtml(step.cost)}</div>
          <div class="detail-row"><strong>Ganhos:</strong> ${escapeHtml(step.gains)}</div>
          ${
            step.completedAt
              ? `<div class="detail-row"><strong>Concluída em:</strong> ${escapeHtml(formatIsoToBr(step.completedAt))}</div>`
              : ''
          }
          ${step.note ? `<div class="note-preview">${escapeHtml(step.note)}</div>` : ''}
          <div class="expanded-actions">
            ${
              !isDone
                ? `<button type="button" class="discrete-btn ${isActive ? 'is-active' : ''}" data-action="set-status" data-id="${escapeHtml(step.id)}" data-status="${isActive ? 'pending' : 'in_progress'}">
                    ${isActive ? 'Retomar pendente' : 'Mover p/ Em curso'}
                  </button>`
                : ''
            }
            <button type="button" class="discrete-btn" data-action="open-note-sheet" data-id="${escapeHtml(step.id)}">
              ${step.note ? 'Editar nota' : 'Adicionar nota'}
            </button>
            ${
              step.isCustom
                ? `<button type="button" class="discrete-btn" data-action="open-edit-step-sheet" data-id="${escapeHtml(step.id)}">Editar</button>
                   <button type="button" class="discrete-btn is-danger" data-action="delete-custom-step" data-id="${escapeHtml(step.id)}">Excluir</button>`
                : ''
            }
          </div>
        </div>
      `
          : ''
      }
    </article>
  `;
}

function renderStepsListHtml(steps) {
  const filtered = filterSteps(steps, {
    statusFilter: ui.statusFilter,
    categoryFilter: ui.categoryFilter,
    searchQuery: ui.searchQuery,
  });
  return filtered.length > 0
    ? filtered.map((s) => renderStepCard(s)).join('')
    : '<div class="empty-state card">Nenhuma etapa encontrada para esse filtro.</div>';
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

function renderStepsTab(steps) {
  const statusChips = [
    ['pending', 'Pendentes'],
    ['in_progress', 'Em curso'],
    ['all', 'Todas'],
    ['completed', 'Concluídas'],
  ];

  return `
    <section class="steps-toolbar">
      <div class="search-row">
        <div class="search-input-wrap">
          <input id="step-search-input" class="search-input" type="search" placeholder="Buscar etapa, prédio, herói..." value="${escapeHtml(ui.searchQuery)}" aria-label="Buscar etapas" />
          <button id="search-clear-btn" type="button" class="search-clear" data-action="clear-search" aria-label="Limpar busca" ${ui.searchQuery ? '' : 'hidden'}>×</button>
        </div>
        <button type="button" class="add-step-btn" data-action="open-add-step-sheet" title="Nova etapa personalizada" aria-label="Adicionar nova etapa">+</button>
      </div>

      <div class="chip-scroll" role="tablist" aria-label="Filtro por status">
        ${statusChips
          .map(
            ([val, label]) => `
          <button type="button" class="filter-chip ${ui.statusFilter === val ? 'is-selected' : ''}" data-action="set-status-filter" data-value="${val}">
            ${label}
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

    <section id="steps-list" class="steps-list">
      ${renderStepsListHtml(steps)}
    </section>
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
    <section class="kpi-grid">
      <div class="kpi-box">
        <span class="kpi-label">Concluídas</span>
        <span class="kpi-val tabular">${stats.completedCount}/${stats.total}</span>
      </div>
      <div class="kpi-box">
        <span class="kpi-label">Poder Atual</span>
        <span class="kpi-val tabular">${escapeHtml(formatPowerCompact(stats.latestPower.power))}</span>
      </div>
      <div class="kpi-box">
        <span class="kpi-label">Crescimento</span>
        <span class="kpi-val tabular ${stats.powerDelta > 0 ? 'is-positive' : ''}">${deltaSign}${escapeHtml(formatPowerCompact(stats.powerDelta))}</span>
      </div>
    </section>

    <section class="card">
      <div class="section-head">
        <h2 class="section-title">Curva de Poder Total</h2>
        <button type="button" class="inline-pill-btn" data-action="open-power-sheet">+ Registrar Poder</button>
      </div>
      ${renderPowerLineSVG(sortedPower, activePowerId)}
      ${
        selectedPower
          ? `
        <div class="power-selected-bar">
          <div>
            <strong class="tabular">${escapeHtml(formatPowerFull(selectedPower.power))}</strong>
            <span class="header-sub"> • ${escapeHtml(formatIsoToBr(selectedPower.date))}${
              selectedPower.officeLevel ? ` • Gab. ${escapeHtml(selectedPower.officeLevel)}` : ''
            }</span>
            ${selectedPower.note ? `<div class="header-sub">${escapeHtml(selectedPower.note)}</div>` : ''}
          </div>
          <button type="button" class="active-toggle-btn" data-action="toggle-power-log">
            ${ui.powerLogOpen ? 'Ocultar lista' : `Histórico (${sortedPower.length})`}
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
                <span class="header-sub"> • ${escapeHtml(formatIsoToBr(item.date))}${
                item.officeLevel ? ` • Gab. ${escapeHtml(item.officeLevel)}` : ''
              }</span>
                ${item.note ? `<div class="header-sub">${escapeHtml(item.note)}</div>` : ''}
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
        <h2 class="section-title">Ritmo Diário (Etapas Concluídas)</h2>
      </div>
      ${renderPaceBarsSVG(state.completed, 7)}
    </section>
  `;
}

function renderDataTab(state) {
  const installed = isStandaloneMode();
  const installBlock = installed
    ? `<div class="status-pill is-done">Aplicativo instalado e rodando em modo standalone</div>`
    : ui.deferredInstallPrompt
      ? `<button type="button" class="btn-primary" data-action="trigger-install">Instalar App no Poco X6</button>`
      : `
        <p class="header-sub" style="margin:0">Para instalar como app nativo no Chrome do Poco X6:</p>
        <ol class="guide-list">
          <li>Toque no menu <strong>⋮</strong> (canto superior direito do Chrome).</li>
          <li>Toque em <strong>Adicionar à tela inicial</strong> (ou <strong>Instalar aplicativo</strong>).</li>
          <li>Confirme em <strong>Instalar</strong> para usar em tela cheia e offline.</li>
        </ol>
      `;

  return `
    <section class="card stack-col">
      <h2 class="section-title" style="margin:0">Instalação no Poco X6</h2>
      ${installBlock}
    </section>

    <section class="card stack-col">
      <h2 class="section-title" style="margin:0">Backup Local (JSON)</h2>
      <p class="header-sub" style="margin:0">
        Seus dados ficam salvos no navegador deste celular (${Object.keys(state.completed).length} concluídas, ${Object.keys(state.notes).length} notas, ${state.customSteps.length} extras, ${state.powerHistory.length} registros de Poder).
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
    html = renderStepsTab(steps);
  } else if (ui.tab === 'charts') {
    html = renderChartsTab(state, stats);
  } else {
    html = renderDataTab(state);
  }

  els.main.innerHTML = html;
}

function openPowerSheet() {
  const state = store.loadState();
  const stats = store.getStats(state);
  const lastOffice = stats.latestPower.officeLevel || 26;
  openSheet(`
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

function openNoteSheet(stepId) {
  const state = store.loadState();
  const step = store.getMergedSteps(state).find((s) => s.id === stepId);
  if (!step) return;
  openSheet(`
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Nota • Etapa #${escapeHtml(step.displayNumber)}</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Fechar</button>
    </div>
    <form id="note-form" class="form-stack" data-id="${escapeHtml(stepId)}">
      <p class="header-sub" style="margin:0">${escapeHtml(step.mission)}</p>
      <label class="field-label">
        Anotação pessoal
        <textarea name="note" class="field-textarea" placeholder="Ex.: Faltam 12 Moldes; confirmar barra parcial...">${escapeHtml(step.note)}</textarea>
      </label>
      <div class="sheet-actions">
        ${
          step.note
            ? `<button type="button" class="btn-danger" data-action="clear-note" data-id="${escapeHtml(stepId)}">Apagar</button>`
            : ''
        }
        <button type="submit" class="btn-primary">Salvar nota</button>
      </div>
    </form>
  `);
}

function openCustomStepSheet(editStepId = null) {
  const state = store.loadState();
  const merged = store.getMergedSteps(state);
  const editing = editStepId ? merged.find((s) => s.id === editStepId && s.isCustom) : null;
  const firstPending = merged.find((s) => s.status === 'pending');
  const defaultAfter = editing
    ? editing.insertAfterId
    : firstPending?.id || merged[merged.length - 1]?.id || 'base-67';

  openSheet(`
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">${editing ? 'Editar Etapa Extra' : 'Nova Etapa Personalizada'}</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Fechar</button>
    </div>
    <form id="custom-step-form" class="form-stack" data-edit-id="${escapeHtml(editStepId || '')}">
      <label class="field-label">
        Missão
        <input name="mission" class="field-input" type="text" required maxlength="200" placeholder="Ex.: Subir Armazém 23 → 24" value="${escapeHtml(editing?.mission || '')}" />
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
                <option value="__start__">No início (antes da #1)</option>
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
        <input name="deadline" class="field-input" type="text" maxlength="100" placeholder="Ex.: Quando sobrar fila" value="${escapeHtml(editing?.deadline || '')}" />
      </label>
      <label class="field-label">
        Custo
        <input name="cost" class="field-input" type="text" maxlength="120" placeholder="Ex.: 10M Mun / 10M Din" value="${escapeHtml(editing?.cost || '')}" />
      </label>
      <label class="field-label">
        Ganhos
        <input name="gains" class="field-input" type="text" maxlength="140" placeholder="Ex.: Protege recursos" value="${escapeHtml(editing?.gains || '')}" />
      </label>
      <div class="sheet-actions">
        <button type="submit" class="btn-primary">${editing ? 'Salvar alterações' : 'Adicionar etapa'}</button>
      </div>
    </form>
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
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Remover registro de Poder</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Cancelar</button>
    </div>
    <div class="form-stack">
      <p class="header-sub" style="margin:0">Deseja remover este lançamento do histórico?</p>
      <div class="detail-grid">
        <div class="detail-row"><strong>Poder:</strong> ${escapeHtml(formatPowerFull(entry.power))}</div>
        <div class="detail-row"><strong>Data:</strong> ${escapeHtml(formatIsoToBr(entry.date))}</div>
        ${entry.note ? `<div class="detail-row"><strong>Nota:</strong> ${escapeHtml(entry.note)}</div>` : ''}
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn-danger" data-action="confirm-delete-power" data-id="${escapeHtml(entry.id)}">Confirmar remoção</button>
      </div>
    </div>
  `);
}

function openResetSheet() {
  openSheet(`
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Resetar progresso</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Cancelar</button>
    </div>
    <form id="reset-form" class="form-stack">
      <p class="header-sub" style="margin:0">
        Por padrão, limpa apenas os checks (<strong>concluídas</strong> e <strong>em curso</strong>), mantendo suas notas, etapas extras e histórico de Poder.
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
    <div class="sheet-header">
      <h2 id="sheet-title" class="sheet-title">Confirmar importação</h2>
      <button type="button" class="discrete-btn" data-action="close-sheet">Cancelar</button>
    </div>
    <div class="form-stack">
      <p class="header-sub" style="margin:0">Backup validado com sucesso:</p>
      <div class="detail-grid">
        <div class="detail-row"><strong>Concluídas:</strong> ${Object.keys(parsed.completed).length}</div>
        <div class="detail-row"><strong>Em curso:</strong> ${Object.keys(parsed.inProgress).length}</div>
        <div class="detail-row"><strong>Notas pessoais:</strong> ${Object.keys(parsed.notes).length}</div>
        <div class="detail-row"><strong>Etapas extras:</strong> ${parsed.customSteps.length}</div>
        <div class="detail-row"><strong>Registros de Poder:</strong> ${parsed.powerHistory.length}</div>
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn-primary" id="confirm-import-btn">Substituir dados locais</button>
      </div>
    </div>
  `);
  document.getElementById('confirm-import-btn')?.addEventListener('click', () => {
    store.importBackup(jsonString);
    closeSheet();
    render();
    showToast('Backup restaurado com sucesso');
  });
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
    try {
      store.setStepStatus(id, status);
      render();
      if (status === 'completed') showToast('Etapa concluída');
      else if (status === 'in_progress') showToast('Movida para Em curso');
      else showToast('Etapa marcada como pendente');
    } catch (err) {
      showToast(err.message);
    }
  } else if (action === 'toggle-expand' && id) {
    if (ui.expandedIds.has(id)) ui.expandedIds.delete(id);
    else ui.expandedIds.add(id);
    render();
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
  } else if (action === 'open-note-sheet' && id) {
    openNoteSheet(id);
  } else if (action === 'open-add-step-sheet') {
    openCustomStepSheet(null);
  } else if (action === 'open-edit-step-sheet' && id) {
    openCustomStepSheet(id);
  } else if (action === 'delete-custom-step' && id) {
    try {
      store.deleteCustomStep(id);
      ui.expandedIds.delete(id);
      render();
      showToast('Etapa personalizada removida');
    } catch (err) {
      showToast(err.message);
    }
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
  if (btn.dataset.action === 'close-sheet') {
    closeSheet();
  } else if (btn.dataset.action === 'clear-note' && btn.dataset.id) {
    try {
      store.setNote(btn.dataset.id, '');
      closeSheet();
      render();
      showToast('Nota removida');
    } catch (err) {
      showToast(err.message);
    }
  } else if (btn.dataset.action === 'confirm-delete-power' && btn.dataset.id) {
    try {
      store.deletePowerLog(btn.dataset.id);
      if (ui.selectedPowerId === btn.dataset.id) ui.selectedPowerId = null;
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
  } else if (form.id === 'note-form') {
    store.setNote(form.dataset.id, fd.get('note'));
    closeSheet();
    render();
    showToast('Nota salva');
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
        showToast('Nova etapa adicionada');
      }
      closeSheet();
      render();
    } catch (err) {
      showToast(err.message);
    }
  } else if (form.id === 'reset-form') {
    store.resetState({
      clearNotesAndCustom: fd.get('clearNotesAndCustom') === 'on',
      clearPower: fd.get('clearPower') === 'on',
    });
    ui.expandedIds.clear();
    ui.selectedPowerId = null;
    closeSheet();
    render();
    showToast('Progresso reiniciado');
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
