// Nota (0–100): compara SÓ os diferenciais entre carros que passam no filtro.
// Pré-requisitos (preço máx., ano, km máx., câmbio, tipo, vendedor, distância, indução, Android Auto sem fio)
// não pontuam: eles decidem a aba (aprovado / pendente / descartado). Descartado não tem nota.
// Pendências não mudam a nota (ficam na aba Pendentes e nas etiquetas do cartão).
// Pesos (normalizados para 100): preço x FIPE 30 · km 20 · ADAS 15 (se desejável) · ano-modelo 15 · preço 10 ·
// único dono 5 · revisões na concessionária 5 · garantia de fábrica 5 · consumo 5 · porta-malas 5.
import { DISCARDED } from "./classify.js";

const clamp = (v) => Math.max(0, Math.min(1, v));
const fmt1 = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function scoreListing(l, criteria, spec = null, now = new Date()) {
  if (l.status === DISCARDED) return { total: null, level: "nd", parts: [] };
  const c = criteria, t = spec?.tech, parts = [];
  const add = (label, max, frac, note) => parts.push({ group: "Diferenciais", label, pts: frac == null ? 0 : max * clamp(frac), max, note });
  // preço x FIPE: 10%+ abaixo = 30; no valor (±1%) = 10; acima = 0
  const fd = fipeDiscount(l);
  add("Preço x FIPE", 30, fd == null ? null : fd >= 0 ? (10 + 20 * Math.min(fd, 10) / 10) / 30 : fd > -1 ? 10 / 30 : 0,
    fd == null ? "FIPE não informada" : Math.abs(fd) < 1 ? "no valor da FIPE" : fd > 0 ? `${fmt1(fd)}% abaixo` : `${fmt1(-fd)}% acima`);
  const maxK = c.max_km ?? 100000;
  add("Km (menos é melhor)", 20, l.km == null ? null : 1 - l.km / Math.max(1, maxK), l.km == null ? "sem km" : `${l.km.toLocaleString("pt-BR")} km de até ${maxK.toLocaleString("pt-BR")}`);
  if (!c.adas_required) {
    const a = l.checks?.adas || {};
    add("ADAS (desejável)", 15, a.state === "confirmado" ? 1 : 0, a.state === "confirmado" ? (a.detail || "tem") : a.state === "ausente" ? "não tem" : "não comprovado");
  }
  const age = l.year_model == null ? null : now.getFullYear() - l.year_model;
  add("Ano-modelo (mais novo é melhor)", 15, age == null ? null : 1 - age / 4, age == null ? "sem ano" : age <= 0 ? "do ano" : `${age} ano(s) de uso`);
  const maxP = c.max_price ?? (l.price || 1), minP = c.min_price ?? Math.round(maxP * 0.7);
  add("Preço (mais barato é melhor)", 10, l.price == null ? null : (maxP - l.price) / Math.max(1, maxP - minP), l.price == null ? "sem preço" : null);
  const f = l.features || [];
  add("Único dono", 5, f.includes("unico_dono") ? 1 : 0, f.includes("unico_dono") ? "sim" : "não informado");
  add("Revisões na concessionária", 5, f.includes("revisoes_concessionaria") ? 1 : 0, f.includes("revisoes_concessionaria") ? "sim" : "não informado");
  add("Garantia de fábrica", 5, f.includes("garantia_fabrica") ? 1 : 0, f.includes("garantia_fabrica") ? "sim" : "não informado");
  add("Consumo na cidade (gasolina)", 5, t?.city_g ? (t.city_g - 9) / 5 : null, t?.city_g ? `${fmt1(t.city_g)} km/l` : "sem ficha técnica");
  add("Porta-malas", 5, t?.trunk_l ? (t.trunk_l - 250) / 250 : null, t?.trunk_l ? `${t.trunk_l} L` : "sem ficha técnica");
  const max = parts.reduce((a, p) => a + p.max, 0);
  for (const p of parts) { p.pts = (p.pts / max) * 100; p.max = (p.max / max) * 100; } // normaliza para 100 (ex.: ADAS obrigatório)
  const total = Math.round(parts.reduce((a, p) => a + p.pts, 0));
  const level = total >= 75 ? "excelente" : total >= 55 ? "boa" : total >= 35 ? "regular" : "baixa";
  return { total, level, parts };
}

/** % abaixo da FIPE (positivo = abaixo; negativo = acima). null se faltar preço ou FIPE. */
export function fipeDiscount(l) {
  if (!l?.price || !l?.fipe) return null;
  return Math.round(((l.fipe - l.price) / l.fipe) * 1000) / 10;
}

export const LEVEL_LABEL = { excelente: "Excelente", boa: "Boa", regular: "Regular", baixa: "Baixa", nd: "Sem nota" };

/** Ordem: aprovados, pendentes, descartados; dentro de cada grupo, pela nota de aderência. */
const ORDER = { aprovado: 0, pendente: 1, descartado: 2 };
export const byAdherence = (a, b) => ((ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)) || (b.score?.total ?? -1) - (a.score?.total ?? -1);
