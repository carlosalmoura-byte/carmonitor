// Regras de negócio sobre o estado local (sem rede, exceto a função de distância injetada).
import { APPROVED, DEFAULT_CRITERIA, DISCARDED, brl, classify } from "./classify.js";
import { duplicateGroups, normalizeUrl } from "./dedup.js";
import { ABSENT, CONFIRMED, ITEMS, PENDING, detectEquipment, mergeDetections } from "./equipment.js";
import { Parsed, deriveFields, extractFromText, parseUrl } from "./parsing.js";
import { SEED_SPECS, SPEC_ABSENT, SPEC_CONFIRMED, SPEC_OPTIONAL, exclusionLabel, findExclusion, findSpec } from "./specs.js";
import { scoreListing } from "./score.js";

export const FIELDS = ["title", "make", "model", "version", "year_fab", "year_model", "price", "km", "transmission",
  "condition", "city", "state", "address", "seller", "seller_type"];
const PRIORITY = { url: 1, derivado_km: 1, derivado_version: 1, derivado_title: 1, derivado_vendedor: 1, texto_colado: 3, manual: 10 };
export const SOURCE_LABEL = { url: "URL do anúncio", texto_colado: "Texto do anúncio", manual: "Informado por você",
  derivado_km: "Derivado da km", derivado_version: "Derivado da versão", derivado_title: "Derivado do título",
  derivado_vendedor: "Deduzido do nome do vendedor" };
export const MY_CAR_DEFAULT = "Chevrolet Onix Hatch 1.0 Turbo automático LT 2020, com 108 mil km";
export const CONTACT_TEMPLATE_DEFAULT = "Olá! Vi o anúncio do {carro} {ano}, por {preco}, no WebMotors ({link}). Tenho interesse no carro. " +
  "Ele continua disponível? Gostaria de agendar uma visita para conhecê-lo. Também tenho um {meu_carro} para avaliação e possível inclusão na negociação. Obrigado!";
const CONFLICT_FIELDS = ["year_fab", "year_model", "transmission"];

export const DEFAULT_NOTIFY = { new_approved: true, new_pending: false, price_drop: true, price_drop_min_pct: 1,
  price_drop_min_abs: 1000, include_discarded: false, unavailable: true, review_digest: true, system: false };

export function newState() {
  return {
    version: 1, nextId: 1, listings: [], notifications: [],
    settings: { criteria: { ...DEFAULT_CRITERIA }, notify: { ...DEFAULT_NOTIFY }, accept_specs: true,
      only_official_specs: false, stale_days: 3, routine_hours: 12, distance: { provider: "osrm", ors_key: "" },
      my_car: MY_CAR_DEFAULT, contact_template: CONTACT_TEMPLATE_DEFAULT, github_token: "" },
    custom_specs: [], disabled_specs: [], exclusions: [], geo_cache: {}, meta: { last_routine: null, routines: [] },
  };
}

/** Garante campos novos em estados salvos por versões anteriores. */
export function upgradeState(s) {
  const base = newState();
  s = { ...base, ...s };
  s.settings = { ...base.settings, ...s.settings, criteria: { ...DEFAULT_CRITERIA, ...(s.settings?.criteria || {}) },
    notify: { ...DEFAULT_NOTIFY, ...(s.settings?.notify || {}) }, distance: { ...base.settings.distance, ...(s.settings?.distance || {}) } };
  s.meta = { ...base.meta, ...s.meta };
  return s;
}

const nowIso = (deps) => (deps?.now ? deps.now() : new Date()).toISOString();
export const allSpecs = (state) => [...(state.custom_specs || []), ...SEED_SPECS.filter((s) => !(state.disabled_specs || []).includes(s.id))];

// ------------------------------------------------------------------ campos
export function applyParsed(l, parsed) {
  const changed = [];
  for (const f of FIELDS) {
    if (!(f in parsed.fields)) continue;
    const curSrc = l.field_sources[f];
    if (curSrc === "manual") continue;
    const newSrc = parsed.sources[f] || "texto_colado";
    const cur = l[f], val = parsed.fields[f];
    if (cur == null || (PRIORITY[newSrc] || 0) >= (PRIORITY[curSrc] || 0)) {
      if (cur != null && cur !== val && curSrc === "url" && newSrc === "texto_colado" && CONFLICT_FIELDS.includes(f)) {
        l.conflicts[f] = [{ value: cur, source: SOURCE_LABEL.url }, { value: val, source: SOURCE_LABEL.texto_colado }];
      }
      if (cur !== val) { l[f] = val; changed.push(f); }
      l.field_sources[f] = newSrc;
    }
  }
  if ("available" in parsed.fields) l.available = !!parsed.fields.available;
  return changed;
}

