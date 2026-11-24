function escapeSvg(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateBrShort(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!m) return String(isoDate || '');
  return `${m[3]}/${m[2]}`;
}

/**
 * Formats an integer power value using dots as thousand separators (pt-BR).
 * @param {number} power
 * @returns {string}
 */
export function formatPowerFull(power) {
  const n = Math.round(Number(power) || 0);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Formats a power number compactly (e.g. 24279151 -> "24,28M").
 * @param {number} power
 * @returns {string}
 */
export function formatPowerCompact(power) {
  const n = Number(power) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2).replace('.', ',')}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}K`;
  }
  return `${sign}${Math.round(abs)}`;
}

/**
 * Renders the circular progress gauge strictly from completedCount / total.
 */
export function renderProgressRingSVG({ completedCount, total, inProgressCount = 0 }) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeDone = Math.max(0, Math.min(safeTotal, Number(completedCount) || 0));
  const safeActive = Math.max(0, Number(inProgressCount) || 0);
  const pct = Math.round((safeDone / safeTotal) * 100);

  const size = 96;
  const cx = 48;
  const cy = 48;
  const r = 39;
  const circumference = 2 * Math.PI * r;
  const doneDash = (safeDone / safeTotal) * circumference;
  const activeDash = Math.min(circumference - doneDash, (safeActive / safeTotal) * circumference);

  return `
    <svg viewBox="0 0 ${size} ${size}" class="ring-svg" role="img" aria-label="Progresso ${pct}% concluído">
      <defs>
        <linearGradient id="ringDoneGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#34B882" />
          <stop offset="100%" stop-color="#5B9CF6" />
        </linearGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6.5" />
      ${
        activeDash > 0
          ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(91,156,246,0.55)" stroke-width="6.5"
               stroke-dasharray="${activeDash.toFixed(2)} ${circumference.toFixed(2)}"
               stroke-dashoffset="-${doneDash.toFixed(2)}"
               transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt" />`
          : ''
      }
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#ringDoneGrad)" stroke-width="6.5"
        stroke-dasharray="${doneDash.toFixed(2)} ${circumference.toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round" />
      <text x="${cx}" y="${cy - 1}" text-anchor="middle" fill="#F1F5F9" font-size="19" font-weight="700">${pct}%</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#94A3B8" font-size="10" font-weight="500">${safeDone}/${safeTotal}</text>
    </svg>
  `.trim();
}

/**
 * Renders horizontal SVG progress bars for each canonical front.
 */
export function renderFrontBarsSVG(byCategory) {
  const rows = Array.isArray(byCategory) ? byCategory : [];
  if (rows.length === 0) {
    return '<svg viewBox="0 0 340 48" width="100%"><text x="170" y="28" text-anchor="middle" fill="#94A3B8" font-size="12">Sem frentes para exibir</text></svg>';
  }

  const width = 340;
  const rowH = 38;
  const padTop = 8;
  const height = padTop + rows.length * rowH + 6;
  const barX = 12;
  const barW = 316;

  const itemsSvg = rows
    .map((item, idx) => {
      const y = padTop + idx * rowH;
      const total = Math.max(1, Number(item.total) || 1);
      const completed = Math.max(0, Number(item.completed) || 0);
      const inProgress = Math.max(0, Number(item.inProgress) || 0);
      const pct = Math.round((completed / total) * 100);
      const fillW = (completed / total) * barW;
      const activeW = Math.min(barW - fillW, (inProgress / total) * barW);

      return `
        <g>
          <text x="${barX}" y="${y + 12}" fill="#E2E8F0" font-size="11.5" font-weight="600">${escapeSvg(item.category)}</text>
          <text x="${barX + barW}" y="${y + 12}" text-anchor="end" fill="#94A3B8" font-size="11" font-variant-numeric="tabular-nums">${completed}/${total} (${pct}%)</text>
          <rect x="${barX}" y="${y + 18}" width="${barW}" height="6" rx="3" fill="rgba(255,255,255,0.07)" />
          ${
            activeW > 0
              ? `<rect x="${(barX + fillW).toFixed(2)}" y="${y + 18}" width="${activeW.toFixed(2)}" height="6" rx="3" fill="rgba(91,156,246,0.6)" />`
              : ''
          }
          ${
            fillW > 0
              ? `<rect x="${barX}" y="${y + 18}" width="${Math.max(6, fillW).toFixed(2)}" height="6" rx="3" fill="#34B882" />`
              : ''
          }
        </g>
      `;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" class="chart-svg" role="img" aria-label="Progresso por frente">${itemsSvg}</svg>`;
}

/**
 * Renders the chronological Power Total SVG line/area chart with touchable nodes.
 */
