import {
  BASE_STEPS,
  CATEGORIES,
  INITIAL_POWER_ENTRY,
  mapFrontToCategory,
} from './data.js';

export const STORAGE_KEY = 'pc_evolution_tracker_v1';

/**
 * Creates an in-memory storage adapter compatible with Web Storage API for tests.
 * @param {Record<string, string>} [initial]
 */
export function createMemoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function cloneDefaultState() {
  return {
    schemaVersion: 1,
    completed: {},
    inProgress: {},
    notes: {},
    customSteps: [],
    powerHistory: [{ ...INITIAL_POWER_ENTRY }],
  };
}

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function sanitizeStringRecord(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k === 'string' && typeof v === 'string' && v.length > 0) {
      out[k] = v;
    }
  }
  return out;
}

function sortPowerHistory(list) {
  return [...list].sort((a, b) => {
    const cmp = String(a.date).localeCompare(String(b.date));
    if (cmp !== 0) return cmp;
    if (a.id === INITIAL_POWER_ENTRY.id) return -1;
    if (b.id === INITIAL_POWER_ENTRY.id) return 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

function normalizeCustomStep(raw) {
  const mission = String(raw.mission || '').trim();
  const front = String(raw.front || 'Geral').trim() || 'Geral';
  const category = CATEGORIES.includes(raw.category)
    ? raw.category
    : mapFrontToCategory(front);
  return {
    id: String(raw.id),
    insertAfterId: String(raw.insertAfterId || 'base-67'),
    mission,
    front,
    category,
    deadline: String(raw.deadline || 'A definir').trim() || 'A definir',
    cost: String(raw.cost || '—').trim() || '—',
    gains: String(raw.gains || '—').trim() || '—',
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

function normalizePowerEntry(raw) {
  const power = Number(raw.power);
  const officeLevel =
    raw.officeLevel === null || raw.officeLevel === undefined || raw.officeLevel === ''
      ? null
      : Number(raw.officeLevel);
  return {
    id: String(raw.id),
    date: String(raw.date),
    power,
    officeLevel: Number.isFinite(officeLevel) && officeLevel > 0 ? officeLevel : null,
    note: String(raw.note || '').trim(),
  };
}

/**
 * Parses and validates an exported JSON backup string strictly before touching live state.
 * @param {string} jsonString
 */
export function parseAndValidateBackup(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Arquivo inválido: JSON inválido ou corrompido.');
  }
  if (!isPlainObject(parsed)) {
    throw new Error('Estrutura de backup inválida.');
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Versão de backup incompatível: ${parsed.schemaVersion}.`);
  }
  if (!isPlainObject(parsed.completed) || !isPlainObject(parsed.notes)) {
    throw new Error('Campos completed ou notes inválidos no backup.');
  }
  if (parsed.inProgress !== undefined && !isPlainObject(parsed.inProgress)) {
    throw new Error('Campo inProgress inválido no backup.');
  }
  if (!Array.isArray(parsed.customSteps) || !Array.isArray(parsed.powerHistory)) {
    throw new Error('Campos customSteps ou powerHistory inválidos no backup.');
  }

  const completed = sanitizeStringRecord(parsed.completed);
  const inProgress = sanitizeStringRecord(parsed.inProgress || {});
  // Enforce mutual exclusivity: completed takes precedence over inProgress
  for (const id of Object.keys(completed)) {
    delete inProgress[id];
  }
  const notes = sanitizeStringRecord(parsed.notes);

  const customSteps = parsed.customSteps.map((item) => {
    if (!isPlainObject(item) || !item.id || !String(item.mission || '').trim()) {
      throw new Error('Etapa personalizada inválida encontrada no backup.');
    }
    return normalizeCustomStep(item);
  });

  const powerHistory = parsed.powerHistory.map((item) => {
    if (
      !isPlainObject(item) ||
      !item.id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ||
      !Number.isFinite(Number(item.power)) ||
      Number(item.power) <= 0
    ) {
      throw new Error('Registro de Poder inválido encontrado no backup.');
    }
    return normalizePowerEntry(item);
  });

  return {
    schemaVersion: 1,
    completed,
    inProgress,
    notes,
    customSteps,
    powerHistory: sortPowerHistory(powerHistory),
  };
}

/**
 * Merges base 67 steps with customSteps preserving deterministic N.1/N.2 numbering.
 * @param {ReturnType<typeof cloneDefaultState>} state
 */
export function getMergedSteps(state) {
  const afterMap = new Map();
  for (const cs of state.customSteps) {
    const key = cs.insertAfterId || 'base-67';
    if (!afterMap.has(key)) afterMap.set(key, []);
    afterMap.get(key).push(cs);
  }

  const visitedIds = new Set();
  const result = [];

  function resolveStatus(id) {
    if (state.completed[id]) return 'completed';
    if (state.inProgress[id]) return 'in_progress';
    return 'pending';
  }

  function appendCustomTree(parentId, baseNumberLabel, subCounter) {
    const children = afterMap.get(parentId) || [];
    for (const cs of children) {
      if (visitedIds.has(cs.id)) continue;
      visitedIds.add(cs.id);
      subCounter.count += 1;
      const status = resolveStatus(cs.id);
      result.push({
        ...cs,
        step: null,
        displayNumber: `${baseNumberLabel}.${subCounter.count}`,
        isCustom: true,
        status,
        completedAt: state.completed[cs.id] || null,
        inProgressAt: state.inProgress[cs.id] || null,
        note: state.notes[cs.id] || '',
      });
      appendCustomTree(cs.id, baseNumberLabel, subCounter);
    }
  }

  // Optional steps inserted at very top before base-1
  appendCustomTree('__start__', '0', { count: 0 });

  for (const base of BASE_STEPS) {
    const status = resolveStatus(base.id);
    result.push({
      ...base,
      displayNumber: String(base.step),
      isCustom: false,
      status,
      completedAt: state.completed[base.id] || null,
      inProgressAt: state.inProgress[base.id] || null,
      note: state.notes[base.id] || '',
    });
    appendCustomTree(base.id, String(base.step), { count: 0 });
  }

  // Safety net: append any unlinked custom steps at the end rather than dropping them
  let orphanIdx = 0;
  for (const cs of state.customSteps) {
    if (!visitedIds.has(cs.id)) {
      orphanIdx += 1;
      const status = resolveStatus(cs.id);
      result.push({
        ...cs,
        step: null,
        displayNumber: `67.${orphanIdx}`,
        isCustom: true,
        status,
        completedAt: state.completed[cs.id] || null,
        inProgressAt: state.inProgress[cs.id] || null,
        note: state.notes[cs.id] || '',
      });
    }
  }

  return result;
}

/**
 * Filters merged steps by status, canonical category, and search query.
 */
export function filterSteps(
  steps,
  { statusFilter = 'all', categoryFilter = 'all', searchQuery = '' } = {}
) {
  const q = String(searchQuery || '').trim().toLowerCase();
  return steps.filter((s) => {
    if (statusFilter === 'pending' && s.status !== 'pending') return false;
    if (statusFilter === 'in_progress' && s.status !== 'in_progress') return false;
    if (statusFilter === 'completed' && s.status !== 'completed') return false;
    if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
    if (q) {
      const hay = `${s.displayNumber} ${s.mission} ${s.front} ${s.cost} ${s.gains} ${s.note}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Computes completion counts, percentages, category breakdown and latest power metrics.
 * @param {ReturnType<typeof cloneDefaultState>} state
 */
export function getStats(state) {
  const steps = getMergedSteps(state);
  const total = steps.length;
  let completedCount = 0;
  let inProgressCount = 0;

  const catMap = new Map(
    CATEGORIES.map((category) => [
      category,
      { category, total: 0, completed: 0, inProgress: 0, percent: 0 },
    ])
  );

  for (const item of steps) {
    const bucket = catMap.get(item.category) || catMap.get('Recursos & Eventos');
    bucket.total += 1;
    if (item.status === 'completed') {
      completedCount += 1;
      bucket.completed += 1;
    } else if (item.status === 'in_progress') {
      inProgressCount += 1;
      bucket.inProgress += 1;
    }
  }

  const byCategory = Array.from(catMap.values()).map((b) => ({
    ...b,
    percent: b.total > 0 ? Math.round((b.completed / b.total) * 100) : 0,
  }));

  const sortedPower = sortPowerHistory(state.powerHistory);
  const firstPower = sortedPower[0] || INITIAL_POWER_ENTRY;
  const latestPower = sortedPower[sortedPower.length - 1] || INITIAL_POWER_ENTRY;
  const powerDelta = latestPower.power - firstPower.power;

  return {
    total,
    completedCount,
    inProgressCount,
    pendingCount: total - completedCount - inProgressCount,
    percent: total > 0 ? Math.round((completedCount / total) * 100) : 0,
    byCategory,
    latestPower,
    firstPower,
    powerDelta,
  };
}

/**
 * Creates a state store bound to a Web Storage backend.
 * @param {Storage | ReturnType<typeof createMemoryBackend>} [backend]
 */
export function createStore(backend = globalThis.localStorage) {
  function save(state) {
    const normalized = {
      schemaVersion: 1,
      completed: { ...state.completed },
      inProgress: { ...state.inProgress },
      notes: { ...state.notes },
      customSteps: state.customSteps.map((s) => ({ ...s })),
      powerHistory: sortPowerHistory(state.powerHistory),
    };
    try {
      backend.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      throw new Error('Não foi possível salvar no armazenamento local (espaço cheio ou bloqueado).');
    }
    return normalized;
  }

  function loadState() {
    let raw = null;
    try {
      raw = backend.getItem(STORAGE_KEY);
    } catch {
      return cloneDefaultState();
    }
    if (!raw) {
      try {
        return save(cloneDefaultState());
      } catch {
        return cloneDefaultState();
      }
    }
    try {
      return parseAndValidateBackup(raw);
    } catch {
      return cloneDefaultState();
    }
  }

  function setStepStatus(id, status) {
    const state = loadState();
    const now = new Date().toISOString();
    if (status === 'completed') {
      state.completed[id] = now;
      delete state.inProgress[id];
    } else if (status === 'in_progress') {
      state.inProgress[id] = now;
      delete state.completed[id];
    } else {
      delete state.completed[id];
      delete state.inProgress[id];
    }
    return save(state);
  }

  function setNote(id, text) {
    const state = loadState();
    const trimmed = String(text || '').trim();
    if (trimmed) {
      state.notes[id] = trimmed;
    } else {
      delete state.notes[id];
    }
    return save(state);
  }

  function addCustomStep({ insertAfterId, mission, front, category, deadline, cost, gains }) {
    const trimmedMission = String(mission || '').trim();
    if (!trimmedMission) {
      throw new Error('A descrição da missão é obrigatória.');
    }
    const state = loadState();
    const id = `custom-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const newStep = normalizeCustomStep({
      id,
      insertAfterId: insertAfterId || 'base-67',
      mission: trimmedMission,
      front,
      category,
      deadline,
      cost,
      gains,
      createdAt: new Date().toISOString(),
    });
    state.customSteps.push(newStep);
    const saved = save(state);
    return { state: saved, newStep };
  }

  function updateCustomStep(id, patch) {
    const state = loadState();
    const idx = state.customSteps.findIndex((s) => s.id === id);
    if (idx === -1) {
      throw new Error('Etapa personalizada não encontrada.');
    }
    const updated = normalizeCustomStep({
      ...state.customSteps[idx],
      ...patch,
      id,
    });
    if (!updated.mission) {
      throw new Error('A descrição da missão é obrigatória.');
    }
    state.customSteps[idx] = updated;
    return save(state);
  }

  function deleteCustomStep(id) {
    const state = loadState();
    const target = state.customSteps.find((s) => s.id === id);
    if (!target) {
      return state;
    }
    // Reparent any child custom steps pointing to the deleted step
    for (const cs of state.customSteps) {
      if (cs.insertAfterId === id) {
        cs.insertAfterId = target.insertAfterId;
      }
    }
    state.customSteps = state.customSteps.filter((s) => s.id !== id);
    delete state.completed[id];
    delete state.inProgress[id];
    delete state.notes[id];
    return save(state);
  }

  function addPowerLog({ date, power, officeLevel, note }) {
    const numericPower = Number(power);
    if (!Number.isFinite(numericPower) || numericPower <= 0) {
      throw new Error('Informe um valor de Poder válido maior que zero.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      throw new Error('Informe uma data válida (AAAA-MM-DD).');
    }
    const state = loadState();
    const entry = normalizePowerEntry({
      id: `pwr-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      date,
      power: Math.round(numericPower),
      officeLevel,
      note,
    });
    state.powerHistory.push(entry);
    return save(state);
  }

  function deletePowerLog(id) {
    const state = loadState();
    if (state.powerHistory.length <= 1) {
      throw new Error('Mantenha ao menos um registro de Poder no histórico.');
    }
    state.powerHistory = state.powerHistory.filter((item) => item.id !== id);
    return save(state);
  }

  function exportBackup(state = loadState()) {
    return JSON.stringify(state, null, 2);
  }

  function importBackup(jsonString) {
    const validated = parseAndValidateBackup(jsonString);
    return save(validated);
  }

  function resetState({ clearNotesAndCustom = false, clearPower = false } = {}) {
    const current = loadState();
    const next = {
      schemaVersion: 1,
      completed: {},
      inProgress: {},
      notes: clearNotesAndCustom ? {} : { ...current.notes },
      customSteps: clearNotesAndCustom ? [] : current.customSteps.map((s) => ({ ...s })),
      powerHistory: clearPower ? [{ ...INITIAL_POWER_ENTRY }] : [...current.powerHistory],
    };
    return save(next);
  }

  return {
    loadState,
    setStepStatus,
    setNote,
    addCustomStep,
    updateCustomStep,
    deleteCustomStep,
    addPowerLog,
    deletePowerLog,
    getMergedSteps,
    getStats,
    exportBackup,
    parseAndValidateBackup,
    importBackup,
    resetState,
  };
}
