// Aderência (0–100): quanto o anúncio se encaixa no que você procura.
// Obrigatórios (60%): ok = cheio; pendente = metade; violado = zero; item confirmado só pela ficha vale um pouco menos.
// Preferências (40%): preço menor, abaixo da FIPE, km menor, ano mais novo, mais perto, ADAS (quando desejável),
// consumo e porta-malas (quando há ficha técnica). A soma é normalizada para 0–100.
// Descartados ficam limitados a 39 e sempre abaixo dos demais.
import { DISCARDED } from "./classify.js";

const clamp = (v) => Math.max(0, Math.min(1, v));
const QUALITY = { oficial: 0.95, "concessionária": 0.9, "oficial/secundária": 0.9, "secundária": 0.85 };
const REQ_ALL = ["price", "year_model", "km", "transmission", "condition", "seller", "distance", "adas", "inducao", "android_auto_sem_fio"];
const REQ_LABEL = { price: "Preço", year_model: "Ano-modelo", km: "Quilometragem", transmission: "Câmbio", condition: "Tipo",
  distance: "Distância", seller: "Vendedor", adas: "ADAS", inducao: "Carregador por indução", android_auto_sem_fio: "Android Auto sem fio" };

export function scoreListing(l, criteria, spec = null) {
  const parts = [];
  const reasons = Object.fromEntries((l.reasons || []).map((r) => [r.field, r]));
  const REQ = REQ_ALL.filter((f) => reasons[f] && reasons[f].level !== "info");
  const fichaVal = (f) => QUALITY[spec?.source?.quality] ?? 0.85;
  // 1) obrigatórios (60)
  for (const f of REQ) {
    const r = reasons[f]; let v = 0, note = "não avaliado";
    if (r?.level === "ok") {
      v = 1; note = "atende";
      if (l.checks?.[f]?.method === "ficha") { v = fichaVal(f); note = `atende pela ficha (${spec?.source?.quality || "fonte"})`; }
    } else if (r?.level === "pending") { v = 0.5; note = "pendente"; }
    else if (r?.level === "fail") { v = 0; note = "não atende"; }
    parts.push({ group: "Obrigatórios", label: REQ_LABEL[f], pts: (60 / REQ.length) * v, max: 60 / REQ.length, note });
  }
  // 2) preferências (pesos relativos; normalizados para 40)
  const c = criteria, t = spec?.tech, prefs = [];
  const pref = (label, max, frac, note) => prefs.push({ group: "Preferências", label, raw: frac == null ? 0 : max * clamp(frac), rawMax: max, note });
  const maxP = c.max_price ?? (l.price || 1), minP = c.min_price ?? Math.round(maxP * 0.7);
  pref("Preço (quanto menor, melhor)", 12, l.price == null ? null : (maxP - l.price) / Math.max(1, maxP - minP), l.price == null ? "sem preço" : null);
  const fd = fipeDiscount(l);
  pref("Abaixo da FIPE", 8, fd == null ? null : fd / 10, fd == null ? "FIPE não informada" : fd > 0 ? `${fd.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% abaixo` : `${Math.abs(fd).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% acima`);
  const maxK = c.max_km ?? 100000;
  pref("Km (quanto menor, melhor)", 10, l.km == null ? null : 1 - l.km / Math.max(1, maxK), l.km == null ? "sem km" : null);
  const span = Math.max(1, (c.year_max ?? 2025) - (c.year_min ?? 2020));
  pref("Ano-modelo (mais novo, melhor)", 6, l.year_model == null ? null : (l.year_model - (c.year_min ?? 2020)) / span, null);
  const d = l.distance || {};
  pref("Distância (mais perto, melhor)", 4, d.km == null ? null : 1 - d.km / Math.max(1, c.max_distance_km ?? 60), d.km == null ? "não calculada" : null);
  if (!c.adas_required) {
    const a = l.checks?.adas || {};
    pref("ADAS (desejável)", 6, a.state === "confirmado" ? (a.method === "ficha" ? fichaVal("adas") : 1) : 0,
      a.state === "confirmado" ? (a.detail || "tem") : a.state === "ausente" ? "não tem" : "não comprovado");
  }
  pref("Consumo na cidade (gasolina)", 5, t?.city_g ? (t.city_g - 9) / 5 : null, t?.city_g ? `${t.city_g} km/l` : "sem ficha técnica");
  pref("Porta-malas", 3, t?.trunk_l ? (t.trunk_l - 250) / 250 : null, t?.trunk_l ? `${t.trunk_l} L` : "sem ficha técnica");
  const rawMax = prefs.reduce((a, p) => a + p.rawMax, 0);
  for (const p of prefs) parts.push({ group: p.group, label: p.label, pts: (p.raw / rawMax) * 40, max: (p.rawMax / rawMax) * 40, note: p.note });

  let total = Math.round(parts.reduce((a, p) => a + p.pts, 0));
  if (l.status === DISCARDED) total = Math.min(total, 39);
  const level = l.status === DISCARDED ? "baixa" : total >= 80 ? "excelente" : total >= 65 ? "boa" : total >= 50 ? "regular" : "baixa";
  return { total, level, parts };
}

/** % abaixo da FIPE (positivo = abaixo; negativo = acima). null se faltar preço ou FIPE. */
export function fipeDiscount(l) {
  if (!l?.price || !l?.fipe) return null;
  return Math.round(((l.fipe - l.price) / l.fipe) * 1000) / 10;
}

export const LEVEL_LABEL = { excelente: "Excelente", boa: "Boa", regular: "Regular", baixa: "Baixa" };

/** Ordem: aprovados, pendentes, descartados; dentro de cada grupo, pela nota de aderência. */
const ORDER = { aprovado: 0, pendente: 1, descartado: 2 };
export const byAdherence = (a, b) => ((ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)) || (b.score?.total ?? 0) - (a.score?.total ?? 0);