export function renderPowerLineSVG(powerHistory, selectedId = null) {
  const raw = Array.isArray(powerHistory) ? powerHistory : [];
  if (raw.length === 0) {
    return '<svg viewBox="0 0 340 120" width="100%" class="chart-svg"><text x="170" y="64" text-anchor="middle" fill="#94A3B8" font-size="12">Nenhum registro de Poder</text></svg>';
  }

  const sorted = [...raw].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const width = 340;
  const height = 186;
  const padL = 48;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const values = sorted.map((p) => Number(p.power) || 0);
  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const span = maxRaw - minRaw;
  const minVal = span === 0 ? Math.max(0, minRaw * 0.96) : minRaw - span * 0.15;
  const maxVal = span === 0 ? maxRaw * 1.04 : maxRaw + span * 0.15;
  const safeSpan = Math.max(1, maxVal - minVal);

  const coords = sorted.map((entry, idx) => {
    const x =
      sorted.length === 1
        ? padL + plotW / 2
        : padL + (idx / (sorted.length - 1)) * plotW;
    const y = padT + plotH - ((Number(entry.power) - minVal) / safeSpan) * plotH;
    return {
      entry,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    };
  });

  const activeId = selectedId || coords[coords.length - 1].entry.id;

  const gridLines = [0, 0.5, 1]
    .map((ratio) => {
      const gy = padT + plotH - ratio * plotH;
      const gVal = minVal + ratio * safeSpan;
      return `
        <line x1="${padL}" y1="${gy.toFixed(1)}" x2="${width - padR}" y2="${gy.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3" />
        <text x="${padL - 6}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end" fill="#64748B" font-size="9.5">${escapeSvg(formatPowerCompact(gVal))}</text>
      `;
    })
    .join('');

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaPath =
    coords.length > 1
      ? `${linePath} L ${coords[coords.length - 1].x} ${padT + plotH} L ${coords[0].x} ${padT + plotH} Z`
      : '';

  const labelIndices = new Set([0, coords.length - 1]);
  if (coords.length >= 4) labelIndices.add(Math.floor((coords.length - 1) / 2));

  const nodesSvg = coords
    .map((c, idx) => {
      const isSelected = c.entry.id === activeId;
      const dateLabel = labelIndices.has(idx)
        ? `<text x="${c.x}" y="${height - 10}" text-anchor="middle" fill="#94A3B8" font-size="9.5">${escapeSvg(formatDateBrShort(c.entry.date))}</text>`
        : '';
      return `
        <g class="power-node" data-power-id="${escapeSvg(c.entry.id)}" style="cursor:pointer">
          <circle cx="${c.x}" cy="${c.y}" r="18" fill="transparent" />
          ${isSelected ? `<circle cx="${c.x}" cy="${c.y}" r="9" fill="rgba(226,169,59,0.22)" />` : ''}
          <circle cx="${c.x}" cy="${c.y}" r="${isSelected ? 5 : 3.8}" fill="${isSelected ? '#E2A93B' : '#5B9CF6'}" stroke="#0D1117" stroke-width="1.5" />
          ${dateLabel}
        </g>
      `;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" class="chart-svg" role="img" aria-label="Curva de Poder Total">
      <defs>
        <linearGradient id="powerAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(91,156,246,0.26)" />
          <stop offset="100%" stop-color="rgba(91,156,246,0.01)" />
        </linearGradient>
      </defs>
      ${gridLines}
      ${areaPath ? `<path d="${areaPath}" fill="url(#powerAreaGrad)" />` : ''}
      ${coords.length > 1 ? `<path d="${linePath}" fill="none" stroke="#5B9CF6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />` : ''}
      ${nodesSvg}
    </svg>
  `.trim();
}

function toLocalDateKey(ts) {
  const s = String(ts || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Renders daily completed step pace bars over recent active days (or last N days).
 */
export function renderPaceBarsSVG(completedMap, days = 7) {
  const entries = Object.values(completedMap || {}).filter(Boolean);
  const countsByDate = new Map();
  for (const ts of entries) {
    const day = toLocalDateKey(ts);
    if (day) {
      countsByDate.set(day, (countsByDate.get(day) || 0) + 1);
    }
  }

  if (countsByDate.size === 0) {
    return '<svg viewBox="0 0 340 110" width="100%" class="chart-svg"><text x="170" y="58" text-anchor="middle" fill="#94A3B8" font-size="11.5">Conclua etapas para visualizar o ritmo diário</text></svg>';
  }

  const sortedDays = Array.from(countsByDate.keys()).sort().slice(-Math.max(1, days));
  const width = 340;
  const height = 136;
  const padL = 24;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxCount = Math.max(1, ...sortedDays.map((d) => countsByDate.get(d)));
  const slotW = plotW / sortedDays.length;
  const barW = Math.min(28, Math.max(12, slotW * 0.56));

  const barsSvg = sortedDays
    .map((day, idx) => {
      const count = countsByDate.get(day);
      const bh = Math.max(4, (count / maxCount) * plotH);
      const bx = padL + idx * slotW + (slotW - barW) / 2;
      const by = padT + plotH - bh;
      return `
        <g>
          <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="#34B882" />
          <text x="${(bx + barW / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" fill="#E2E8F0" font-size="10" font-weight="600">${count}</text>
          <text x="${(bx + barW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="#94A3B8" font-size="9.5">${escapeSvg(formatDateBrShort(day))}</text>
        </g>
      `;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" class="chart-svg" role="img" aria-label="Ritmo de etapas concluídas">
      <line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.08)" />
      ${barsSvg}
    </svg>
  `.trim();
}
