// Roteiro de visitas às lojas: ordem que cabe no horário de funcionamento de cada uma, saindo da origem no dia/hora escolhidos.
// Lógica pura (testável): recebe a matriz de tempos de viagem já calculada (minutos) e os horários de cada loja.

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export const DAY_PT = { Su: "dom", Mo: "seg", Tu: "ter", We: "qua", Th: "qui", Fr: "sex", Sa: "sáb" };
/** Horário típico de loja/concessionária na Grande SP quando o mapa não informa (o usuário pode corrigir por loja). */
export const DEFAULT_HOURS = "Mo-Fr 09:00-18:00; Sa 09:00-14:00";

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };
export const fmtMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

/**
 * Lê o subconjunto comum do formato opening_hours do OpenStreetMap:
 * "Mo-Fr 09:00-18:00; Sa 09:00-13:00", "Mo-Sa 08:00-12:00,13:00-18:00", "Mo,We 10:00-16:00", "24/7", "Su off".
 * Devolve { Mo: [[540,1080]], ... } ou null se não entender.
 */
export function parseHours(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  const out = Object.fromEntries(DAYS.map((d) => [d, []]));
  if (/^24\/7$/.test(s)) { for (const d of DAYS) out[d] = [[0, 1440]]; return out; }
  let understood = false;
  for (const rule of s.split(";").map((x) => x.trim()).filter(Boolean)) {
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)\s+(.+)$/);
    if (!m) continue;
    const days = new Set();
    for (const part of m[1].split(",").filter(Boolean)) {
      const [a, b] = part.split("-");
      if (!b) { days.add(a); continue; }
      let i = DAYS.indexOf(a); const j = DAYS.indexOf(b);
      for (let k = 0; k < 7; k++) { days.add(DAYS[i]); if (i === j) break; i = (i + 1) % 7; }
    }
    const spec = m[2].trim();
    if (/^(off|closed)$/i.test(spec)) { for (const d of days) out[d] = []; understood = true; continue; }
    const ranges = [];
    for (const r of spec.split(",")) {
      const t = r.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (t) ranges.push([toMin(t[1]), toMin(t[2]) || 1440]);
    }
    if (!ranges.length) continue;
    for (const d of days) out[d] = ranges;
    understood = true;
  }
  return understood ? out : null;
}

/** Faixas de horário do dia da semana da data (0=domingo). */
export const hoursOn = (parsed, dow) => (parsed ? parsed[DAYS[dow]] || [] : []);
export const hoursText = (parsed, dow) => { const r = hoursOn(parsed, dow); return r.length ? r.map(([a, b]) => `${fmtMin(a)}–${fmtMin(b)}`).join(", ") : "fechada"; };

/** Simula uma ordem: chega, espera abrir se preciso, fica `visit` minutos. Visita só conta se terminar antes de fechar. */
function simulate(order, stops, matrix, startMin, dow, visit, back) {
  let t = startMin, at = 0, ok = 0, wait = 0;
  const legs = [];
  for (const i of order) {
    const s = stops[i];
    const travel = matrix.min[at][i + 1];
    let arrive = t + travel, start = arrive, status = "ok";
    const win = hoursOn(s.hours, dow).find(([a, b]) => arrive < b && Math.max(arrive, a) + visit <= b);
    if (!hoursOn(s.hours, dow).length) status = "fechada no dia";
    else if (!win) status = "chega depois do fechamento";
    else { start = Math.max(arrive, win[0]); wait += start - arrive; ok++; }
    const leave = status === "ok" ? start + visit : arrive; // se não dá para visitar, segue direto
    legs.push({ i, arrive, start, leave, travel, km: matrix.km[at][i + 1], status, wait: start - arrive });
    t = leave; at = i + 1;
  }
  const backMin = back ? matrix.min[at][0] : 0;
  return { legs, ok, wait, end: t + backMin, backMin, backKm: back ? matrix.km[at][0] : 0 };
}

function* permutations(a) {
  if (a.length <= 1) { yield a.slice(); return; }
  for (let i = 0; i < a.length; i++) for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...p];
}

/**
 * stops: [{ id, hours (parseHours) }]; matrix: { min, km } (N+1)x(N+1), índice 0 = origem;
 * date: Date do dia (usa só o dia da semana); startMin: minutos desde 00:00; visit: minutos em cada loja.
 * Escolhe a ordem que visita mais lojas dentro do horário e, empatando, termina mais cedo (até 8 lojas: todas as ordens; acima disso, busca por trocas).
 */
export function planRoute({ stops, matrix, date, startMin, visit = 40, back = true }) {
  const dow = date.getDay();
  const idx = stops.map((_, i) => i);
  let best = null;
  const better = (a, b) => !b || a.ok > b.ok || (a.ok === b.ok && (a.end < b.end || (a.end === b.end && a.wait < b.wait)));
  if (idx.length <= 8) for (const p of permutations(idx)) { const r = simulate(p, stops, matrix, startMin, dow, visit, back); if (better(r, best)) best = r; }
  else { // muitas lojas: vizinho mais próximo + melhoria por trocas (2-opt e troca de pares) até não melhorar
    const left = new Set(idx); let order = [], at = 0;
    while (left.size) { const next = [...left].sort((a, b) => matrix.min[at][a + 1] - matrix.min[at][b + 1])[0]; order.push(next); left.delete(next); at = next + 1; }
    best = simulate(order, stops, matrix, startMin, dow, visit, back);
    for (let improved = true, guard = 0; improved && guard < 200; guard++) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
        for (const cand of [[...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)],
          order.map((x, k) => (k === i ? order[j] : k === j ? order[i] : x))]) {
          const r = simulate(cand, stops, matrix, startMin, dow, visit, back);
          if (better(r, best)) { best = r; order = cand; improved = true; }
        }
      }
    }
  }
  const km = best.legs.reduce((s, l) => s + (l.km || 0), 0) + (best.backKm || 0);
  return { ...best, dow, km: Math.round(km * 10) / 10 };
}
