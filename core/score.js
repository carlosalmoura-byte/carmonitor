// Aderência (0–100): quanto o anúncio se encaixa no que você procura.
// 60 pts — critérios obrigatórios (ok = cheio; pendente = metade; violado = zero; item pela ficha vale um pouco menos)
// 40 pts — preferências: preço menor, km menor, ano mais novo, mais perto, consumo e porta-malas (quando há ficha técnica)
// Descartados ficam limitados a 39 e sempre abaixo dos demais.
import { DISCARDED } from "./classify.js";

const clamp = (v) => Math.max(0, Math.min(1, v));
const QUALITY = { oficial: 0.95, "concessionária": 0.9, "oficial/secundária": 0.9, "secundária": 0.85 };
const REQ = ["price", "year_model", "km", "transmission", "condition", "distance", "adas", "inducao", "android_auto_sem_fio"];
const REQ_LABEL = { price: "Preço", year_model: "Ano-modelo", km: "Quilometragem", transmission: "Câmbio", condition: "Tipo",
  distance: "Distância", adas: "ADAS", inducao: "Carregador por indução", android_auto_sem_fio: "Android Auto sem fio" };

export function scoreListing(l, criteria, spec = null) {
  const parts = [];
  const reasons = Object.fromEntries((l.reasons || []).map((r) => [r.field, r]));
  // 1) obrigatórios
  let req = 0;
  for (const f of REQ) {
    const r = reasons[f]; let v = 0, note = "não avaliado";
    if (r?.level === "ok") {
      v = 1; note = "atende";
      const c = l.checks?.[f];
      if (c?.method === "ficha") { v = QUALITY[spec?.source?.quality] ?? 0.85; note = `atende pela ficha (${spec?.source?.quality || "fonte"})`; }
    } else if (r?.level === "pending") { v = 0.5; note = "pendente"; }
    else if (r?.level === "fail") { v = 0; note = "não atende"; }
    req += v;
    parts.push({ group: "Obrigatórios", label: REQ_LABEL[f], pts: (60 / REQ.length) * v, max: 60 / REQ.length, note });
  }
  // 2) preferências
  const c = criteria, t = spec?.tech;
  const pref = (label, max, frac, note) => parts.push({ group: "Preferências", label, pts: frac == null ? 0 : max * clamp(frac), max, note });
  const maxP = c.max_price ?? (l.price || 1), minP = c.min_price ?? Math.round(maxP * 0.7);
  pref("Preço (quanto menor, melhor)", 12, l.price == null ? null : (maxP - l.price) / Math.max(1, maxP - minP), l.price == null ? "sem preço" : null);
  const maxK = c.max_km ?? 100000;
  pref("Km (quanto menor, melhor)", 10, l.km == null ? null : 1 - l.km / Math.max(1, maxK), l.km == null ? "sem km" : null);
  const span = Math.max(1, (c.year_max ?? 2025) - (c.year_min ?? 2020));
  pref("Ano-modelo (mais novo, melhor)", 6, l.year_model == null ? null : (l.year_model - (c.year_min ?? 2020)) / span, null);
  const d = l.distance || {};
  pref("Distância (mais perto, melhor)", 4, d.km == null ? null : 1 - d.km / Math.max(1, c.max_distance_km ?? 60), d.km == null ? "não calculada" : null);
  pref("Consumo na cidade (gasolina)", 5, t?.city_g ? (t.city_g - 9) / 5 : null, t?.city_g ? `${t.city_g} km/l` : "sem ficha técnica");
  pref("Porta-malas", 3, t?.trunk_l ? (t.trunk_l - 250) / 250 : null, t?.trunk_l ? `${t.trunk_l} L` : "sem ficha técnica");

  let total = Math.round(parts.reduce((a, p) => a + p.pts, 0));
  if (l.status === DISCARDED) total = Math.min(total, 39);
  const level = l.status === DISCARDED ? "baixa" : total >= 80 ? "excelente" : total >= 65 ? "boa" : total >= 50 ? "regular" : "baixa";
  return { total, level, parts };
}

export const LEVEL_LABEL = { excelente: "Excelente", boa: "Boa", regular: "Regular", baixa: "Baixa" };

/** Ordem: aprovados, pendentes, descartados; dentro de cada grupo, pela nota de aderência. */
const ORDER = { aprovado: 0, pendente: 1, descartado: 2 };
export const byAdherence = (a, b) => ((ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)) || (b.score?.total ?? 0) - (a.score?.total ?? 0);