export function setManualFields(l, data) {
  const changed = [];
  for (let [f, v] of Object.entries(data)) {
    if (!FIELDS.includes(f)) continue;
    if (v === "" || v === undefined) v = null;
    if (v != null && ["year_fab", "year_model", "km"].includes(f)) v = Math.trunc(Number(v));
    if (v != null && f === "price") v = Number(v);
    if (v != null && f === "state") v = String(v).toUpperCase().slice(0, 2);
    l[f] = v;
    if (v == null) delete l.field_sources[f]; else l.field_sources[f] = "manual";
    delete l.conflicts[f];
    changed.push(f);
  }
  return changed;
}

// ------------------------------------------------------------------ equipamentos
export function runChecks(state, l) {
  const tz = "America/Sao_Paulo";
  const perItem = Object.fromEntries(Object.keys(ITEMS).map((k) => [k, []]));
  for (const t of l.texts) {
    const label = `Texto do anúncio (${t.origin || "colado"}) em ${fmtDate(t.at, tz)}`;
    const d = detectEquipment(t.content);
    for (const k of Object.keys(ITEMS)) perItem[k].push([label, d[k]]);
  }
  const spec = state.settings.accept_specs ? findSpec(allSpecs(state), l, { onlyOfficial: state.settings.only_official_specs }) : null;
  l.spec_id = spec ? spec.id : null;
  for (const item of Object.keys(ITEMS)) {
    if (l.manual_checks[item]) { l.checks[item] = { ...l.manual_checks[item], method: "manual" }; continue; }
    const [ad, src] = mergeDetections(perItem[item]);
    const s = spec?.items?.[item];
    const specSrc = spec ? `Ficha da versão: ${spec.source.title} (fonte ${spec.source.quality})` : null;
    let out = { state: ad.state, method: "anuncio", detail: item === "adas" ? ad.detail : null, source: src, evidence: ad.evidence, note: ad.note };
    if (ad.state === CONFIRMED) {
      // comprovado no próprio anúncio
    } else if (ad.state === ABSENT && s?.state === SPEC_CONFIRMED) {
      out = { ...out, state: PENDING, note: "O anúncio nega o item, mas a ficha da versão indica de série. Confirme com o vendedor." };
    } else if (ad.state === PENDING && s) {
      if (s.state === SPEC_CONFIRMED) {
        out = { state: CONFIRMED, method: "ficha", detail: item === "adas" ? (s.names || []).join("; ") : null, source: specSrc,
          source_url: spec.source.url, evidence: s.quote || null,
          note: ["Não está escrito no anúncio; confirmado pela ficha da mesma versão e ano-modelo.", spec.note].filter(Boolean).join(" ") };
      } else if (s.state === SPEC_OPTIONAL) {
        out = { ...out, source: specSrc, source_url: spec.source.url, evidence: s.quote || out.evidence, note: "Opcional nesta versão segundo a ficha; confirme se o carro tem." };
      } else if (s.state === SPEC_ABSENT) {
        out = { state: ABSENT, method: "ficha", detail: null, source: specSrc, source_url: spec.source.url, evidence: s.quote || null, note: "A ficha da versão indica que o item não existe nesta versão." };
      }
    }
    l.checks[item] = { ...out, at: l.checks[item]?.at };
  }
}

export function setManualCheck(l, item, { state, source, evidence, detail }, deps) {
  if (!(item in ITEMS)) throw new Error("Item inválido.");
  if (state === "auto") { delete l.manual_checks[item]; return; }
  if (![CONFIRMED, ABSENT, PENDING].includes(state)) throw new Error("Estado inválido.");
  if ([CONFIRMED, ABSENT].includes(state) && (!(source || "").trim() || !(evidence || "").trim()))
    throw new Error("Para confirmar ou marcar ausente informe a fonte e a evidência.");
  if (item === "adas" && state === CONFIRMED && !(detail || "").trim()) throw new Error("Informe o nome do sistema ADAS confirmado.");
  l.manual_checks[item] = { state, source: (source || "").trim() || null, evidence: (evidence || "").trim() || null,
    detail: (detail || "").trim() || null, note: "Validação manual sua.", at: nowIso(deps) };
}

