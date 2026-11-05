// Nota (0–100): compara SÓ os diferenciais entre carros que passam no filtro.
// Pré-requisitos (preço máx., ano, km máx., câmbio, tipo, vendedor, distância, indução, Android Auto sem fio)
// não pontuam: eles decidem a aba (aprovado / pendente / descartado). Descartado não tem nota.
// Calibragem de 05/11/2026 (aprovada pelo usuário): escalas que não zeram dentro do filtro e dado ausente fora da conta.
// Pesos (normalizados para 100 sobre os itens com dado): preço x FIPE 25 · km 20 · ADAS 15 (se desejável) ·
// ano-modelo 15 · preço 10 · único dono 5 · revisões na concessionária 5 · garantia de fábrica 5 ·
// consumo 5 e porta-malas 5 (só quando a ficha informa).
import { DISCARDED } from "./classify.js";

const clamp = (v) => Math.max(0, Math.min(1, v));
const fmt1 = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function scoreListing(l, criteria, spec = null, now = new Date()) {
  if (l.status === DISCARDED) return { total: null, level: "nd", parts: [] };
  const c = criteria, t = spec?.tech, parts = [];
  // frac null = sem dado: o item sai da conta (não vira zero)
  const add = (label, max, frac, note) => parts.push({ group: "Diferenciais", label, pts: frac == null ? 0 : max * clamp(frac), max, note, nd: frac == null });
  // preço x FIPE: 10%+ abaixo = 100% · no valor = 60% · 10%+ acima = 0
  const fd = fipeDiscount(l);
  add("Preço x FIPE", 25, fd == null ? null : fd >= 0 ? 0.6 + 0.4 * Math.min(fd, 10) / 10 : 0.6 + 0.6 * Math.max(fd, -10) / 10,
    fd == null ? "FIPE não informada" : Math.abs(fd) < 1 ? "no valor da FIPE" : fd > 0 ? `${fmt1(fd)}% abaixo` : `${fmt1(-fd)}% acima`);
  // km: 0 km = 100% · no limite do filtro = 40%
  const maxK = c.max_km ?? 100000;
  add("Km (menos é melhor)", 20, l.km == null ? null : 1 - 0.6 * l.km / Math.max(1, maxK), l.km == null ? "sem km" : `${l.km.toLocaleString("pt-BR")} km de até ${maxK.toLocaleString("pt-BR")}`);
  if (!c.adas_required) {
    const a = l.checks?.adas || {};
    // tem = 100% · não comprovado = 40% · não tem = 0
    add("ADAS (desejável)", 15, a.state === "confirmado" ? 1 : a.state === "ausente" ? 0 : 0.4,
      a.state === "confirmado" ? (a.detail || "tem") : a.state === "ausente" ? "não tem" : "não comprovado (meio-termo)");
  }
  // ano-modelo: perde 15% por ano de uso
  const age = l.year_model == null ? null : now.getFullYear() - l.year_model;
  add("Ano-modelo (mais novo é melhor)", 15, age == null ? null : 1 - 0.15 * Math.max(0, age), age == null ? "sem ano" : age <= 0 ? "do ano" : `${age} ano(s) de uso`);
  // preço: 30% abaixo do limite (ou menos) = 100% · no limite do filtro = 40%
  const maxP = c.max_price ?? null;
  add("Preço (mais barato é melhor)", 10, l.price == null || !maxP ? null : 0.4 + 0.6 * (maxP - l.price) / (maxP * 0.3),
    l.price == null ? "sem preço" : maxP ? `${Math.round((l.price / maxP) * 100)}% do limite` : "sem limite de preço no filtro");
  const f = l.features || [];
  add("Único dono", 5, f.includes("unico_dono") ? 1 : 0, f.includes("unico_dono") ? "sim" : "não informado");
  add("Revisões na concessionária", 5, f.includes("revisoes_concessionaria") ? 1 : 0, f.includes("revisoes_concessionaria") ? "sim" : "não informado");
  add("Garantia de fábrica", 5, f.includes("garantia_fabrica") ? 1 : 0, f.includes("garantia_fabrica") ? "sim" : "não informado");
  add("Consumo na cidade (gasolina)", 5, t?.city_g ? (t.city_g - 9) / 5 : null, t?.city_g ? `${fmt1(t.city_g)} km/l` : "sem dado na ficha (fora da conta)");
  add("Porta-malas", 5, t?.trunk_l ? (t.trunk_l - 250) / 250 : null, t?.trunk_l ? `${t.trunk_l} L` : "sem dado na ficha (fora da conta)");
  const max = parts.filter((p) => !p.nd).reduce((a, p) => a + p.max, 0) || 1;
  for (const p of parts) { p.pts = p.nd ? 0 : (p.pts / max) * 100; p.max = p.nd ? 0 : (p.max / max) * 100; } // normaliza para 100 sobre os itens com dado
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
