// Classificação: Aprovado / Pendente de validação / Descartado.
// Aprovado SOMENTE se todos os critérios estiverem comprovados. Violação com dado conhecido => Descartado.
// Dado ausente, não verificado ou conflitante => Pendente.
import { ABSENT, CONFIRMED, ITEMS } from "./equipment.js";

export const APPROVED = "aprovado", PENDING = "pendente", DISCARDED = "descartado";
export const TR_LABEL = { automatico: "automático", automatizado: "automatizado", manual: "manual" };
export const BORDERLINE_FRACTION = 0.10;

export const DEFAULT_CRITERIA = {
  min_price: null, max_price: 100000, year_min: 2022, year_max: 2025, min_km: null, max_km: 35000,
  transmissions: ["automatico"], conditions: ["usado", "seminovo"], seller_types: ["particular", "loja", "concessionaria"], adas_required: false,
  ref_location: "Barueri, SP", max_distance_km: 60,
  no_auction: true, no_armored: true, body_types: [], avoid_colors: [], min_photos: 2,
};
export const BODY_LABEL = { hatch: "Hatch", sedan: "Sedã", suv: "SUV", picape: "Picape", outro: "Outra" };

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

  if (l.user_discard) add("fail", "user", `Descartado por você${l.user_discard.reason ? `: ${l.user_discard.reason}` : "."}`);
  if (exclusion) add("fail", "excluded", `Modelo desconsiderado por você (${exclusion.label}).`);
  if (l.available === false) add("fail", "available", "Anúncio indisponível (removido ou vendido).");

  const conflicts = l.conflicts || {};
  const conflictMsg = (f) => conflicts[f] ? `${FIELD_LABEL[f] || f} conflitante entre fontes (${conflicts[f].map((c) => `${c.value} — ${c.source}`).join(" × ")}); confirme.` : null;

  const { price, year_model: year, km, transmission: tr, condition: cond } = l;
  const c = criteria;
  if (conflicts.price) add("pending", "price", conflictMsg("price"));
  else if (price == null) add("pending", "price", "Preço não informado/verificado.");
  else if (c.max_price != null && price > c.max_price) add("fail", "price", `Preço ${brl(price)} acima do máximo ${brl(c.max_price)}.`);
  else if (c.min_price != null && price < c.min_price) add("fail", "price", `Preço ${brl(price)} abaixo do mínimo ${brl(c.min_price)}.`);
  else add("ok", "price", `Preço ${brl(price)} dentro do limite.`);

  if (conflicts.year_model) add("pending", "year_model", conflictMsg("year_model"));
  else if (year == null) add("pending", "year_model", "Ano-modelo não informado/verificado.");
  else if ((c.year_min && year < c.year_min) || (c.year_max && year > c.year_max)) add("fail", "year_model", `Ano-modelo ${year} fora da faixa ${c.year_min}–${c.year_max}.`);
  else add("ok", "year_model", `Ano-modelo ${year} dentro da faixa.`);

  if (conflicts.km) add("pending", "km", conflictMsg("km"));
  else if (km == null) add("pending", "km", "Quilometragem não informada/verificada.");
  else if (c.max_km != null && km > c.max_km) add("fail", "km", `Quilometragem ${kmf(km)} acima do máximo ${kmf(c.max_km)}.`);
  else if (c.min_km != null && km < c.min_km) add("fail", "km", `Quilometragem ${kmf(km)} abaixo do mínimo ${kmf(c.min_km)}.`);
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

  const allowedSeller = c.seller_types || [];
  const SELLER = { particular: "particular", loja: "loja", concessionaria: "concessionária" };
  if (allowedSeller.length && allowedSeller.length < 3) {
    if (!l.seller_type) add("pending", "seller", "Tipo de vendedor não identificado.");
    else if (!allowedSeller.includes(l.seller_type)) add("fail", "seller", `Vendedor ${SELLER[l.seller_type] || l.seller_type} não aceito.`);
    else add("ok", "seller", `Vendedor ${SELLER[l.seller_type]}.`);
  }

  const maxD = c.max_distance_km, d = l.distance || {};
  if (d.km == null || !["verificada", "manual"].includes(d.status)) add("pending", "distance", "Distância por estrada não verificada.");
  else if (maxD != null && d.precision === "cidade" && Math.abs(d.km - maxD) <= maxD * BORDERLINE_FRACTION)
    add("pending", "distance", `Distância ${kmf(d.km)} calculada pelo centro da cidade, limítrofe ao máximo ${kmf(maxD)}; confirme o endereço.`);
  else if (maxD != null && d.km > maxD) add("fail", "distance", `Distância por estrada ${kmf(d.km)} acima de ${kmf(maxD)}.`);
  else add("ok", "distance", `Distância por estrada ${kmf(d.km)}.`);

  // histórico e carroceria (dados do WebMotors; não informado não trava a aprovação, exceto carroceria quando você restringe)
  if (c.no_auction !== false) {
    if (l.auction === true) add("fail", "auction", "Passou por leilão.");
    else if (l.auction === false) add("ok", "auction", "Sem passagem por leilão.");
    else add("info", "auction", "Leilão: não informado no anúncio.");
  }
  if (c.no_armored !== false) {
    if (l.armored === true) add("fail", "armored", "Carro blindado.");
    else if (l.armored === false) add("ok", "armored", "Não blindado.");
  }
  // fotos (contadas na página do anúncio pela pesquisa). "Em preparação" = foto genérica, não é do carro → sempre fora.
  const minPh = c.min_photos ?? 2;
  if (l.preparing === true) add("fail", "photos", "Anúncio em preparação: as fotos não são do carro.");
  else if (minPh > 0) {
    if (l.photos == null) add("info", "photos", "Fotos: quantidade ainda não conferida pela pesquisa.");
    else if (l.photos < minPh) add("fail", "photos", l.photos === 0 ? "Anúncio sem foto." : `Só ${l.photos} foto${l.photos === 1 ? "" : "s"} (mínimo ${minPh}).`);
    else add("ok", "photos", l.photos >= 8 ? "8 ou mais fotos no anúncio." : `${l.photos} fotos no anúncio.`);
  }
  const body = l.body || l.body_ficha, bt = c.body_types || [];
  if (bt.length) {
    if (!body) add("pending", "body", "Carroceria não identificada.");
    else if (!bt.includes(body)) add("fail", "body", `Carroceria ${BODY_LABEL[body] || body} não aceita.`);
    else add("ok", "body", `Carroceria ${BODY_LABEL[body]}${!l.body ? " (pela ficha)" : ""}.`);
  }
  const avoid = (c.avoid_colors || []).map((x) => x.toLowerCase());
  if (avoid.length && l.color && avoid.some((x) => l.color.toLowerCase().includes(x))) add("fail", "color", `Cor ${l.color} está entre as que você evita.`);

  for (const [item, label] of Object.entries(ITEMS)) {
    const ch = checks[item] || {};
    if (item === "adas" && !c.adas_required) { // desejável: soma na nota, não aprova nem descarta
      if (ch.state === CONFIRMED) add("info", item, `${label}: tem${ch.method === "ficha" ? " (pela ficha da versão)" : ""} — desejável.`);
      else add("info", item, `${label}: ${ch.state === ABSENT ? "não tem" : "não comprovado"} — desejável, não obrigatório.`);
      continue;
    }
    if (ch.state === CONFIRMED) add("ok", item, `${label}: confirmado${ch.method === "ficha" ? " pela ficha da versão" : ""}.`);
    else if (ch.state === ABSENT) add("fail", item, `${label}: ausente${ch.method === "ficha" ? " segundo a ficha da versão" : ""}.`);
    else add("pending", item, `${label}: pendente de validação.`);
  }

  const levels = new Set(reasons.map((r) => r.level));
  let status = levels.has("fail") ? DISCARDED : levels.has("pending") ? PENDING : APPROVED;
  // aprovação manual: só vale para pendências (um item reprovado pelos critérios continua descartado)
  if (l.user_approve && !l.user_discard && status === PENDING) { status = APPROVED; reasons.unshift({ level: "ok", field: "user", msg: "Aprovado por você (pendências conferidas por você)." }); }
  return { status, reasons };
}