// ------------------------------------------------------------------ distância
export async function updateDistance(state, l, deps, force = false) {
  if (l.distance?.status === "manual" && !force) return;
  if (!deps?.distance) { l.distance = { km: null, status: "nao_verificada", precision: null, note: "Cálculo de rota indisponível." }; return; }
  l.distance = await deps.distance(state, state.settings.criteria.ref_location, l.city, l.state, l.address);
}

export function setManualDistance(l, km, source) {
  if (km == null || km === "") { l.distance = { km: null, status: "nao_verificada", precision: null, note: "Distância removida; recalcule." }; return; }
  if (!(source || "").trim()) throw new Error("Informe a fonte da distância (ex.: rota no Google Maps até o endereço da loja).");
  l.distance = { km: Math.round(Number(km) * 10) / 10, status: "manual", precision: "manual", note: `Informada por você: ${source.trim()}` };
}

// ------------------------------------------------------------------ histórico
export function takeSnapshot(l, source, deps, force = false) {
  const prev = l.snapshots[l.snapshots.length - 1];
  const events = [];
  if (prev) {
    if (prev.price && l.price && l.price < prev.price) events.push({ type: "price_drop", old: prev.price, new: l.price });
    else if (prev.price && l.price && l.price > prev.price) events.push({ type: "price_up", old: prev.price, new: l.price });
    if (prev.km != null && l.km != null && l.km !== prev.km) events.push({ type: "km_change", old: prev.km, new: l.km });
    if (prev.available !== false && l.available === false) events.push({ type: "unavailable" });
    if (prev.available === false && l.available) events.push({ type: "available_again" });
  } else if (l.available === false) events.push({ type: "unavailable" });
  const changed = !prev || prev.price !== l.price || prev.km !== l.km || prev.available !== l.available;
  if (changed || force) l.snapshots.push({ at: nowIso(deps), price: l.price, km: l.km, available: l.available, source });
  if (events.length) l.last_changed = nowIso(deps);
  if (events.some((e) => e.type === "unavailable")) l.unavailable_since = nowIso(deps);
  if (events.some((e) => e.type === "available_again")) l.unavailable_since = null;
  return events;
}

// ------------------------------------------------------------------ classificação + alertas
export function reclassify(state, l) {
  const old = l.status;
  const ex = findExclusion(state.exclusions, l);
  const r = classify(l, l.checks, state.settings.criteria, ex ? { label: exclusionLabel(ex) } : null);
  l.status = r.status; l.reasons = r.reasons; l.excluded = !!ex;
  const spec = l.spec_id ? allSpecs(state).find((s) => s.id === l.spec_id) : null;
  l.score = scoreListing(l, state.settings.criteria, spec);
  return [old, r.status];
}

export const listingName = (l) => {
  const s = [l.make, l.model, l.version].filter(Boolean).join(" ") || l.title || `Anúncio #${l.id}`;
  return l.year_model ? `${s} ${l.year_model}` : s;
};

export function notify(state, kind, title, message, dedupe, listingId, deps) {
  if (state.notifications.some((n) => n.dedupe === dedupe)) return null;
  const n = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, title, message, dedupe,
    listing_id: listingId ?? null, at: nowIso(deps), read: false };
  state.notifications.unshift(n);
  state.notifications = state.notifications.slice(0, 300);
  deps?.onNotify?.(n);
  return n;
}

