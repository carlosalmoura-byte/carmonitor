// Classificação: Aprovado / Pendente de validação / Descartado.
// Aprovado SOMENTE se todos os critérios estiverem comprovados. Violação com dado conhecido => Descartado.
// Dado ausente, não verificado ou conflitante => Pendente.
import { ABSENT, CONFIRMED, ITEMS } from "./equipment.js";

export const APPROVED = "aprovado", PENDING = "pendente", DISCARDED = "descartado";
export const TR_LABEL = { automatico: "automático", automatizado: "automatizado", manual: "manual" };
export const BORDERLINE_FRACTION = 0.10;

export const DEFAULT_CRITERIA = {
  max_price: 100000, year_min: 2022, year_max: 2025, max_km: 35000,
  transmissions: ["automatico"], conditions: ["usado", "seminovo"],
  ref_location: "Barueri, SP", max_distance_km: 60,
};

export const brl = (v) => "R$ " + Math.round(v).toLocaleString("pt-BR");
export const kmf = (v) => Math.round(v).toLocaleString("pt-BR") + " km";

const FIELD_LABEL = { price: "Preço", year_model: "Ano-modelo", km: "Quilometragem", transmission: "Câmbio", condition: "Tipo", city: "Cidade", state: "UF" };

/**
 * l: anúncio (price, year_model, km, transmission, condition, available, distance, conflicts)
 * checks: item -> {state, method}
 * exclusion: regra que desconsidera o modelo (ou null)
 */
export function classify(l, checks, criteria, exclusion = null) {
  const reasons = [];
  const add = (level, field, msg) => reasons.push({ level, field, msg });

  if (exclusion) add("fail", "excluded", `Modelo desconsiderado por você (${exclusion.label}).`);
  if (l.available === false) add("fail", "available", "Anúncio indisponível (removido ou vendido).");

  const conflicts = l.conflicts || {};
  const conflictMsg = (f) => conflicts[f] ? `${FIELD_LABEL[f] || f} conflitante entre fontes (${conflicts[f].map((c) => `${c.value} — ${c.source}`).join(" × ")}); confirme.` : null;

  const { price, year_model: year, km, transmission: tr, condition: cond } = l;
  const c = criteria;
  if (conflicts.price) add("pending", "price", conflictMsg("price"));
  else if (price == null) add("pending", "price", "Preço não informado/verificado.");
  else if (c.max_price != null && price > c.max_price) add("fail", "price", `Preço ${brl(price)} acima do máximo ${brl(c.max_price)}.`);
  else add("ok", "price", `Preço ${brl(price)} dentro do limite.`);

  if (conflicts.year_model) add("pending", "year_model", conflictMsg("year_model"));
  else if (year == null) add("pending", "year_model", "Ano-modelo não informado/verificado.");
  else if ((c.year_min && year < c.year_min) || (c.year_max && year > c.year_max)) add("fail", "year_model", `Ano-modelo ${year} fora da faixa ${c.year_min}–${c.year_max}.`);
  else add("ok", "year_model", `Ano-modelo ${year} dentro da faixa.`);

  if (conflicts.km) add("pending", "km", conflictMsg("km"));
  else if (km == null) add("pending", "km", "Quilometragem não informada/verificada.");
  else if (c.max_km != null && km > c.max_km) add("fail", "km", `Quilometragem ${kmf(km)} acima do máximo ${kmf(c.max_km)}.`);
  else add("ok", "km", `Quilometragem ${kmf(km)} dentro do limite.`);

  const allowedTr = c.transmissions || [];
  if (conflicts.transmission) add("pending", "transmission", conflictMsg("transmission"));
  else if (!tr) add("pending", "transmission", "Câmbio não informado/verificado.");
  else if (allowedTr.length && !allowedTr.includes(tr)) add("fail", "transmission", `Câmbio ${TR_LABEL[tr] || tr} não aceito.`);
  else add("ok", "transmission", `Câmbio ${TR_LABEL[tr] || tr}.`);

  const allowedCond = c.conditions || [];
  if (!cond) add("pending", "condition", "Tipo (usado/seminovo) não informado.");
  else if (allowedCond.length && !allowedCond.includes(cond)) add("fail", "condition", `Tipo ${cond} não aceito.`);
  else add("ok", "condition", `Tipo ${cond}.`);

  const maxD = c.max_distance_km, d = l.distance || {};
  if (d.km == null || !["verificada", "manual"].includes(d.status)) add("pending", "distance", "Distância por estrada não verificada.");
  else if (maxD != null && d.precision === "cidade" && Math.abs(d.km - maxD) <= maxD * BORDERLINE_FRACTION)
    add("pending", "distance", `Distância ${kmf(d.km)} calculada pelo centro da cidade, limítrofe ao máximo ${kmf(maxD)}; confirme o endereço.`);
  else if (maxD != null && d.km > maxD) add("fail", "distance", `Distância por estrada ${kmf(d.km)} acima de ${kmf(maxD)}.`);
  else add("ok", "distance", `Distância por estrada ${kmf(d.km)}.`);

  for (const [item, label] of Object.entries(ITEMS)) {
    const ch = checks[item] || {};
    if (ch.state === CONFIRMED) add("ok", item, `${label}: confirmado${ch.method === "ficha" ? " pela ficha da versão" : ""}.`);
    else if (ch.state === ABSENT) add("fail", item, `${label}: ausente${ch.method === "ficha" ? " segundo a ficha da versão" : ""}.`);
    else add("pending", item, `${label}: pendente de validação.`);
  }

  const levels = new Set(reasons.map((r) => r.level));
  const status = levels.has("fail") ? DISCARDED : levels.has("pending") ? PENDING : APPROVED;
  return { status, reasons };
}
