// Fichas de equipamentos por VERSÃO + ANO-MODELO, sempre com fonte.
// Uma ficha só se aplica ao anúncio da mesma marca, modelo, versão e ano-modelo.
// Item "opcional" na ficha nunca confirma: fica pendente.
import { key, normalize } from "./textnorm.js";

export const SPEC_CONFIRMED = "confirmado", SPEC_OPTIONAL = "opcional", SPEC_ABSENT = "ausente";

/** Fichas pesquisadas em 27/10/2026. Trechos citados das fontes. */
export const SEED_SPECS = [
  {
    id: "renault-kardian-premiere-2025", make: "renault", model: "kardian",
    version_includes: ["premiere"], version_excludes: [], year_from: 2025, year_to: 2025,
    items: {
      adas: { state: SPEC_CONFIRMED, names: ["Frenagem automática de emergência (AEBS)", "Alerta de ponto cego (BSW)", "Controle de velocidade adaptativo (ACC)"],
        quote: "frenagem automática de emergência (AEBS) … alerta de ponto cego (BSW) … controle de velocidade adaptativo (ACC)" },
      inducao: { state: SPEC_CONFIRMED, quote: "carregador de smartphone por indução" },
      android_auto_sem_fio: { state: SPEC_CONFIRMED, quote: "Android Auto® e Apple CarPlay® sem fio" },
    },
    tech: { body: "SUV compacto", engine: "1.0 turbo TCe (3 cil.)", power_g: 120, power_e: 125, torque_g: 20.4, torque_e: 22.4,
      gearbox: "Automático EDC dupla embreagem, 6 marchas", city_g: 12.2, road_g: 13.8, city_e: 8.8, road_e: 9.8, tank_l: 50, trunk_l: 410,
      source: { title: "Catálogo oficial Renault Kardian", quality: "oficial", url: "https://cdn.group.renault.com/ren/br/renault-new-cars/editorial/2025/catalogo/junho/RMA-001825H-AJ-CATALOGO-KARDIAN.pdf.asset.pdf/c6545f3254.pdf" },
      note: "Consumo da coluna EDC do catálogo; o catálogo não separa por versão." },
    source: { title: "Catálogo oficial Renault Kardian (mar/2024)", quality: "oficial",
      url: "https://cdn.group.renault.com/ren/br/renault-new-cars/editorial/2025/catalogo/junho/RMA-001825H-AJ-CATALOGO-KARDIAN.pdf.asset.pdf/c6545f3254.pdf" },
    note: "Catálogo de lançamento (ano-modelo 2025); não informa o ano-modelo explicitamente.",
  },
  {
    id: "fiat-pulse-impetus-2022", make: "fiat", model: "pulse",
    version_includes: ["impetus"], version_excludes: [], year_from: 2022, year_to: 2022,
    items: {
      adas: { state: SPEC_CONFIRMED, names: ["Frenagem autônoma de emergência (AEB)", "Alerta de saída de faixa (LDW)", "Farol alto automático (AHB)"],
        quote: "ADAS: AEB (Frenagem autônoma de emergência) … LDW (Alerta de mudança involuntária de faixa) … AHB (Comutação automática de farol alto)" },
      inducao: { state: SPEC_CONFIRMED, quote: "Wireless Charger (Carregador do Celular por Indução)" },
      android_auto_sem_fio: { state: SPEC_CONFIRMED, quote: "Central multimídia … Apple Car Play e Android Auto wireless" },
    },
    tech: { body: "SUV compacto", engine: "1.0 turbo T200 (3 cil.)", power_g: 125, power_e: 130, torque_g: 20.4, torque_e: 20.4,
      gearbox: "CVT, 7 marchas simuladas", city_g: 12, road_g: 14.6, city_e: 8.5, road_e: 10.2, tank_l: 47, trunk_l: 370,
      source: { title: "Ficha Completa — Pulse Impetus 1.0 Turbo 2022", quality: "secundária", url: "https://www.fichacompleta.com.br/carros/comparativo/pulse-audace-1-0-turbo-2022-vs-pulse-impetus-1-0-turbo-2022-vs-pulse-audace-1-0-turbo-2024-vs-pulse-impetus-1-0-turbo-2024" } },
    source: { title: "Lista de equipamentos de série Pulse Impetus (jan/2022)", quality: "concessionária",
      url: "https://carroscomcamanzi.com.br/wp-content/uploads/2022/01/Lista-de-equipamentos-de-serie-Pulse-Impetus.pdf" },
  },
  {
    id: "hyundai-hb20-platinum-plus-2024", make: "hyundai", model: "hb20",
    version_includes: ["platinum plus"], version_excludes: [], year_from: 2024, year_to: 2024,
    items: {
      adas: { state: SPEC_CONFIRMED, names: ["Frenagem autônoma (FCA)", "Assistente de ponto cego (BCA)", "Assistente de permanência em faixa (LKA)"],
        quote: "Sistema de alerta e frenagem autônomo (FCA) … Assistente de ponto cego (BCA) … Assistente de permanência em faixa (LKA)" },
      inducao: { state: SPEC_CONFIRMED, quote: "Carregador sem fio para smartphones" },
      android_auto_sem_fio: { state: SPEC_CONFIRMED, quote: "Conectividade sem fio com smartphone Apple CarPlay e Google Android Auto" },
    },
    tech: { body: "Hatch compacto", engine: "1.0 turbo TGDI (3 cil.)", power_g: 120, power_e: 120, torque_g: 17.5, torque_e: 17.5,
      gearbox: "Automático, 6 marchas", city_g: 12.7, road_g: 14, city_e: 9, road_e: 10.3, tank_l: 50, trunk_l: 300,
      source: { title: "Catálogo oficial Hyundai HB20 Platinum Plus 2024 (potência, torque, porta-malas) + Ficha Completa (consumo, tanque)", quality: "oficial/secundária",
        url: "https://www.hyundai.com.br/content/dam/hmb/cars/hb20/2023/catalogos/Catalogo_DIgital_Novo_HB20_Platinum_Plus_2024.pdf" } },
    source: { title: "Garagem360 — HB20 2024: ficha técnica e itens de série", quality: "secundária", url: "https://garagem360.com.br/?p=179615" },
  },
  {
    id: "chevrolet-onix-premier-2025", make: "chevrolet", model: "onix",
    version_includes: ["premier"], version_excludes: ["plus"], year_from: 2025, year_to: 2025,
    items: {
      adas: { state: SPEC_CONFIRMED, names: ["Alerta de ponto cego"], quote: "Alerta de Ponto Cego (Premier)" },
      inducao: { state: SPEC_CONFIRMED, quote: "Carregador de celular sem fio (Premier)" },
      android_auto_sem_fio: { state: SPEC_CONFIRMED, quote: "Projeção da tela do smartphone sem o uso de cabo (Premier)" },
    },
    tech: { body: "Hatch compacto", engine: "1.0 turbo (3 cil.)", power_g: 116, power_e: 116, torque_g: 16.3, torque_e: 16.8,
      gearbox: "Automático, 6 marchas", city_g: 11.6, road_g: 14.9, city_e: 8.3, road_e: 10.4, tank_l: 44, trunk_l: 275,
      source: { title: "Ficha Completa — Onix Premier 1.0 Turbo AT 2025", quality: "secundária", url: "https://www.fichacompleta.com.br/carros/comparativo/onix-premier-1-0-turbo-at-2025-vs-onix-premier-1-0-turbo-at-2025-flex-vs-onix-ltz-1-0-turbo-at-2025-flex-vs-onix-rs-1-0-2025" },
      note: "A fonte lista duas fichas para o Premier 2025; os valores divergem pouco (ex.: 121 cv no etanol em uma delas)." },
    source: { title: "Garagem360 — Onix Premier 2025: ficha técnica e itens", quality: "secundária", url: "https://garagem360.com.br/?p=242840" },
  },
  {
    id: "chevrolet-onix-plus-premier-2025", make: "chevrolet", model: "onix",
    version_includes: ["plus premier"], version_excludes: [], year_from: 2025, year_to: 2025,
    items: {
      adas: { state: SPEC_CONFIRMED, names: ["Alerta de ponto cego"], quote: "Na versão topo de linha: Alerta de ponto cego" },
      inducao: { state: SPEC_CONFIRMED, quote: "Diferenciais da versão Premier: Carregador sem fio" },
      android_auto_sem_fio: { state: SPEC_CONFIRMED, quote: "integração sem fio com Apple CarPlay e Android Auto" },
    },
    tech: { body: "Sedã compacto", engine: "1.0 turbo (3 cil.)", power_g: 116, power_e: 116, torque_g: 16.3, torque_e: 16.8,
      gearbox: "Automático, 6 marchas", city_g: 12.1, road_g: 15.8, city_e: 8.6, road_e: 11.1, tank_l: 44, trunk_l: 469,
      source: { title: "Ficha Completa — Onix Sedan Premier 1.0 Turbo AT 2025", quality: "secundária", url: "https://www.fichacompleta.com.br/carros/comparativo/onix-sedan-premier-1-0-turbo-at-2025-vs-onix-sedan-ltz-1-0-turbo-at-2025-vs-onix-sedan-premier-1-0-2025" } },
    source: { title: "Revista Cars — Onix Plus 2025: versões e ficha técnica", quality: "secundária",
      url: "https://revistacars.com.br/quanto-custa-o-chevrolet-onix-plus-2025-versoes-preco-e-ficha-tecnica/" },
    note: "A fonte cita a integração sem fio na seção geral, sem atrelar à versão.",
  },
];