export function handleNotifications(state, l, oldStatus, events, isNew, deps) {
  const p = state.settings.notify;
  if (l.excluded && !l.favorite) return;
  if (l.status === APPROVED && oldStatus !== APPROVED && p.new_approved)
    notify(state, "novo_aprovado", "Nova oportunidade aprovada",
      `${listingName(l)} — ${l.price != null ? brl(l.price) : "—"} — ${l.km ?? "—"} km — ${l.city || "?"}/${l.state || "?"}`,
      `aprovado:${l.id}:${l.price}`, l.id, deps);
  if (isNew && p.new_pending && l.status !== APPROVED && l.status !== DISCARDED)
    notify(state, "novo_pendente", "Novo anúncio pendente de validação", listingName(l), `novo:${l.id}`, l.id, deps);
  for (const ev of events) {
    if (ev.type === "price_drop" && p.price_drop && (l.status !== DISCARDED || p.include_discarded)) {
      const drop = ev.old - ev.new, pct = (drop / ev.old) * 100;
      if (pct >= Number(p.price_drop_min_pct || 0) || drop >= Number(p.price_drop_min_abs || 0))
        notify(state, "reducao_preco", "Redução de preço", `${listingName(l)}: ${brl(ev.old)} → ${brl(ev.new)} (−${pct.toFixed(1)}%)`,
          `queda:${l.id}:${ev.old}:${ev.new}`, l.id, deps);
    }
    if (ev.type === "unavailable" && l.favorite)
      notify(state, "favorito_indisponivel", "Favorito saiu do ar", `${listingName(l)} não está mais anunciado. O histórico fica guardado até você excluir.`,
        `favindisp:${l.id}:${nowIso(deps).slice(0, 10)}`, l.id, deps);
    else if (ev.type === "unavailable" && p.unavailable && oldStatus !== DISCARDED)
      notify(state, "indisponivel", "Anúncio indisponível", `${listingName(l)} saiu do ar ou foi vendido.`, `indisp:${l.id}:${nowIso(deps).slice(0, 10)}`, l.id, deps);
  }
}

export function recomputeDuplicates(state) {
  const active = state.listings.filter((l) => !l.archived);
  const groups = duplicateGroups(active);
  for (const l of state.listings) l.duplicate_group = groups[l.id] || null;
}

/** Reprocessa equipamentos e classificação de um anúncio (sem rede). */
export function refresh(state, l, deps, events = [], isNew = false) {
  runChecks(state, l);
  const [old] = reclassify(state, l);
  handleNotifications(state, l, isNew ? null : old, events, isNew, deps);
}

// ------------------------------------------------------------------ importação
export function findExisting(state, url, source, sourceId) {
  return state.listings.find((l) => l.url === url) ||
    (sourceId ? state.listings.find((l) => l.source === source && l.source_id === sourceId) : null) || null;
}

export function addText(l, content, origin, deps, at = null) {
  content = String(content || "").trim();
  if (content.length < 10) return false;
  if (origin === FEED_ORIGIN) l.texts = l.texts.filter((t) => t.origin !== FEED_ORIGIN); // guarda só a pesquisa mais recente
  const when = at || nowIso(deps);
  l.texts.push({ id: `${Date.now()}-${l.texts.length}`, content: content.slice(0, 200000), origin, at: when });
  if (!l.last_checked || new Date(when) > new Date(l.last_checked)) l.last_checked = when;
  const p = deriveFields(extractFromText(content, "texto_colado"));
  applyParsed(l, p);
  return true;
}

export async function importListing(state, { url, text, origin = "colado", at = null, skipDistance = false }, deps) {
  let nurl;
  try { nurl = normalizeUrl(url); } catch { return { result: "erro", message: "Link inválido." }; }
  const hints = parseUrl(nurl);
  const source = hints.fields.source, sourceId = hints.fields.source_id || null;
  delete hints.fields.source; delete hints.fields.source_id;
  const ex = findExisting(state, nurl, source, sourceId);
  if (ex) {
    ex.archived = false;
    if (text && addText(ex, text, origin, deps, at)) {
      const events = takeSnapshot(ex, origin === FEED_ORIGIN ? "pesquisa" : "texto_colado", deps, origin === FEED_ORIGIN);
      if (!skipDistance && ["city", "state", "address"].some((f) => ex.field_sources[f]) && ex.distance?.status !== "verificada") await updateDistance(state, ex, deps);
      refresh(state, ex, deps, events);
      recomputeDuplicates(state);
      return { result: "atualizado", id: ex.id, message: "Anúncio já existia: texto novo analisado." };
    }
    return { result: "duplicado", id: ex.id, message: "Anúncio já cadastrado (mesmo link/ID)." };
  }
  const l = {
    id: state.nextId++, url: nurl, source, source_id: sourceId, field_sources: {}, conflicts: {}, texts: [], checks: {},
    manual_checks: {}, distance: { km: null, status: "nao_verificada", precision: null, note: "Ainda não calculada." },
    available: null, status: "pendente", reasons: [], snapshots: [], duplicate_group: null, archived: false, notes: "",
    first_seen: nowIso(deps), last_checked: null, last_changed: null, spec_id: null, excluded: false,
  };
  for (const f of FIELDS) l[f] ??= null;
  applyParsed(l, hints);
  if (text) addText(l, text, origin, deps, at);
  const p2 = new Parsed();
  for (const f of FIELDS) if (l[f] != null) p2.put(f, l[f], l.field_sources[f]);
  deriveFields(p2);
  applyParsed(l, p2);
  state.listings.push(l);
  if (skipDistance) l.distance = { km: null, status: "nao_verificada", precision: null, note: "Aguardando cálculo da rota." };
  else await updateDistance(state, l, deps);
  const events = takeSnapshot(l, origin === FEED_ORIGIN ? "pesquisa" : "importacao", deps);
  refresh(state, l, deps, events, true);
  recomputeDuplicates(state);
  return { result: "criado", id: l.id,
    message: text ? "Importado e texto analisado." : "Importado só com o link. Cole o texto do anúncio para validar." };
}

// ------------------------------------------------------------------ pesquisa publicada (data/anuncios.json)
export const FEED_ORIGIN = "pesquisa do Claude";

/**
 * Importa/atualiza anúncios de uma pesquisa publicada junto com o app.
 * feed: {generated_at, listings: [{url, checked_at, text, available?}]}
 * Só processa itens com checked_at mais novo do que o já visto para aquele link.
 */
export async function syncFeed(state, feed, deps) {
  const res = { novos: 0, atualizados: 0, indisponiveis: 0, ignorados: 0 };
  if (!feed || !Array.isArray(feed.listings)) return res;
  state.meta.feed_seen ||= {};
  for (const it of feed.listings) {
    if (!it?.url || !it.checked_at) { res.ignorados++; continue; }
    let key;
    try { key = normalizeUrl(it.url); } catch { res.ignorados++; continue; }
    const seen = state.meta.feed_seen[key];
    if (seen && new Date(seen) >= new Date(it.checked_at)) continue;
    if (it.available === false) {
      const l = state.listings.find((x) => x.url === key);
      if (l && l.available !== false) {
        l.available = false; l.last_checked = it.checked_at;
        const events = takeSnapshot(l, "pesquisa", deps, true);
        refresh(state, l, deps, events); res.indisponiveis++;
      }
    } else {
      const r = await importListing(state, { url: key, text: it.text || null, origin: FEED_ORIGIN, at: it.checked_at, skipDistance: true }, deps);
      if (r.result === "criado") res.novos++; else if (r.result === "atualizado") res.atualizados++;
      const l = state.listings.find((x) => x.id === r.id);
      const last = l?.snapshots[l.snapshots.length - 1];
      if (last && last.source === "pesquisa") last.at = it.checked_at; // histórico com a data da pesquisa
      if (l && it.available === true && l.available !== true) { l.available = true; refresh(state, l, deps); }
    }
    state.meta.feed_seen[key] = it.checked_at;
  }
  state.meta.feed_generated_at = feed.generated_at || null;
  recomputeDuplicates(state);
  return res;
}

// ------------------------------------------------------------------ reconferência / edição
export function reconfirm(state, l, { available, price, km, note }, deps) {
  const data = {};
  if (price != null && price !== "") data.price = price;
  if (km != null && km !== "") data.km = km;
  setManualFields(l, data);
  l.available = !!available;
  l.last_checked = nowIso(deps);
  const events = takeSnapshot(l, "reconferencia", deps, true);
  if (note) l.notes = `${l.notes || ""}\n[${fmtDate(nowIso(deps))}] ${note}`.trim();
  refresh(state, l, deps, events);
  recomputeDuplicates(state);
  return events;
}

export async function editFields(state, l, data, deps) {
  const changed = setManualFields(l, data);
  if (changed.some((f) => ["city", "state", "address"].includes(f))) await updateDistance(state, l, deps);
  const events = changed.some((f) => ["price", "km"].includes(f)) ? takeSnapshot(l, "edicao_manual", deps) : [];
  refresh(state, l, deps, events);
  recomputeDuplicates(state);
  return changed;
}

export function reclassifyAll(state, deps) {
  for (const l of state.listings) if (!l.archived) refresh(state, l, deps);
  recomputeDuplicates(state);
}

/** Calcula as distâncias pendentes uma a uma (chamada em segundo plano). onEach(l) após cada uma. */
export async function fillDistances(state, deps, onEach) {
  let n = 0;
  for (const l of state.listings) {
    if (l.archived || l.distance?.status !== "nao_verificada" || !l.city || !l.state) continue;
    const tried = l.distance?.tried_at ? new Date(l.distance.tried_at) : null;
    if (tried && (deps?.now ? deps.now() : new Date()) - tried < 6 * 3600000) continue; // falhou há pouco: tenta de novo depois
    await updateDistance(state, l, deps);
    if (l.distance.status !== "verificada" && l.distance.status !== "manual") l.distance.tried_at = nowIso(deps);
    refresh(state, l, deps);
    if (l.distance.status === "verificada") n++;
    onEach?.(l);
  }
  return n;
}