const words = (s) => normalize(s || "").replace(/[^a-z0-9]+/g, " ").trim();
const containsPhrase = (hay, phrase) => (" " + words(hay) + " ").includes(" " + words(phrase) + " ");

/** A ficha se aplica ao anúncio? Exige marca, modelo, versão e ano-modelo. */
export function specMatches(spec, l) {
  if (!l.make || !l.model || !l.version || !l.year_model) return false;
  if (key(l.make) !== key(spec.make) || key(l.model) !== key(spec.model)) return false;
  if (l.year_model < spec.year_from || l.year_model > spec.year_to) return false;
  if (!(spec.version_includes || []).every((p) => containsPhrase(l.version, p))) return false;
  if ((spec.version_excludes || []).some((p) => containsPhrase(l.version, p))) return false;
  return true;
}

export function findSpec(specs, l, { onlyOfficial = false } = {}) {
  const ok = specs.filter((s) => specMatches(s, l) && (!onlyOfficial || s.source?.quality === "oficial"));
  // a mais específica (mais termos de versão) vence
  ok.sort((a, b) => (b.version_includes || []).join(" ").length - (a.version_includes || []).join(" ").length);
  return ok[0] || null;
}

export function validateSpec(s) {
  const errs = [];
  if (!s.make || !s.model) errs.push("marca e modelo");
  if (!(s.version_includes || []).length) errs.push("termo da versão");
  if (!s.year_from || !s.year_to || s.year_from > s.year_to) errs.push("faixa de ano-modelo");
  if (!s.source?.title || !/^https?:\/\//.test(s.source?.url || "")) errs.push("fonte com link");
  for (const [k, v] of Object.entries(s.items || {})) {
    if (![SPEC_CONFIRMED, SPEC_OPTIONAL, SPEC_ABSENT].includes(v.state)) errs.push(`estado de ${k}`);
    if (k === "adas" && v.state === SPEC_CONFIRMED && !(v.names || []).length) errs.push("nome do sistema ADAS");
  }
  return errs;
}

// ------------------------------------------------------------- modelos desconsiderados
/** regra: {make?, model, version_includes?} — vazio = qualquer */
export function exclusionMatches(rule, l) {
  if (rule.make && key(rule.make) !== key(l.make)) return false;
  if (rule.model && key(rule.model) !== key(l.model)) return false;
  if (!rule.make && !rule.model) return false;
  if (rule.version_includes && !containsPhrase(l.version, rule.version_includes)) return false;
  if (rule.version_excludes && containsPhrase(l.version, rule.version_excludes)) return false;
  return true;
}
export const findExclusion = (rules, l) => (rules || []).find((r) => exclusionMatches(r, l)) || null;
export const exclusionLabel = (r) => r.label || [r.make, r.model, r.version_includes].filter(Boolean).join(" ").toUpperCase();