/** Reaplica a extração nos textos já guardados (migração quando surgem campos novos). */
export function reparseTexts(l) {
  for (const t of l.texts || []) applyParsed(l, deriveFields(extractFromText(t.content, "texto_colado")));
}

// ------------------------------------------------------------------ contato com o vendedor
export function contactMessage(state, l, template = null) {
  const t = template ?? state.settings.contact_template ?? CONTACT_TEMPLATE_DEFAULT;
  const cap = (x) => String(x || "").toLowerCase().replace(/(^|[\s/-])([a-zà-ÿ])/g, (m, a, c) => a + c.toUpperCase());
  const ver = cap(String(l.version || "").replace(/^(\d)(\d)\b/, "$1.$2")).replace(/\b(Tsi|Tgdi|Tce|Cvt|Edc|At|Gdi|Mt)\b/g, (m) => m.toUpperCase());
  const carro = [cap(l.make), cap(l.model), ver].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || "carro";
  return t.replace(/\{carro\}/g, carro).replace(/\{ano\}/g, l.year_fab && l.year_model ? `${l.year_fab}/${l.year_model}` : (l.year_model ?? ""))
    .replace(/\{preco\}/g, l.price != null ? brl(l.price) : "preço anunciado").replace(/\{km\}/g, l.km != null ? `${l.km.toLocaleString("pt-BR")} km` : "")
    .replace(/\{link\}/g, l.url).replace(/\{meu_carro\}/g, state.settings.my_car || MY_CAR_DEFAULT).replace(/\s+([,.!?])/g, "$1").replace(/ {2,}/g, " ");
}
/** Link do WhatsApp para um telefone brasileiro (com DDD). null se o número for inválido. */
export function whatsappLink(phone, text) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return `https://wa.me/55${d}?text=${encodeURIComponent(text)}`;
}

// ------------------------------------------------------------------ rotina ao abrir
export function isStale(l, days, deps) {
  if (l.archived || l.available === false || l.status === DISCARDED) return false;
  if (!l.last_checked) return true;
  const now = deps?.now ? deps.now() : new Date();
  return now - new Date(l.last_checked) > days * 86400000;
}
export const staleListings = (state, deps) => state.listings.filter((l) => isStale(l, state.settings.stale_days, deps));

/** Executada ao abrir o app (se a última tiver mais de N horas) ou manualmente. Nunca acessa o WebMotors. */
export async function runRoutine(state, deps, { force = false } = {}) {
  const now = deps?.now ? deps.now() : new Date();
  const last = state.meta.last_routine ? new Date(state.meta.last_routine) : null;
  if (!force && last && now - last < state.settings.routine_hours * 3600000) return null;
  const summary = { processados: 0, distancias_calculadas: 0, novos_aprovados: 0, a_reconferir: 0 };
  for (const l of state.listings) {
    if (l.archived) continue;
    if (l.distance?.status === "nao_verificada" && l.city && l.state) {
      await updateDistance(state, l, deps);
      if (l.distance.status === "verificada") summary.distancias_calculadas++;
    }
    const old = l.status;
    refresh(state, l, deps);
    if (l.status === APPROVED && old !== APPROVED) summary.novos_aprovados++;
    summary.processados++;
  }
  recomputeDuplicates(state);
  const stale = staleListings(state, deps);
  summary.a_reconferir = stale.length;
  if (stale.length && state.settings.notify.review_digest)
    notify(state, "reconferir", `${stale.length} anúncio(s) para reconferir`,
      `Sem confirmação de preço/disponibilidade há mais de ${state.settings.stale_days} dia(s):\n` +
      stale.slice(0, 15).map((l) => `• ${listingName(l)}`).join("\n"), `reconferir:${now.toISOString().slice(0, 10)}`, null, deps);
  state.meta.last_routine = now.toISOString();
  state.meta.routines = [{ at: now.toISOString(), ...summary }, ...(state.meta.routines || [])].slice(0, 20);
  return summary;
}

export function fmtDate(iso, tz = "America/Sao_Paulo") {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}
