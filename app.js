"use strict";
import { TR_LABEL } from "./core/classify.js";
import { makeDistance } from "./core/distance.js";
import * as E from "./core/engine.js";
import { ITEMS } from "./core/equipment.js";
import { firstUrl } from "./core/parsing.js";
import { SEED_SPECS, exclusionLabel, findExclusion as findExcl, validateSpec } from "./core/specs.js";
import { CATALOG, CITIES, ignoreSuggestions } from "./core/catalog.js";
import { LEVEL_LABEL, byAdherence, fipeDiscount } from "./core/score.js";
import { loadState, requestPersistence, saveState } from "./core/store.js";

// ---------------------------------------------------------------- utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = (v) => v == null ? "—" : "R$ " + Math.round(v).toLocaleString("pt-BR");
const num = (v, suf = "") => v == null ? "—" : Math.round(v).toLocaleString("pt-BR") + suf;
const STATUS = { aprovado: "Aprovado", pendente: "Pendente", descartado: "Descartado", atende: "Atende ✓" };
/** Aba/rótulo exibidos: "aprovado" só quando VOCÊ aprovou; atender a tudo = "atende" (aguarda sua decisão, fica em Pendentes). */
const shown = (l) => l.status === "descartado" ? "descartado" : l.user_approve ? "aprovado" : l.status === "aprovado" ? "atende" : "pendente";
const tabOf = (l) => ({ atende: "pendente" })[shown(l)] || shown(l);
const EQ_ICON = { confirmado: "✓", pendente: "?", ausente: "✕" };
const TR = { automatico: "Automático", automatizado: "Automatizado", manual: "Manual" };
const SELLER = { particular: "Particular", loja: "Loja", concessionaria: "Concessionária" };
const RODIZIO = { 1: "segunda", 2: "segunda", 3: "terça", 4: "terça", 5: "quarta", 6: "quarta", 7: "quinta", 8: "quinta", 9: "sexta", 0: "sexta" };
const FEATURE_LABEL = { unico_dono: "único dono", revisoes_concessionaria: "revisões na concessionária", garantia_fabrica: "garantia de fábrica", ipva_pago: "IPVA pago", licenciado: "licenciado" };
const BODY = { hatch: "Hatch", sedan: "Sedã", suv: "SUV", picape: "Picape", outro: "Outra" };
const pct = (v) => Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
/** Posição do preço em relação à FIPE — sempre exibida no cartão. */
function fipeInfo(l) {
  const fd = fipeDiscount(l);
  if (fd == null) return l.below_fipe_tag ? { cls: "below", text: "abaixo da FIPE (selo)", val: "" } : { cls: "none", text: "FIPE não informada", val: "" };
  const val = brl(l.fipe);
  if (Math.abs(fd) < 1) return { cls: "at", text: "no valor da FIPE", val };
  return fd > 0 ? { cls: "below", text: `${pct(fd)} abaixo da FIPE`, val } : { cls: "above", text: `${pct(fd)} acima da FIPE`, val };
}
function fipeLine(l) {
  const f = fipeInfo(l), icon = { below: "▼", above: "▲", at: "＝", none: "?" }[f.cls];
  return `<div class="fipeLine ${f.cls}"><span class="fipeTag">${icon} ${esc(f.text)}</span>${f.val ? `<span class="small">FIPE ${f.val}${l.price && l.fipe ? ` · ${l.price < l.fipe ? "−" : "+"}${brl(Math.abs(l.price - l.fipe))}` : ""}</span>` : ""}</div>`;
}
function fipeChip() { return ""; } // posição na FIPE agora fica em linha própria (fipeLine)
const isBelowFipe = (l) => (fipeDiscount(l) ?? 0) > 0 || (fipeDiscount(l) == null && !!l.below_fipe_tag);
const SHORT = { adas: "ADAS", inducao: "Indução", android_auto_sem_fio: "AA sem fio" };
const safeUrl = (u) => /^https?:\/\//i.test(u || "") ? u : "#";

// mostra erros na tela (ajuda a diagnosticar no celular)
window.addEventListener("error", (e) => { try { toast(`Erro no app: ${e.message}`); } catch { /* ok */ } });
window.addEventListener("unhandledrejection", (e) => { const m = String(e.reason?.message || e.reason || "");
  if (/fetch|network|load failed|abort/i.test(m)) return; try { toast(`Erro no app: ${m}`); } catch { /* ok */ } });
let S = null;                        // estado (persistido no IndexedDB)
const ui = { status: "aprovado", compare: new Set(), openId: null, since: null };
const deps = {
  distance: makeDistance(),
  onNotify: (n) => systemNotify(n),
};

function toast(msg, action = null, label = "Desfazer", ms = 3400) {
  const t = $("#toast"); t.textContent = msg;
  if (action) { const b = document.createElement("button"); b.className = "toastBtn"; b.textContent = label;
    b.onclick = () => { t.classList.remove("show"); action(); }; t.append(b); ms = Math.max(ms, 5500); }
  t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(S).catch((e) => toast("Falha ao salvar: " + e.message)), 150);
}
async function act(btn, fn) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); persist(); return r; }
  catch (e) { console.error(e); toast(e.message || String(e)); }
  finally { if (btn) btn.disabled = false; }
}
const byId = (id) => S.listings.find((l) => l.id === id);

async function systemNotify(n) {
  if (!S?.settings.notify.system || !("Notification" in window) || Notification.permission !== "granted") return;
  await new Promise((r) => setTimeout(r, 20000)); // espera a distância/classificação assentar
  if (!alertRelevant(n)) return; // não avisa sobre anúncio que saiu dos seus critérios
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: n.message, icon: "icons/icon-192.png", tag: n.dedupe, data: { listing: n.listing_id } };
    if (reg) reg.showNotification(n.title, opts); else new Notification(n.title, opts);
  } catch { /* ignora */ }
}

// ---------------------------------------------------------------- seleções
const range = (a, b, step) => { const o = []; for (let v = a; v <= b; v += step) o.push(v); return o; };
const THIS_YEAR = new Date().getFullYear();
const OPTS = {
  max_price: range(40000, 200000, 5000), year: range(2010, THIS_YEAR + 1, 1), max_km: range(5000, 150000, 5000),
  max_distance_km: [10, 20, 30, 40, 50, 60, 70, 80, 100, 120, 150, 200, 300],
  price_drop_min_pct: [0, 0.5, 1, 2, 3, 5, 10], price_drop_min_abs: [0, 500, 1000, 2000, 3000, 5000, 10000],
  stale_days: [1, 2, 3, 5, 7, 10, 15, 30], routine_hours: [1, 3, 6, 12, 24, 48],
};
function fillSelect(sel, values, current, fmt = String) {
  const vals = [...new Set([...values, ...(current != null && current !== "" ? [current] : [])])].sort((a, b) => a - b);
  sel.innerHTML = vals.map((v) => `<option value="${v}" ${String(v) === String(current) ? "selected" : ""}>${esc(fmt(v))}</option>`).join("");
}
/** Seleção com valores prontos + "Outro valor…" (abre campo para digitar). */
function fillCombo(sel, values, current, fmt, emptyLabel) {
  fillSelect(sel, values, current, fmt);
  sel.insertAdjacentHTML("afterbegin", `<option value="" ${current == null ? "selected" : ""}>${esc(emptyLabel)}</option>`);
  sel.insertAdjacentHTML("beforeend", `<option value="__other">Outro valor…</option>`);
  const wrap = $(`[data-custom="${sel.name}"]`); if (wrap) { wrap.hidden = true; wrap.querySelector("input").value = current ?? ""; }
  sel.onchange = () => { if (wrap) { wrap.hidden = sel.value !== "__other"; if (!wrap.hidden) wrap.querySelector("input").focus(); } };
}
function comboValue(form, name) {
  const v = form.elements[name].value;
  if (v === "__other") { const c = form.elements[name + "_custom"].value; return c === "" ? null : Number(c); }
  return v === "" ? null : Number(v);
}

function updateTitle() {
  const c = new Set(S.settings.criteria.conditions || []);
  const used = c.has("usado") || c.has("seminovo");
  const sub = c.has("novo") && used ? "novos e seminovos" : c.has("novo") ? "0 km" : "seminovos";
  $("#brandSub").textContent = sub;
  document.title = `CarMonitor · ${sub}`;
}

// ---------------------------------------------------------------- navegação
$("#nav").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) showView(b.dataset.view); });
function showView(v) {
  $$("#nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === v));
  $$(".view").forEach((x) => x.classList.toggle("active", x.id === "view-" + v));
  saveCompare();
  if (v === "compare") renderCompare();
  if (v === "alerts") renderAlerts();
  if (v === "settings") renderSettings();
  if (v === "alerts") fillNotify();
  window.scrollTo(0, 0);
}
$("#settingsNav").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sub]"); if (!b) return;
  $$("#settingsNav button").forEach((x) => x.classList.toggle("active", x === b));
  $$(".subview").forEach((x) => x.classList.toggle("active", x.id === "sub-" + b.dataset.sub));
});
function openSheet(id) { $(id).classList.add("open"); document.body.style.overflow = "hidden"; }
function closeSheet(id) { $(id).classList.remove("open"); document.body.style.overflow = ""; if (id === "#detailSheet") ui.openId = null; }
$$(".sheet").forEach((s) => s.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet("#" + s.id); }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".sheet.open").forEach((s) => closeSheet("#" + s.id)); });
window.addEventListener("popstate", () => $$(".sheet.open").forEach((s) => closeSheet("#" + s.id)));

// ---------------------------------------------------------------- lista
// Cada aba guarda a própria busca e ordenação.
const TAB_KEY = "tabFilters";
let tabFilters = {};
try { tabFilters = JSON.parse(localStorage.getItem(TAB_KEY) || "{}") || {}; } catch { tabFilters = {}; }
const tabState = (t) => (tabFilters[t] ??= { q: "", sort: "score" });
function saveTabFilters() { try { localStorage.setItem(TAB_KEY, JSON.stringify(tabFilters)); } catch { /* ok */ } }
function selectTab(status, dir = 0) {
  const b = $(`#statusTabs button[data-status="${status}"]`); if (!b) return;
  ui.status = status;
  $$("#statusTabs button").forEach((x) => x.classList.toggle("active", x === b));
  b.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  const st = tabState(status);
  $("#q").value = st.q; $("#sort").value = st.sort;
  renderCards();
  if (dir) { const c = $("#cards"); c.classList.remove("slideL", "slideR"); void c.offsetWidth; c.classList.add(dir > 0 ? "slideL" : "slideR"); }
}
$("#statusTabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (b) selectTab(b.dataset.status);
});
$("#q").addEventListener("input", () => { tabState(ui.status).q = $("#q").value; saveTabFilters(); renderCards(); });
$("#sort").addEventListener("change", () => { tabState(ui.status).sort = $("#sort").value; saveTabFilters(); renderCards(); });
// deslizar para a esquerda/direita troca de aba
(() => {
  let x0 = null, y0 = null;
  const skip = (t) => !!t.closest(".statusTabs, .tableWrap, .sheet, input, select, textarea");
  const view = document;
  const onList = () => $("#view-listings").classList.contains("active") && !$(".sheet.open");
  view.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || !onList() || skip(e.target) || e.target.closest(".bottomNav, .cmpBar, header")) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  view.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const tabs = $$("#statusTabs button").map((b) => b.dataset.status);
    const i = tabs.indexOf(ui.status), j = i + (dx < 0 ? 1 : -1);
    if (j >= 0 && j < tabs.length) selectTab(tabs[j], dx < 0 ? 1 : -1);
  }, { passive: true });
})();

const title = (l) => [l.make, l.model].filter(Boolean).join(" ") || l.title || `Anúncio #${l.id}`;
function distText(l) {
  const d = l.distance || {};
  if (d.status === "nao_verificada" || d.km == null) return "não verificada";
  return num(d.km, " km") + (d.status === "manual" ? " (informada)" : d.precision === "cidade" ? " (centro da cidade)" : "");
}
const stale = (l) => E.isStale(l, S.settings.stale_days);

function renderCards() {
  const q = $("#q").value.trim().toLowerCase();
  let items = S.listings.filter((l) => !l.archived);
  const counts = { aprovado: 0, pendente: 0, descartado: 0 };
  items.forEach((l) => counts[tabOf(l)]++);
  $("#c-aprovado").textContent = counts.aprovado; $("#c-pendente").textContent = counts.pendente;
  $("#c-descartado").textContent = counts.descartado;
  $("#c-fav").textContent = items.filter((l) => l.favorite).length;
  items = ui.status === "favoritos" ? items.filter((l) => l.favorite) : items.filter((l) => tabOf(l) === ui.status);
  if (q) items = items.filter((l) => [l.make, l.model, l.version, l.city, l.title].join(" ").toLowerCase().includes(q));
  const keyf = {
    price: (l) => l.price ?? 1e12, km: (l) => l.km ?? 1e12, distance: (l) => l.distance?.km ?? 1e12,
    recent: (l) => -new Date(l.first_seen).getTime(),
    fipe: (l) => -(fipeDiscount(l) ?? (l.below_fipe_tag ? 0.01 : -100)),
  }[$("#sort").value];
  items.sort(keyf ? (a, b) => keyf(a) - keyf(b) : byAdherence);
  // mesmo carro anunciado mais de uma vez: um cartão só (o de menor preço), com o número de anúncios iguais
  const best = new Map();
  for (const l of items) if (l.duplicate_group) { const b = best.get(l.duplicate_group); if (!b || (l.price ?? 1e12) < (b.price ?? 1e12)) best.set(l.duplicate_group, l); }
  const dupCount = (l) => l.duplicate_group ? S.listings.filter((o) => !o.archived && o.duplicate_group === l.duplicate_group).length - 1 : 0;
  items = items.filter((l) => !l.duplicate_group || best.get(l.duplicate_group) === l);
  const ranking = S.listings.filter((l) => !l.archived).sort(byAdherence).map((l) => l.id);
  $("#unread").textContent = S.notifications.filter((n) => !n.read && alertRelevant(n)).length;
  const el = $("#cards");
  if (!items.length) {
    el.innerHTML = `<div class="empty">${S.listings.length ? "Nada neste filtro." :
      "Nenhum anúncio ainda. A pesquisa automática traz os anúncios por volta das 6h e das 13h."}</div>`;
    return;
  }
  el.innerHTML = items.map((l) => {
    const first = l.snapshots.find((s) => s.price)?.price;
    const delta = first && l.price && l.price !== first ? `<span class="delta ${l.price < first ? "down" : "up"}">${l.price < first ? "▼" : "▲"} ${brl(Math.abs(l.price - first))}</span>` : "";
    const optAdas = !S.settings.criteria.adas_required;
    const chips = fipeChip(l) + Object.keys(ITEMS).map((k) => {
      const c = l.checks[k] || { state: "pendente" };
      const cls = k === "adas" && optAdas && c.state !== "confirmado" ? "info" : c.state;
      return `<span class="chip ${cls}" title="${esc(ITEMS[k])}">${EQ_ICON[c.state]} ${SHORT[k]}${k === "adas" && optAdas ? " (desejável)" : ""}${c.method === "ficha" ? " ·ficha" : ""}</span>`;
    }).join("");
    const extra = [
      l.excluded ? `<span class="chip ausente">modelo ignorado</span>` : "",
      ...(l.features || []).map((k) => `<span class="chip confirmado">${FEATURE_LABEL[k] || k}</span>`),
      l.whatsapp ? `<span class="chip info">aceita WhatsApp</span>` : "",
      !l.seller_type && l.status === "pendente" ? `<span class="chip pendente">vendedor a verificar</span>` : "",
      l.auction ? `<span class="chip ausente">passou por leilão</span>` : "",
      l.armored ? `<span class="chip ausente">blindado</span>` : "",
      dupCount(l) ? `<span class="chip info">+${dupCount(l)} anúncio(s) do mesmo carro</span>` : "",
      l.available === false ? `<span class="chip ausente">indisponível</span>` : "",
      stale(l) ? `<span class="chip pendente">reconferir</span>` : "",
      l.unavailable_since ? `<span class="chip ausente">saiu do ar em ${esc(E.fmtDate(l.unavailable_since).slice(0, 10))}</span>` : "",
    ].join("");
    const sc = l.score || { total: 0, level: "baixa" };
    const cmpOn = ui.compare.has(l.id);
    const isNew = ui.since && l.first_seen && new Date(l.first_seen) > new Date(ui.since);
    return `<article class="card st-${l.status}" data-card="${l.id}">
      <div class="cardTop"><span>${isNew ? `<span class="newTag">NOVO</span> ` : ""}<span class="badge ${shown(l)}">${STATUS[shown(l)]}</span>
        <button class="scoreBtn ${sc.level}" data-score="${l.id}" aria-label="${sc.total == null ? "Sem nota (descartado)" : `Nota ${sc.total} de 100`}. Toque para detalhes">🎯 ${sc.total ?? "—"}</button></span><span class="topIcons">
        <label class="cmpFlag ${cmpOn ? "on" : ""}" title="Marcar para comparar"><input type="checkbox" data-cmpflag="${l.id}" ${cmpOn ? "checked" : ""}> ⇆</label>
        <button class="favBtn ${l.favorite ? "on" : ""}" data-fav="${l.id}" aria-label="${l.favorite ? "Remover dos favoritos" : "Favoritar"}">${l.favorite ? "★" : "☆"}</button></span></div>
      <h3>${esc(title(l))} ${l.year_model ? `<span class="small">${esc(l.year_fab ? l.year_fab + "/" : "")}${esc(l.year_model)}</span>` : ""}</h3>
      <div class="ver">${esc(l.version || "versão não informada")}</div>
      <div><span class="price">${brl(l.price)}</span>${delta}</div>
      ${fipeLine(l)}
      <div class="facts">
        <div><span>Km</span> ${num(l.km)}</div><div><span>Câmbio</span> ${esc(TR[l.transmission] || "—")}</div>
        <div><span>Local</span> ${esc(l.city ? l.city + "/" + (l.state || "?") : "—")}</div><div><span>Distância</span> <span data-dist="${l.id}">${esc(distText(l))}</span></div>
        <div style="grid-column:1/-1"><span>Vendedor</span> ${esc(l.seller || "—")}${l.seller_type ? ` · ${SELLER[l.seller_type]}` : ""}</div>
        ${l.plate_end != null ? `<div style="grid-column:1/-1"><span>Placa final ${l.plate_end}</span> · rodízio SP: ${RODIZIO[l.plate_end]}</div>` : ""}
      </div>
      ${whyBox(l)}
      <div class="chips">${chips}${extra}</div>
      <div class="cardActions">
        ${l.user_discard || l.user_approve ? `<button class="wide" data-undiscard="${l.id}">↺ Desfazer ${l.user_approve ? "aprovação" : "descarte"}</button>`
          : l.status !== "descartado" ? `<button class="okBtn" data-approve="${l.id}">✓ Aprovar</button><button class="danger" data-discard="${l.id}">✕ Descartar</button>` : ""}
        <a class="btn ghost wide" data-ext href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">Ver anúncio no WebMotors ↗</a>
      </div></article>`;
  }).join("");
}
/** Motivo do descarte em destaque no cartão (os motivos de reprovação, em ordem). */
function whyBox(l) {
  if (l.status !== "descartado") return "";
  const fails = (l.reasons || []).filter((r) => r.level === "fail").map((r) => r.msg);
  if (!fails.length) return "";
  const more = fails.length > 2 ? ` <span class="small">+${fails.length - 2} motivo(s)</span>` : "";
  return `<div class="why">✕ ${fails.slice(0, 2).map(esc).join("<br>✕ ")}${more}</div>`;
}
const prettyVer = (v) => cap(String(v || "").replace(/^(\d)(\d)\b/, "$1.$2").toLowerCase());
const DISCARD_REASONS = ["Vendedor particular", "Preço alto", "Km alta", "Não gostei do modelo/versão", "Cor", "Longe demais", "Estado do carro / fotos", "Já foi vendido"];
function openDiscard(id) {
  const l = byId(id); if (!l) return;
  $("#discardBody").innerHTML = `<p><b>${esc(title(l))} ${esc(l.year_model || "")}</b><br><span class="small">${esc(l.version || "")} · ${brl(l.price)}</span></p>
    <p class="small">Por que descartar? (opcional)</p>
    <div class="chips">${DISCARD_REASONS.map((r) => `<button type="button" class="chipBtn" data-reason="${esc(r)}">${esc(r)}</button>`).join("")}</div>
    <form id="discardForm" data-id="${id}"><label>Motivo<input name="reason" maxlength="120" placeholder="Escolha acima ou escreva"></label>
    <fieldset class="scope"><legend>Descartar</legend>
      <label class="chk"><input type="radio" name="scope" value="one" checked> Só este anúncio</label>
      ${l.model && l.version ? `<label class="chk"><input type="radio" name="scope" value="version"> Todos os ${esc(cap(l.model))} ${esc(prettyVer(l.version))} <span class="small">(ignorar a versão)</span></label>` : ""}
      ${l.model ? `<label class="chk"><input type="radio" name="scope" value="model"> Todos os ${esc(cap(l.make || ""))} ${esc(cap(l.model))} <span class="small">(ignorar o modelo)</span></label>` : ""}
    </fieldset>
    <div class="cardActions"><button class="danger" type="submit">✕ Descartar</button><button type="button" class="ghost" data-close>Cancelar</button></div></form>`;
  openSheet("#discardSheet"); history.pushState({ sheet: 4 }, "");
}
$("#discardSheet").addEventListener("click", (e) => {
  const b = e.target.closest("[data-reason]"); if (!b) return;
  const inp = $("#discardForm").reason;
  inp.value = inp.value && !inp.value.includes(b.dataset.reason) ? `${inp.value}; ${b.dataset.reason}` : b.dataset.reason;
});
$("#discardSheet").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target, l = byId(+f.dataset.id); if (!l) return;
  const scope = f.scope?.value || "one", reason = f.reason.value.trim();
  act(null, async () => {
    closeSheet("#discardSheet");
    if (scope === "one") {
      const prev = { d: l.user_discard, a: l.user_approve };
      l.user_discard = { reason, at: new Date().toISOString() }; delete l.user_approve;
      E.reclassify(S, l); renderCards(); if (ui.openId === l.id) renderDetail(l);
      toast("Descartado.", () => act(null, async () => { l.user_discard = prev.d; if (prev.a) l.user_approve = prev.a; if (!prev.d) delete l.user_discard;
        E.reclassify(S, l); renderCards(); if (ui.openId === l.id) renderDetail(l); toast("Descarte desfeito."); }));
    } else {
      const rule = { make: l.make || "", model: l.model, version_includes: scope === "version" ? l.version : "", reason,
        label: (scope === "version" ? `${cap(l.make || "")} ${cap(l.model)} — só ${prettyVer(l.version)}` : `${cap(l.make || "")} ${cap(l.model)} (todas as versões)`).toUpperCase() };
      const n = S.listings.filter((x) => !x.archived && findExcl([rule], x)).length;
      S.exclusions.push(rule); E.reclassifyAll(S, deps); renderCards(); if (ui.openId === l.id) renderDetail(l); filterChanged();
      toast(`${n} anúncio(s) descartado(s); modelo adicionado aos ignorados.`, () => act(null, async () => {
        S.exclusions = S.exclusions.filter((r) => r !== rule); E.reclassifyAll(S, deps); renderCards(); filterChanged(); toast("Desfeito."); }));
    }
  });
});
function undiscard(id) {
  const l = byId(id); if (!l) return;
  act(null, async () => { delete l.user_discard; delete l.user_approve; E.reclassify(S, l); renderCards(); if (ui.openId === id) renderDetail(l); toast("Decisão desfeita: voltou à classificação automática."); });
}
function approve(id) {
  const l = byId(id); if (!l) return;
  const pend = (l.reasons || []).filter((r) => r.level === "pending").map((r) => "• " + r.msg).join("\n");
  if (pend && !confirm(`Aprovar este anúncio mesmo com itens pendentes?\n\n${pend}\n\nUse quando você mesmo já conferiu esses itens.`)) return;
  act(null, async () => { l.user_approve = { at: new Date().toISOString() }; E.reclassify(S, l); renderCards(); if (ui.openId === id) renderDetail(l);
    toast("Aprovado. Está na aba Aprovados.", () => act(null, async () => { delete l.user_approve; E.reclassify(S, l); renderCards(); if (ui.openId === id) renderDetail(l); toast("Aprovação desfeita."); })); });
}
$("#cards").addEventListener("click", (e) => {
  const dc = e.target.closest("[data-discard]");
  if (dc) { openDiscard(+dc.dataset.discard); return; }
  const ud = e.target.closest("[data-undiscard]");
  if (ud) { undiscard(+ud.dataset.undiscard); return; }
  const f = e.target.closest("[data-fav]");
  if (f) { toggleFav(+f.dataset.fav); return; }
  const cf = e.target.closest("[data-cmpflag]");
  if (cf) { toggleCompare(+cf.dataset.cmpflag, cf); return; }
  if (e.target.closest(".cmpFlag")) return;
  const ap = e.target.closest("[data-approve]");
  if (ap) { approve(+ap.dataset.approve); return; }
  const sb = e.target.closest("[data-score]");
  if (sb) { openScore(+sb.dataset.score); return; }
  const b = e.target.closest("[data-open]"); if (b) { openDetail(+b.dataset.open); return; }
  if (e.target.closest("button, a, label, input, select")) return;
  const card = e.target.closest("[data-card]"); if (card) openDetail(+card.dataset.card); // tocar no cartão abre o detalhe
});
function toggleFav(id) {
  const l = byId(id); if (!l) return;
  act(null, async () => { l.favorite = !l.favorite; renderCards(); if (ui.openId === id) renderDetail(l); toast(l.favorite ? "Adicionado aos favoritos." : "Removido dos favoritos."); });
}
function addToCompare(id) {
  if (!ui.compare.has(id)) {
    if (ui.compare.size >= 5) return toast("Máximo de 5 veículos. Remova um no comparativo.");
    ui.compare.add(id); saveCompare();
  }
  closeSheet("#detailSheet"); showView("compare");
}
// links externos: abre explicitamente (mais confiável no app instalado)
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-ext]"); if (!a) return;
  e.preventDefault();
  const url = a.getAttribute("href"); if (!url || url === "#") return;
  openExternal(url);
});
// guarda onde você estava (aba, anúncio aberto, rolagem) para voltar ao mesmo ponto depois de ir ao WebMotors
const UI_KEY = "uiState";
function saveUi() {
  try {
    const view = $(".view.active")?.id?.replace("view-", "") || "listings";
    localStorage.setItem(UI_KEY, JSON.stringify({ t: Date.now(), view, status: ui.status, openId: ui.openId,
      y: window.scrollY, dy: $("#detailSheet").scrollTop }));
  } catch { /* ok */ }
}
function restoreUi() {
  let st = null; try { st = JSON.parse(localStorage.getItem(UI_KEY) || "null"); } catch { /* ok */ }
  if (!st || Date.now() - st.t > 60 * 60000) return false; // só se foi há menos de 1 h
  if (st.view && st.view !== "listings") showView(st.view);
  if (st.status) selectTab(st.status);
  setTimeout(() => window.scrollTo(0, st.y || 0), 50);
  if (st.openId && byId(st.openId)) { openDetail(st.openId); setTimeout(() => { $("#detailSheet").scrollTop = st.dy || 0; }, 80); }
  return true;
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveUi(); });
window.addEventListener("pagehide", saveUi);
function openExternal(url) {
  saveUi();
  const w = window.open(url, "_blank");
  if (w) { try { w.opener = null; } catch { /* ok */ } } else location.href = url; // bloqueado: abre na mesma janela
}
function toggleCompare(id, input) {
  if (ui.compare.has(id)) ui.compare.delete(id);
  else if (ui.compare.size >= 5) { if (input) input.checked = false; return toast("Máximo de 5 veículos para comparar."); }
  else ui.compare.add(id);
  saveCompare();
  input?.closest(".cmpFlag")?.classList.toggle("on", ui.compare.has(id));
}
$("#cmpBarGo").onclick = () => showView("compare");
$("#cmpBarClear").onclick = () => { ui.compare.clear(); saveCompare(); renderCards(); };
function saveCompare() {
  $("#cmpCount").textContent = ui.compare.size;
  const bar = $("#cmpBar"), onList = $("#view-listings").classList.contains("active");
  bar.hidden = !(ui.compare.size >= 1 && onList);
  $("#cmpBarText").textContent = ui.compare.size === 1 ? "1 selecionado · escolha mais um para comparar" : `${ui.compare.size} selecionados`;
  $("#cmpBarGo").disabled = ui.compare.size < 2;
  $("#cmpBarGo").textContent = ui.compare.size >= 2 ? `⇆ Comparar ${ui.compare.size}` : "⇆ Comparar";
  try { localStorage.setItem("cmp", JSON.stringify([...ui.compare])); } catch { /* sem armazenamento */ }
}

// ---------------------------------------------------------------- importar
$("#addBtn").onclick = () => openImport();
function openImport(url = "", text = "") {
  const f = $("#importForm"); f.url.value = url; f.text.value = text; $("#importResult").innerHTML = "";
  openSheet("#importSheet");
  history.pushState({ sheet: 1 }, "");
}
$("#pasteBtn").onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) return toast("A área de transferência está vazia.");
    const f = $("#importForm");
    if (!f.url.value) f.url.value = firstUrl(t) || "";
    if (t.trim() !== f.url.value.trim()) f.text.value = t;
    toast(`${t.length.toLocaleString("pt-BR")} caracteres colados.`);
  } catch { toast("Sem permissão para ler a área de transferência; use o colar do teclado."); }
};
$("#importForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target, btn = $("button[type=submit]", f);
  const url = firstUrl(f.url.value) || f.url.value.trim();
  $("#importResult").innerHTML = `<div class="msg warn">Analisando… (calcula a rota se houver cidade)</div>`;
  act(btn, async () => {
    const r = await E.importListing(S, { url, text: f.text.value.trim() || null, origin: "colado" }, deps);
    const cls = r.result === "erro" ? "err" : r.result === "duplicado" ? "warn" : "ok";
    $("#importResult").innerHTML = `<div class="msg ${cls}"><b>${esc(r.result)}</b> — ${esc(r.message)} ${r.id ? `<a href="#" data-open="${r.id}">abrir</a>` : ""}</div>`;
    if (r.result !== "erro") { f.url.value = ""; f.text.value = ""; }
    renderCards();
  });
});
$("#importResult").addEventListener("click", (e) => {
  const a = e.target.closest("[data-open]"); if (!a) return;
  e.preventDefault(); closeSheet("#importSheet"); openDetail(+a.dataset.open);
});

// ---------------------------------------------------------------- detalhe
const FIELD_LABELS = [["make", "Marca"], ["model", "Modelo"], ["version", "Versão"], ["year_fab", "Ano fabricação"],
  ["year_model", "Ano-modelo"], ["price", "Preço"], ["km", "Quilometragem"], ["transmission", "Câmbio"],
  ["condition", "Tipo"], ["city", "Cidade"], ["state", "UF"], ["address", "Endereço/CEP"], ["seller", "Vendedor"], ["seller_type", "Tipo de vendedor"], ["fipe", "Valor FIPE"],
  ["body", "Carroceria"], ["color", "Cor"], ["plate_end", "Final da placa"], ["auction", "Passagem por leilão"], ["armored", "Blindado"]];
const FIELD_EDIT = FIELD_LABELS.filter(([k]) => !["body", "color", "plate_end", "auction", "armored"].includes(k)); // estes vêm só da pesquisa
const fmtField = (k, v) => v == null || v === "" ? "—" : k === "auction" || k === "armored" ? (v === true || v === "true" ? "sim" : "não") : k === "body" ? (BODY[v] || v) : k === "seller_type" ? (SELLER[v] || v) : k === "price" || k === "fipe" ? brl(v) : k === "km" ? num(v, " km") : k === "transmission" ? (TR[v] || v) : v;

function chart(snaps) {
  const pts = snaps.filter((s) => s.price != null);
  if (pts.length < 2) return `<p class="small">O gráfico aparece a partir de duas medições de preço.</p>`;
  const W = 640, H = 170, P = 34, prices = pts.map((s) => s.price), min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
  const x = (i) => P + (i * (W - 2 * P)) / (pts.length - 1), y = (v) => H - P + 10 - ((v - min) / span) * (H - 2 * P);
  const path = pts.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.price).toFixed(1)}`).join("");
  const dots = pts.map((s, i) => `<circle cx="${x(i)}" cy="${y(s.price)}" r="4" fill="${s.available === false ? "var(--bad)" : "var(--accent)"}"><title>${esc(E.fmtDate(s.at))} — ${brl(s.price)}</title></circle>`).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histórico de preço">
    <text x="${P}" y="14" font-size="12" fill="var(--muted)">${brl(max)}</text><text x="${P}" y="${H - 4}" font-size="12" fill="var(--muted)">${brl(min)}</text>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>${dots}</svg></div>`;
}

function openDetail(id) {
  const l = byId(id); if (!l) return toast("Anúncio não encontrado.");
  ui.openId = id; renderDetail(l);
  if (!$("#detailSheet").classList.contains("open")) { openSheet("#detailSheet"); history.pushState({ sheet: 2 }, ""); }
  $("#detailSheet").scrollTop = 0;
}

const REPORT_KINDS = { nao_abre: "o anúncio não abre / dá erro", vendido: "o carro já foi vendido / saiu do ar", dados: "dados errados (preço, km, vendedor, itens)", outro: "outro problema" };
function openReport(id) {
  const l = byId(id); if (!l) return;
  $("#reportBody").innerHTML = `<p><b>${esc(title(l))} ${esc(l.year_model || "")}</b><br><span class="small">${esc(l.version || "")} · ${brl(l.price)}</span></p>
    <form id="reportForm" data-id="${id}">
      <fieldset class="scope"><legend>O que aconteceu?</legend>
        ${Object.entries(REPORT_KINDS).map(([k, t], i) => `<label class="chk"><input type="radio" name="kind" value="${k}" ${i ? "" : "checked"}> ${t[0].toUpperCase() + t.slice(1)}</label>`).join("")}
      </fieldset>
      <label>Detalhes (opcional)<textarea name="text" rows="3" placeholder="ex.: página do WebMotors mostra “anúncio não encontrado”; o preço é outro"></textarea></label>
      <p class="small">“Não abre” e “vendido” tiram o anúncio da análise (vai para Descartados como indisponível). O aviso também vai para a próxima pesquisa reconferir o anúncio.</p>
      <div class="cardActions"><button class="primary" type="submit">Enviar aviso</button><button type="button" class="ghost" data-close>Cancelar</button></div>
    </form>`;
  openSheet("#reportSheet"); history.pushState({ sheet: 6 }, "");
}
$("#reportSheet").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target, l = byId(+f.dataset.id); if (!l) return;
  const kind = f.kind.value, text = f.text.value.trim();
  act($("button[type=submit]", f), async () => {
    const rep = { kind, kind_label: REPORT_KINDS[kind], text, at: new Date().toISOString(), sent: false };
    l.reports = [...(l.reports || []), rep];
    const prevAvail = l.available;
    if (kind === "nao_abre" || kind === "vendido") E.reconfirm(S, l, { available: false, note: `Reportado por você: ${REPORT_KINDS[kind]}${text ? ` — ${text}` : ""}` }, deps);
    rep.sent = await sendProblemReport(l, rep);
    closeSheet("#reportSheet"); renderCards(); if (ui.openId === l.id) renderDetail(l);
    toast(rep.sent ? "Aviso registrado e enviado para a pesquisa reconferir." : "Aviso registrado no app.", (kind === "nao_abre" || kind === "vendido") ? () => act(null, async () => {
      E.reconfirm(S, l, { available: prevAvail !== false, note: "Aviso desfeito" }, deps); renderCards(); if (ui.openId === l.id) renderDetail(l); toast("Desfeito."); }) : null);
  });
});
/** Envia o aviso como issue no GitHub (a pesquisa reconfere o anúncio). Sem token, fica só no app. */
async function sendProblemReport(l, rep) {
  const token = S.settings.github_token; if (!token) return false;
  try {
    const body = `Aviso do app CarMonitor: ${rep.kind_label}.\n\n\`\`\`json\n${JSON.stringify({ url: l.url, kind: rep.kind, text: rep.text, at: rep.at })}\n\`\`\``;
    const r = await fetch(`https://api.github.com/repos/${REPO}/issues`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ title: `Problema no anúncio ${l.url.split("/").pop()} — ${rep.kind_label}`, body }) });
    return r.ok;
  } catch { return false; }
}
const QUESTIONS = {
  inducao: "O carro tem carregador de celular por indução (sem fio)?",
  android_auto_sem_fio: "O Android Auto conecta sem fio (sem cabo)?",
  adas: "Tem frenagem automática de emergência ou outros assistentes de condução?",
  distance: "Qual o endereço onde o carro está?", price: "Qual o valor final?", km: "Qual a quilometragem atual?",
  year_model: "Qual o ano de fabricação e o ano-modelo?", transmission: "O câmbio é automático?",
};
const pendingOf = (d) => (d.reasons || []).filter((r) => r.level === "pending");
function askMessage(d) {
  const qs = pendingOf(d).map((r) => QUESTIONS[r.field]).filter(Boolean);
  const base = E.contactMessage(S, d);
  return qs.length ? `${base}\n\nAntes de agendar, pode me confirmar:\n${qs.map((q) => `- ${q}`).join("\n")}` : base;
}
/** Bloco de decisão no topo do detalhe: o que falta, por que foi descartado, e as ações. */
function decisionBox(d) {
  const undo = d.user_discard || d.user_approve ? `<button id="dUndo">↺ Desfazer ${d.user_approve ? "aprovação" : "descarte"}</button>` : "";
  if (d.status === "descartado") {
    const fails = (d.reasons || []).filter((r) => r.level === "fail").map((r) => `<li>✕ ${esc(r.msg)}</li>`).join("");
    return `<div class="decide bad"><b>Por que foi descartado</b><ul>${fails}</ul>${undo ? `<div class="cardActions">${undo}</div>` : ""}</div>`;
  }
  if (d.status === "aprovado" && d.user_approve) return `<div class="decide ok"><b>✓ Aprovado por você.</b><div class="cardActions">${undo}</div></div>`;
  if (d.status === "aprovado") return `<div class="decide ok"><b>✓ Atende a todos os pré-requisitos.</b> Falta só a sua decisão.
    <div class="cardActions"><button class="okBtn" id="dApprove">✓ Aprovar</button><button class="danger" id="dDiscard">✕ Descartar</button></div></div>`;
  const pend = pendingOf(d);
  const rows = pend.map((r) => r.field === "seller"
    ? `<li class="pq"><span>? Tipo de vendedor <span class="small">(abra o anúncio e veja)</span></span><span class="pqBtns">${Object.entries(SELLER).map(([v, t]) => `<button data-seller="${v}">${t}</button>`).join("")}</span></li>`
    : ITEMS[r.field]
    ? `<li class="pq"><span>? ${esc(ITEMS[r.field])}</span><span class="pqBtns"><button class="okBtn" data-quick="${r.field}:confirmado">✓ Tem</button><button class="danger" data-quick="${r.field}:ausente">✕ Não tem</button></span></li>`
    : `<li class="pq"><span>? ${esc(r.msg)}</span></li>`).join("");
  const hasQ = pend.some((r) => QUESTIONS[r.field]);
  return `<div class="decide pend"><b>Falta confirmar</b><ul class="pqList">${rows}</ul>
    ${hasQ ? `<button class="wide" id="dAsk">💬 Perguntar ao vendedor</button>` : ""}
    <div class="cardActions"><button class="okBtn" id="dApprove">✓ Aprovar</button><button class="danger" id="dDiscard">✕ Descartar</button></div></div>`;
}
function renderDetail(d) {
  $("#detailBadge").innerHTML = `<span class="badge ${shown(d)}">${STATUS[shown(d)]}</span> <button class="favBtn ${d.favorite ? "on" : ""}" id="dFav" aria-label="Favorito">${d.favorite ? "★" : "☆"}</button>`;
  $("#dFav").onclick = () => toggleFav(d.id);
  const reasons = d.reasons.map((r) => `<li class="${r.level}">${r.level === "ok" ? "✓" : r.level === "fail" ? "✕" : r.level === "info" ? "•" : "?"} ${esc(r.msg)}</li>`).join("");
  const eq = Object.entries(ITEMS).map(([k, label]) => {
    const c = d.checks[k] || { state: "pendente" };
    const how = c.method === "ficha" ? `<span class="chip ficha">pela ficha da versão</span>` : c.method === "manual" ? `<span class="chip info">validação sua</span>` : "";
    return `<div class="eq">
      <div class="eqTop"><b>${esc(label)}</b><span class="chip ${c.state}">${EQ_ICON[c.state]} ${esc(c.state)}</span></div>
      ${how}
      ${c.detail ? `<div><span class="small">Sistema(s):</span> ${esc(c.detail)}</div>` : ""}
      <div class="small">Fonte: ${esc(c.source || "—")} ${c.source_url ? `<a class="srcLink" href="${esc(safeUrl(c.source_url))}" target="_blank" rel="noopener">abrir fonte ↗</a>` : ""}</div>
      ${c.evidence ? `<div class="ev">${esc(c.evidence)}</div>` : ""}
      ${c.note ? `<div class="small">${esc(c.note)}</div>` : ""}
      <details><summary>Validar manualmente</summary>
        <form class="eqForm" data-item="${k}">
          <label>Resultado<select name="state"><option value="confirmado">Confirmado</option><option value="ausente">Ausente</option><option value="pendente">Pendente</option><option value="auto">Voltar ao automático</option></select></label>
          ${k === "adas" ? `<label>Nome do sistema ADAS<input name="detail" placeholder="ex.: Frenagem autônoma de emergência"></label>` : ""}
          <label>Fonte<input name="source" placeholder="ex.: Foto 7 do anúncio; vendedor por WhatsApp em 27/10"></label>
          <label>Evidência<textarea name="evidence" rows="2"></textarea></label>
          <button type="submit">Salvar validação</button>
        </form></details></div>`;
  }).join("");
  const specSearch = `https://www.google.com/search?q=${encodeURIComponent([d.make, d.model, d.version, d.year_model, "itens de série ficha técnica"].filter(Boolean).join(" "))}`;
  const specInfo = d.spec_id ? (() => { const s = E.allSpecs(S).find((x) => x.id === d.spec_id); return s ? `<p class="small">Ficha aplicada: <b>${esc(s.source.title)}</b> (${esc(s.source.quality)}).</p>` : ""; })()
    : `<p class="small">Nenhuma ficha cadastrada para esta versão e ano-modelo. <a href="${esc(specSearch)}" target="_blank" rel="noopener">Pesquisar ficha ↗</a> · <a href="#" id="dNewSpec">cadastrar ficha</a></p>`;
  const snaps = d.snapshots.slice().reverse().map((s) => `<tr><td>${esc(E.fmtDate(s.at))}</td><td class="num">${brl(s.price)}</td><td class="num">${num(s.km)}</td><td>${s.available === false ? "indisponível" : s.available ? "disponível" : "—"}</td><td class="small">${esc(s.source)}</td></tr>`).join("");
  const texts = d.texts.map((t) => `<div class="eq"><div class="eqTop"><span class="small">Texto ${esc(t.origin || "colado")} · ${esc(E.fmtDate(t.at))} · ${t.content.length} caracteres</span>
      <button class="ghost danger" data-deltext="${esc(t.id)}">Remover</button></div><div class="ev">${esc(t.content.slice(0, 500))}${t.content.length > 500 ? "…" : ""}</div></div>`).join("") || `<p class="small">Nenhum texto do anúncio analisado ainda.</p>`;
  const dups = d.duplicate_group ? S.listings.filter((o) => o.duplicate_group === d.duplicate_group && o.id !== d.id)
    .map((o) => `<li><a href="#" data-open="${o.id}">#${o.id}</a> — ${brl(o.price)} · ${num(o.km, " km")} · ${esc(o.city || "")}</li>`).join("") : "";
  const fields = FIELD_LABELS.map(([k, label]) => `<div class="k">${label}</div><div>${esc(fmtField(k, d[k]))}${d.conflicts?.[k] ? ` <span class="chip pendente">conflito</span>` : ""}</div><div class="src">${esc(E.SOURCE_LABEL[d.field_sources[k]] || "")}</div>`).join("");

  $("#detail").innerHTML = `
    <h2 style="margin:.2rem 0 .3rem">${esc(title(d))} ${esc(d.year_model || "")}</h2>
    <div><span class="price">${brl(d.price)}</span></div>${fipeLine(d)}
    <div class="small">${esc(d.version || "")} · ${num(d.km, " km")} · ${esc(d.city || "")} · ${esc(d.seller || "vendedor não identificado")}${d.seller_type ? ` (${SELLER[d.seller_type]})` : ""}</div>
    ${d.unavailable_since ? `<div class="msg err">Este anúncio saiu do ar em ${esc(E.fmtDate(d.unavailable_since))}. O histórico fica guardado até você excluir.</div>` : ""}
    ${decisionBox(d)}
    <p><a class="btn primary" style="width:100%" data-ext href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer">Abrir anúncio no WebMotors ↗</a></p>
    <p style="text-align:center;margin-top:-.4rem"><button class="ghost small" id="dReport">⚠ O anúncio deu erro ou tem algo errado? Avise aqui</button></p>
    ${(d.reports || []).length ? `<div class="msg warn">Você reportou: ${esc(d.reports[d.reports.length - 1].kind_label)}${d.reports[d.reports.length - 1].text ? ` — “${esc(d.reports[d.reports.length - 1].text)}”` : ""} (${esc(E.fmtDate(d.reports[d.reports.length - 1].at))})${d.reports[d.reports.length - 1].sent ? " · enviado para a pesquisa reconferir" : ""}.</div>` : ""}

    <h3>Nota <button class="scoreBtn ${d.score?.level || "baixa"}" id="dScore">🎯 ${d.score?.total ?? "—"} · ${LEVEL_LABEL[d.score?.level] || ""}</button></h3>
    <h3>Ficha técnica</h3>${techHtml(d)}
    <details class="fold"><summary>Equipamentos — fontes e validação</summary>${specInfo}${eq}</details>
    <details class="fold"><summary>Todos os critérios</summary><ul class="reasons">${reasons}</ul></details>

    <details class="fold"><summary>Dados do anúncio e ferramentas</summary>
    <p class="small">Cadastrado ${esc(E.fmtDate(d.first_seen))} · Última confirmação ${esc(E.fmtDate(d.last_checked))} · Última alteração ${esc(E.fmtDate(d.last_changed))}</p>
    <div class="kv">${fields}</div>
    <details><summary>Corrigir dados</summary>
      <form id="fieldsForm" class="row2" style="margin-top:.5rem">
        ${FIELD_EDIT.map(([k, label]) => k === "transmission"
          ? `<label>${label}<select name="${k}"><option value=""></option>${Object.entries(TR).map(([v, t]) => `<option value="${v}" ${d[k] === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>`
          : k === "seller_type"
          ? `<label>${label}<select name="${k}"><option value=""></option>${Object.entries(SELLER).map(([v, t]) => `<option value="${v}" ${d[k] === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>`
          : k === "condition"
          ? `<label>${label}<select name="${k}"><option value=""></option>${["usado", "seminovo", "novo"].map((v) => `<option ${d[k] === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>`
          : `<label>${label}<input name="${k}" value="${esc(d[k] ?? "")}" ${["price", "km", "year_fab", "year_model", "fipe"].includes(k) ? 'type="number" inputmode="numeric"' : ""}></label>`).join("")}
        <button type="submit" class="primary">Salvar correções</button>
      </form></details>

    <h3>Distância por estrada</h3>
    <p>${esc(distText(d))} <span class="small">${esc(d.distance?.note || "")}</span></p>
    <form id="distForm" class="row2">
      <label>Km por estrada<input type="number" inputmode="decimal" name="km" step="0.1" min="0"></label>
      <label>Fonte<input name="source" placeholder="ex.: Google Maps até a loja"></label>
      <button type="submit">Informar</button><button type="button" id="dRecalc">Recalcular</button>
    </form>

    <h3>Histórico de preço, km e disponibilidade</h3>${chart(d.snapshots)}
    <div class="tableWrap"><table><thead><tr><th>Data</th><th>Preço</th><th>Km</th><th>Situação</th><th>Origem</th></tr></thead><tbody>${snaps}</tbody></table></div>
    ${dups ? `<h3>Possíveis duplicatas</h3><ul>${dups}</ul>` : ""}

    <h3>Texto do anúncio</h3>
    <form id="textForm"><textarea name="text" rows="5" placeholder="Cole o texto do anúncio (selecionar tudo → copiar)"></textarea>
      <div class="actions"><button type="button" id="dPaste">Colar</button><button class="primary" type="submit">Analisar texto</button></div></form>
    ${texts}
    <div class="reconfirm"><b>Reconferir</b> ${stale(d) ? `<span class="chip pendente">pendente</span>` : ""}
      <p class="small">Abra o anúncio, confira e registre. Vai para o histórico e gera alertas (ex.: queda de preço).</p>
      <form id="reconfForm">
        <div class="row2">
          <label>Situação<select name="available"><option value="1">Disponível</option><option value="0">Vendido / removido</option></select></label>
          <label>Preço atual (R$)<input type="number" inputmode="numeric" name="price" value="${esc(d.price ?? "")}"></label>
          <label>Km atual<input type="number" inputmode="numeric" name="km" value="${esc(d.km ?? "")}"></label>
          <label>Observação<input name="note"></label>
        </div>
        <button type="submit" class="primary" style="width:100%">Registrar reconferência</button>
      </form></div>
    </details>

    <h3 id="dContact">Contatar vendedor</h3>
    <div class="reconfirm">
      <p class="small" style="margin-top:0">${esc(d.seller || "Vendedor não identificado")}${d.seller_type ? ` · ${SELLER[d.seller_type]}` : ""}.
        Sem o telefone, o botão abaixo <b>copia a mensagem e abre o anúncio</b>: no WebMotors toque em <b>WhatsApp</b> ou <b>Mensagem</b> e cole. Com o telefone (no anúncio: <b>Ver telefone</b>), abre direto o WhatsApp do vendedor.</p>
      <label>Telefone / WhatsApp do vendedor<input name="phone" id="dPhone" inputmode="tel" placeholder="(11) 9xxxx-xxxx" value="${esc(d.seller_phone || "")}"></label>
      <label>Mensagem (pode editar)<textarea id="dMsg" rows="7">${esc(d.contact_draft || E.contactMessage(S, d))}</textarea></label>
      <div class="actions left">
        <button class="primary" id="dWhats">${d.seller_phone ? "Enviar pelo WhatsApp" : "Copiar mensagem e abrir anúncio"}</button><button id="dCopyMsg">Copiar mensagem</button>
        <button id="dShareMsg">Compartilhar…</button><button class="ghost" id="dResetMsg">Mensagem padrão</button>
      </div>
      <p class="small">${d.contacted_at ? `Contato registrado em ${esc(E.fmtDate(d.contacted_at))}.` : "Ao enviar pelo WhatsApp, o contato fica registrado aqui."}</p>
    </div>

    <h3>Anotações</h3>
    <form id="notesForm"><textarea name="notes" rows="3">${esc(d.notes || "")}</textarea><div class="actions"><span></span><button type="submit">Salvar</button></div></form>

    <h3>Mais ações</h3>
    <div class="actions left">
      <button id="dCompare">⇆ Comparar</button>
      <button class="ghost" id="dArchive">${d.archived ? "Desarquivar" : "Arquivar"}</button>
      <button class="ghost danger" id="dDelete">Excluir</button>
    </div>`;

  const reload = () => { renderDetail(byId(d.id) || d); renderCards(); };
  const msg = () => $("#dMsg").value.trim();
  $("#dPhone").onchange = () => act(null, async () => { d.seller_phone = $("#dPhone").value.trim(); $("#dWhats").textContent = d.seller_phone ? "Enviar pelo WhatsApp" : "Copiar mensagem e abrir anúncio"; });
  $("#dMsg").onchange = () => act(null, async () => { d.contact_draft = $("#dMsg").value; });
  $("#dResetMsg").onclick = () => act(null, async () => { delete d.contact_draft; $("#dMsg").value = E.contactMessage(S, d); });
  $("#dCopyMsg").onclick = async () => { try { await navigator.clipboard.writeText(msg()); toast("Mensagem copiada. Cole no chat do WebMotors ou no WhatsApp."); } catch { toast("Não consegui copiar; selecione o texto e copie."); } };
  $("#dShareMsg").onclick = async () => { try { await navigator.share({ text: msg() }); } catch { /* cancelado */ } };
  $("#dWhats").onclick = () => {
    const link = E.whatsappLink($("#dPhone").value, msg());
    if (!link) { // sem telefone: copia a mensagem e abre o anúncio para usar o WhatsApp/chat do próprio WebMotors
      const done = () => { d.contacted_at = new Date().toISOString(); persist(); openExternal(d.url); };
      (navigator.clipboard?.writeText(msg()) || Promise.reject()).then(() => { toast("Mensagem copiada. No anúncio, toque em WhatsApp ou Mensagem e cole."); done(); })
        .catch(() => { toast("Não consegui copiar sozinho: use “Copiar mensagem” e depois abra o anúncio."); });
      return;
    }
    d.seller_phone = $("#dPhone").value.trim(); d.contacted_at = new Date().toISOString(); persist();
    openExternal(link); reload();
  };
  $("#dScore").onclick = () => openScore(d.id);
  $("#dReport").onclick = () => openReport(d.id);
  $$("[data-quick]", $("#detail")).forEach((b) => b.onclick = () => {
    const [item, state] = b.dataset.quick.split(":");
    act(null, async () => {
      E.setManualCheck(d, item, { state, source: "Confirmado por você", evidence: `Marcado no app em ${new Date().toLocaleDateString("pt-BR")} (vendedor, visita ou fotos)`, detail: null }, deps);
      E.refresh(S, d, deps); reload();
      toast(`${ITEMS[item]}: ${state === "confirmado" ? "tem" : "não tem"}.`, () => act(null, async () => {
        E.setManualCheck(d, item, { state: "auto", source: "", evidence: "", detail: null }, deps); E.refresh(S, d, deps); reload(); toast("Desfeito."); }));
    });
  });
  $$("[data-seller]", $("#detail")).forEach((b) => b.onclick = () => act(null, async () => {
    const prev = d.seller_type;
    await E.editFields(S, d, { seller_type: b.dataset.seller }, deps); reload();
    toast(`Vendedor: ${SELLER[b.dataset.seller]}.${d.status === "descartado" ? " Descartado pelo seu filtro." : ""}`, () => act(null, async () => {
      await E.editFields(S, d, { seller_type: prev ?? null }, deps); reload(); toast("Desfeito."); }));
  }));
  const ask = $("#dAsk");
  if (ask) ask.onclick = () => { $("#dMsg").value = askMessage(d); act(null, async () => { d.contact_draft = $("#dMsg").value; });
    $("#dContact").scrollIntoView({ behavior: "smooth", block: "start" }); toast("Mensagem com as perguntas pronta. Informe o telefone e toque em WhatsApp."); };
  const da = $("#dApprove"); if (da) da.onclick = () => approve(d.id);
  const dd = $("#dDiscard"); if (dd) dd.onclick = () => openDiscard(d.id);
  const du = $("#dUndo"); if (du) du.onclick = () => undiscard(d.id);
  $("#dCompare").onclick = () => addToCompare(d.id);
  const el = $("#detail");
  $("#reconfForm").onsubmit = (e) => { e.preventDefault(); const f = e.target; act($("button", f), async () => {
    const ev = E.reconfirm(S, d, { available: f.available.value === "1", price: f.price.value === "" ? null : +f.price.value, km: f.km.value === "" ? null : +f.km.value, note: f.note.value.trim() || null }, deps);
    const L = { price_drop: "queda de preço", price_up: "aumento de preço", km_change: "km alterada", unavailable: "indisponível", available_again: "disponível de novo" };
    toast(ev.length ? "Reconferido: " + ev.map((x) => L[x.type] || x.type).join(", ") : "Reconferido, sem alterações."); reload(); }); };
  $("#fieldsForm").onsubmit = (e) => {
    e.preventDefault(); const f = e.target, body = {};
    for (const [k] of FIELD_EDIT) { const v = f.elements[k].value.trim(), cur = d[k] == null ? "" : String(d[k]); if (v !== cur) body[k] = v === "" ? null : v; }
    if (!Object.keys(body).length) return toast("Nenhuma alteração.");
    act($("button[type=submit]", f), async () => { await E.editFields(S, d, body, deps); toast("Dados corrigidos (marcados como informados por você)."); reload(); });
  };
  $("#distForm").onsubmit = (e) => { e.preventDefault(); const f = e.target; act($("button[type=submit]", f), async () => {
    E.setManualDistance(d, f.km.value === "" ? null : +f.km.value, f.source.value); E.refresh(S, d, deps); reload(); }); };
  $("#dRecalc").onclick = (e) => act(e.target, async () => { await E.updateDistance(S, d, deps, true); E.refresh(S, d, deps); toast(distText(d)); reload(); });
  $("#textForm").onsubmit = (e) => { e.preventDefault(); const f = e.target; act($("button[type=submit]", f), async () => {
    const r = await E.importListing(S, { url: d.url, text: f.text.value, origin: "colado" }, deps); toast(r.message); reload(); }); };
  $("#dPaste").onclick = async () => { try { $("#textForm").text.value = await navigator.clipboard.readText(); } catch { toast("Use o colar do teclado."); } };
  $("#notesForm").onsubmit = (e) => { e.preventDefault(); act(null, async () => { d.notes = e.target.notes.value; toast("Anotação salva."); }); };
  $("#dArchive").onclick = () => act(null, async () => { d.archived = !d.archived; E.recomputeDuplicates(S); reload(); });
  $("#dDelete").onclick = () => { if (confirm("Excluir este anúncio e todo o histórico?")) act(null, async () => {
    S.listings = S.listings.filter((x) => x.id !== d.id); ui.compare.delete(d.id); saveCompare(); E.recomputeDuplicates(S); closeSheet("#detailSheet"); renderCards(); }); };
  const ns = $("#dNewSpec");
  if (ns) ns.onclick = (e) => { e.preventDefault(); closeSheet("#detailSheet"); showView("settings");
    $("#settingsNav [data-sub=specs]").click(); const f = $("#specForm"); $("#specDetails").open = true;
    f.make.value = d.make || ""; f.model.value = d.model || ""; f.version_includes.value = (d.version || "").toLowerCase();
    f.year_from.value = d.year_model || ""; f.year_to.value = d.year_model || ""; f.make.scrollIntoView({ block: "center" }); };
  $$(".eqForm", el).forEach((f) => f.onsubmit = (e) => { e.preventDefault(); act($("button", f), async () => {
    E.setManualCheck(d, f.dataset.item, { state: f.state.value, source: f.source.value, evidence: f.evidence.value, detail: f.detail ? f.detail.value : null }, deps);
    E.refresh(S, d, deps); toast("Validação salva."); reload(); }); });
  $$("[data-deltext]", el).forEach((b) => b.onclick = () => act(b, async () => { d.texts = d.texts.filter((t) => t.id !== b.dataset.deltext); E.refresh(S, d, deps); reload(); }));
  $$("[data-open]", el).forEach((a) => a.onclick = (e) => { e.preventDefault(); openDetail(+a.dataset.open); });
  $$("[data-uncmp]", el).forEach((b) => b.onclick = () => { ui.compare.delete(+b.dataset.uncmp); saveCompare(); renderCompare(); renderCards(); });
}

// ---------------------------------------------------------------- aderência e ficha técnica
const specOf = (l) => l.spec_id ? E.allSpecs(S).find((s) => s.id === l.spec_id) : null;
function scoreHtml(l) {
  const sc = l.score; if (!sc) return "<p class='small'>Sem nota ainda.</p>";
  if (sc.total == null) {
    const fails = (l.reasons || []).filter((r) => r.level === "fail").map((r) => `<li>✕ ${esc(r.msg)}</li>`).join("");
    return `<div class="rhead warn"><b>Sem nota.</b> Este anúncio não atende a pré-requisito(s), então não entra na comparação.</div><ul class="list">${fails}</ul>`;
  }
  const pos = S.listings.filter((x) => !x.archived && x.status !== "descartado").sort(byAdherence).findIndex((x) => x.id === l.id) + 1;
  const n = S.listings.filter((x) => !x.archived && x.status !== "descartado").length;
  const pend = (l.reasons || []).filter((r) => r.level === "pending").length;
  return `<div class="actions left" style="align-items:center"><span class="scoreBig">${sc.total}</span><span><span class="scoreBtn ${sc.level}">${LEVEL_LABEL[sc.level]}</span><br>
    <span class="small">#${pos} de ${n} em análise</span></span></div>
    <p class="small">A nota compara só o que diferencia os carros que passaram no seu filtro. Os pré-requisitos (preço máximo, ano, km máxima, câmbio, vendedor, distância, indução e Android Auto sem fio) não dão pontos: eles decidem se o carro é aprovado, pendente ou descartado.${pend ? ` Este anúncio tem ${pend} pendência(s) a confirmar — elas não mudam a nota.` : ""}</p>
    <ul class="list">${sc.parts.map((p) => `<li><span>${esc(p.label)}<span class="small">${esc(p.note || "")}</span>
      <div class="bar" style="width:9rem"><i style="width:${(100 * p.pts / p.max).toFixed(0)}%"></i></div></span><b>${p.pts.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/${p.max.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</b></li>`).join("")}</ul>`;
}
function openScore(id) {
  const l = byId(id); if (!l) return;
  $("#scoreBody").innerHTML = `<p><b>${esc(title(l))} ${esc(l.year_model || "")}</b><br><span class="small">${esc(l.version || "")} · ${brl(l.price)}</span></p>` + scoreHtml(l);
  openSheet("#scoreSheet"); history.pushState({ sheet: 3 }, "");
}
const dec = (v) => v == null ? "—" : String(v).replace(".", ",");
function techHtml(l) {
  const sp = specOf(l), t = sp?.tech;
  if (!t) return `<p class="small">Sem ficha técnica cadastrada para esta versão e ano-modelo.</p>`;
  const autonomy = t.tank_l && t.road_g ? Math.round(t.tank_l * t.road_g) : null;
  return `<div class="techGrid">
    <div><div class="k">Carroceria</div>${esc(t.body)}</div><div><div class="k">Motor</div>${esc(t.engine)}</div>
    <div><div class="k">Potência (gasolina / etanol)</div>${t.power_g} / ${t.power_e} cv</div><div><div class="k">Torque (gas. / etanol)</div>${dec(t.torque_g)} / ${dec(t.torque_e)} kgfm</div>
    <div><div class="k">Consumo cidade (gas. / etanol)</div>${dec(t.city_g)} / ${dec(t.city_e)} km/l</div><div><div class="k">Consumo estrada (gas. / etanol)</div>${dec(t.road_g)} / ${dec(t.road_e)} km/l</div>
    <div><div class="k">Porta-malas</div>${t.trunk_l} L</div><div><div class="k">Tanque · autonomia na estrada (gas.)</div>${t.tank_l} L · ~${num(autonomy)} km</div>
    <div style="grid-column:1/-1"><div class="k">Câmbio</div>${esc(t.gearbox)}</div></div>
    <p class="small">Fonte: <a href="${esc(safeUrl(t.source.url))}" target="_blank" rel="noopener">${esc(t.source.title)}</a> (${esc(t.source.quality)}). ${esc(t.note || "")} Consumo conforme a fonte; no dia a dia varia com trânsito e combustível.</p>`;
}

// ---------------------------------------------------------------- comparação
$("#clearCmp").onclick = () => { ui.compare.clear(); saveCompare(); renderCompare(); renderCards(); };
function renderCompare() {
  const el = $("#compareTable");
  const it = [...ui.compare].map(byId).filter(Boolean);
  if (!it.length) { el.innerHTML = `<div class="empty">Nenhum veículo no comparativo.<br>Na lista, toque em <b>⇆ Comparar</b> no anúncio.</div>`; return; }
  const T = (x) => specOf(x)?.tech || {};
  const EQV = { confirmado: 2, pendente: 1, ausente: 0 };
  // linha comparável: get(x) -> número; better: "max" | "min"
  const row = (label, render, get = null, better = "max") => {
    let cls = it.map(() => "");
    if (get && it.length > 1) {
      const vals = it.map(get), known = vals.filter((v) => v != null);
      if (known.length > 1) {
        const hi = Math.max(...known), lo = Math.min(...known);
        if (hi !== lo) {
          const win = better === "max" ? hi : lo, lose = better === "max" ? lo : hi;
          cls = vals.map((v) => v === win ? "win" : v === lose ? "lose" : "");
        }
      }
    }
    return `<tr><th>${label}</th>${it.map((x, i) => `<td class="${cls[i]}">${render(x)}</td>`).join("")}</tr>`;
  };
  const wins = new Map(it.map((x) => [x.id, 0]));
  let html = `<table class="cmp"><tbody>
    ${row("Veículo", (x) => `<b>${esc(title(x))}</b> ${x.favorite ? "★" : ""}<br><span class="small">${esc(x.version || "")}</span>`)}
    ${row("Nota", (x) => `🎯 ${x.score?.total ?? "—"} <span class="small">${LEVEL_LABEL[x.score?.level] || ""}</span>`, (x) => x.score?.total)}
    ${row("Status", (x) => `<span class="badge ${shown(x)}">${STATUS[shown(x)]}</span>`, (x) => ({ aprovado: 3, atende: 2, pendente: 1, descartado: 0 })[shown(x)])}
    ${row("Preço", (x) => brl(x.price), (x) => x.price, "min")}
    ${row("Em relação à FIPE", (x) => { const f = fipeDiscount(x); return f == null ? (x.below_fipe_tag ? "abaixo (selo)" : "—") : `${pct(f)} ${f >= 0 ? "abaixo" : "acima"}<br><span class="small">FIPE ${brl(x.fipe)}</span>`; }, (x) => fipeDiscount(x))}
    ${row("Ano-modelo", (x) => esc(x.year_model ?? "—"), (x) => x.year_model)}
    ${row("Quilometragem", (x) => num(x.km, " km"), (x) => x.km, "min")}
    ${row("Distância", (x) => esc(distText(x)), (x) => x.distance?.km, "min")}
    ${Object.entries(ITEMS).map(([k, label]) => row(label, (x) => { const c = x.checks[k] || { state: "pendente" };
      return `${EQ_ICON[c.state]} ${esc(c.state)}${c.method === "ficha" ? " (ficha)" : ""}${c.detail ? `<br><span class="small">${esc(c.detail)}</span>` : ""}`; },
      (x) => (EQV[x.checks[k]?.state] ?? 1) * 2 - (x.checks[k]?.method === "ficha" ? 1 : 0))).join("")}
    ${row("Carroceria", (x) => esc(T(x).body || "—"))}
    ${row("Potência (etanol)", (x) => T(x).power_e ? `${T(x).power_e} cv` : "—", (x) => T(x).power_e)}
    ${row("Torque (etanol)", (x) => T(x).torque_e ? `${dec(T(x).torque_e)} kgfm` : "—", (x) => T(x).torque_e)}
    ${row("Consumo cidade (gasolina)", (x) => T(x).city_g ? `${dec(T(x).city_g)} km/l` : "—", (x) => T(x).city_g)}
    ${row("Consumo estrada (gasolina)", (x) => T(x).road_g ? `${dec(T(x).road_g)} km/l` : "—", (x) => T(x).road_g)}
    ${row("Porta-malas", (x) => T(x).trunk_l ? `${T(x).trunk_l} L` : "—", (x) => T(x).trunk_l)}
    ${row("Autonomia na estrada", (x) => T(x).tank_l && T(x).road_g ? `~${num(T(x).tank_l * T(x).road_g)} km` : "—", (x) => T(x).tank_l && T(x).road_g ? T(x).tank_l * T(x).road_g : null)}
    ${row("Câmbio", (x) => esc(T(x).gearbox || TR[x.transmission] || "—"))}
    ${row("Local", (x) => esc(x.city ? `${x.city}/${x.state || "?"}` : "—"))}
    ${row("Disponível", (x) => x.available === false ? "Não" : x.available ? "Sim" : "—")}
    ${row("", (x) => `<a data-ext href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer">Anúncio ↗</a> · <a href="#" data-open="${x.id}">detalhes</a><br><button class="ghost danger" data-uncmp="${x.id}">✕ remover</button>`)}
  </tbody></table>`;
  // placar de vitórias por carro
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  $$("tr", tmp).forEach((tr) => $$("td", tr).forEach((td, i) => { if (td.classList.contains("win")) wins.set(it[i].id, wins.get(it[i].id) + 1); }));
  const placar = `<tr><th>Quesitos vencidos</th>${it.map((x) => `<td><b>${wins.get(x.id)}</b></td>`).join("")}</tr>`;
  html = html.replace("<tbody>", "<tbody>" + placar);
  el.innerHTML = `<div class="cmpLegend"><span class="win" style="background:var(--ok-bg);color:var(--ok)">▲ venceu</span><span style="background:var(--bad-bg);color:var(--bad)">▼ perdeu</span><span class="small">sem cor = empate ou sem dado</span></div>` + html;
  $$("[data-open]", el).forEach((a) => a.onclick = (e) => { e.preventDefault(); openDetail(+a.dataset.open); });
  $$("[data-uncmp]", el).forEach((b) => b.onclick = () => { ui.compare.delete(+b.dataset.uncmp); saveCompare(); renderCompare(); renderCards(); });
}

// ---------------------------------------------------------------- alertas
/** Alerta só vale se o anúncio ainda se enquadra nos seus critérios (não descartado). Favoritos sempre contam. */
function alertRelevant(n) {
  if (!n.listing_id) return true;
  const l = byId(n.listing_id);
  if (!l || l.archived) return false;
  return l.status !== "descartado" || l.favorite || n.kind === "favorito_indisponivel";
}
function renderAlerts() {
  const items = S.notifications.filter(alertRelevant), hidden = S.notifications.length - items.length;
  $("#alertsList").innerHTML = items.length ? items.map((n) => `
    <div class="alert ${n.read ? "read" : "unread"}"><span class="dot"></span><div>
      <div><b>${esc(n.title)}</b> <span class="small">${esc(E.fmtDate(n.at))}</span></div><pre>${esc(n.message)}</pre>
      ${n.listing_id && byId(n.listing_id) ? `<a href="#" data-open="${n.listing_id}">abrir anúncio</a>` : ""}</div></div>`).join("")
    : `<div class="empty">Nenhum alerta${hidden ? " de anúncios dentro dos seus critérios" : " ainda"}.</div>`;
  if (hidden) $("#alertsList").insertAdjacentHTML("beforeend", `<p class="small" style="margin-top:.6rem">${hidden} alerta(s) de anúncios que não se enquadram mais nos seus critérios (descartados ou removidos) estão ocultos.</p>`);
  $$("[data-open]", $("#alertsList")).forEach((a) => a.onclick = (e) => { e.preventDefault(); openDetail(+a.dataset.open); });
}
$("#markRead").onclick = () => act(null, async () => { S.notifications.forEach((n) => n.read = true); renderAlerts(); renderCards(); });

// ---------------------------------------------------------------- ajustes
function renderSettings() {
  const c = S.settings.criteria, f = $("#criteriaForm");
  fillCombo(f.min_price, OPTS.max_price, c.min_price, brl, "Sem mínimo");
  fillCombo(f.max_price, OPTS.max_price, c.max_price, brl, "Sem máximo");
  fillSelect(f.year_min, OPTS.year, c.year_min); fillSelect(f.year_max, OPTS.year, c.year_max);
  fillCombo(f.min_km, [0, ...OPTS.max_km], c.min_km, (v) => num(v, " km"), "Sem mínimo");
  fillCombo(f.max_km, OPTS.max_km, c.max_km, (v) => num(v, " km"), "Sem máximo");
  fillSelect(f.max_distance_km, OPTS.max_distance_km, c.max_distance_km, (v) => num(v, " km"));
  const cities = [...new Set([...CITIES, c.ref_location].filter(Boolean))];
  f.ref_city.innerHTML = cities.map((x) => `<option ${x === c.ref_location ? "selected" : ""}>${esc(x)}</option>`).join("") + `<option value="__other">Outra cidade…</option>`;
  $("#refOtherWrap").hidden = true;
  $$("input[name=tr]", f).forEach((i) => i.checked = c.transmissions.includes(i.value));
  $$("input[name=cond]", f).forEach((i) => i.checked = c.conditions.includes(i.value));
  $$("input[name=seller]", f).forEach((i) => i.checked = (c.seller_types || []).includes(i.value));
  $$("input[name=body]", f).forEach((i) => i.checked = (c.body_types || []).includes(i.value));
  $$("input[name=avoid_color]", f).forEach((i) => i.checked = (c.avoid_colors || []).includes(i.value));
  f.no_auction.checked = c.no_auction !== false; f.no_armored.checked = c.no_armored !== false;
  const cf = $("#contactForm"); cf.my_car.value = S.settings.my_car || ""; cf.template.value = S.settings.contact_template || "";
  f.adas_required.checked = !!c.adas_required;
  f.accept_specs.checked = S.settings.accept_specs; f.only_official_specs.checked = S.settings.only_official_specs;
  fillNotify();
  $("#specCount").textContent = `(${E.allSpecs(S).length})`;
  renderSettingsRest();
}
function fillNotify() {
  const n = S.settings.notify, nf = $("#notifyForm");
  for (const k of ["new_approved", "new_pending", "price_drop", "include_discarded", "unavailable", "review_digest", "system"]) nf.elements[k].checked = !!n[k];
  fillSelect(nf.price_drop_min_pct, OPTS.price_drop_min_pct, n.price_drop_min_pct, (v) => v ? `${String(v).replace(".", ",")}%` : "qualquer");
  fillSelect(nf.price_drop_min_abs, OPTS.price_drop_min_abs, n.price_drop_min_abs, (v) => v ? brl(v) : "qualquer");
  fillSelect(nf.stale_days, OPTS.stale_days, S.settings.stale_days, (v) => v === 1 ? "1 dia" : `${v} dias`);
  fillSelect(nf.routine_hours, OPTS.routine_hours, S.settings.routine_hours, (v) => v === 1 ? "1 hora" : `${v} horas`);
}
function renderSettingsRest() {
  $("#ghForm").token.value = S.settings.github_token || "";
  const df = $("#distForm2"); df.provider.value = S.settings.distance.provider; df.ors_key.value = S.settings.distance.ors_key || "";
  renderIgnoreSuggestions();
  $("#dlMakes").innerHTML = [...new Set([...Object.keys(CATALOG), ...S.listings.map((l) => l.make && cap(l.make))].filter(Boolean))].sort().map((m) => `<option value="${esc(m)}">`).join("");
  updateModelList();
  $("#exclCount").textContent = S.exclusions.length ? `(${S.exclusions.length})` : "";
  $("#exclList").innerHTML = S.exclusions.length ? S.exclusions.map((r, i) => `<li class="excl"><details><summary><span class="exclName">${esc(exclusionLabel(r))}</span>${r.reason ? `<span class="exclReasonShort">${esc(r.reason)}</span>` : ""}</summary>
      <form class="exclEdit" data-editexcl="${i}"><label>Motivo<input name="reason" value="${esc(r.reason || "")}" placeholder="opcional"></label>
      <div class="cardActions"><button type="submit">Salvar motivo</button><button type="button" class="ghost danger" data-delexcl="${i}">Remover</button></div></form></details></li>`).join("")
    : `<li class="small">Nenhum modelo ignorado.</li>`;
  $("#specList").innerHTML = E.allSpecs(S).concat(SEED_SPECS.filter((s) => S.disabled_specs.includes(s.id))).map((s) => {
    const off = S.disabled_specs.includes(s.id), custom = S.custom_specs.some((x) => x.id === s.id);
    const items = Object.entries(ITEMS).map(([k]) => `${SHORT[k]}: ${s.items?.[k]?.state || "—"}`).join(" · ");
    return `<li><span><b>${esc(`${s.make} ${s.model} ${s.version_includes.join(" ")} ${s.year_from}${s.year_to !== s.year_from ? "–" + s.year_to : ""}`.toUpperCase())}</b>
      <span class="small">${esc(items)}</span><span class="small"><a href="${esc(safeUrl(s.source.url))}" target="_blank" rel="noopener">${esc(s.source.title)}</a> · ${esc(s.source.quality)}</span></span>
      ${custom ? `<button class="ghost danger" data-delspec="${esc(s.id)}">Remover</button>` : `<button class="ghost" data-togglespec="${esc(s.id)}">${off ? "Ativar" : "Desativar"}</button>`}</li>`;
  }).join("");
  const sz = JSON.stringify(S).length;
  $("#storageInfo").textContent = `Tudo fica salvo só neste aparelho (${S.listings.length} anúncios, ${(sz / 1024).toFixed(0)} KB). Faça cópias de segurança de vez em quando.`;
  const rs = S.meta.routines || [];
  $("#routines").innerHTML = rs.length ? `<table><thead><tr><th>Quando</th><th>Processados</th><th>Rotas</th><th>Novos aprovados</th><th>A reconferir</th></tr></thead><tbody>${rs.map((r) =>
    `<tr><td>${esc(E.fmtDate(r.at))}</td><td class="num">${r.processados}</td><td class="num">${r.distancias_calculadas}</td><td class="num">${r.novos_aprovados}</td><td class="num">${r.a_reconferir}</td></tr>`).join("")}</tbody></table>` : `<p class="small">Nenhuma ainda.</p>`;
}

$("#criteriaForm").ref_city.addEventListener("change", (e) => {
  const other = e.target.value === "__other"; $("#refOtherWrap").hidden = !other; if (other) $("#criteriaForm").ref_other.focus();
});
let critSnapshot = null;
// salva sozinho: qualquer mudança no filtro é aplicada e enviada (sem precisar de "OK")
let critTimer = null;
$("#criteriaForm").addEventListener("change", (e) => {
  if (e.target.name === "ref_city" && e.target.value === "__other") return; // espera digitar a cidade
  clearTimeout(critTimer); critTimer = setTimeout(() => $("#criteriaForm").requestSubmit(), 900);
});
$("#criteriaForm").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target, n = (k) => f.elements[k].value === "" ? null : Number(f.elements[k].value);
  if (n("year_min") && n("year_max") && n("year_min") > n("year_max")) return toast("Ano mínimo maior que o máximo.");
  act($("button[type=submit]", f), async () => {
    const oldRef = S.settings.criteria.ref_location;
    const ref = f.ref_city.value === "__other" ? f.ref_other.value.trim() : f.ref_city.value;
    if (!ref) throw new Error("Informe a cidade de referência (ex.: Osasco, SP).");
    const minP = comboValue(f, "min_price"), maxP = comboValue(f, "max_price"), minK = comboValue(f, "min_km"), maxK = comboValue(f, "max_km");
    if (minP != null && maxP != null && minP > maxP) throw new Error("Preço mínimo maior que o máximo.");
    if (minK != null && maxK != null && minK > maxK) throw new Error("Km mínima maior que a máxima.");
    Object.assign(S.settings.criteria, { min_price: minP, max_price: maxP, year_min: n("year_min"), year_max: n("year_max"), min_km: minK, max_km: maxK,
      max_distance_km: n("max_distance_km"), ref_location: ref,
      transmissions: $$("input[name=tr]:checked", f).map((i) => i.value), conditions: $$("input[name=cond]:checked", f).map((i) => i.value),
      seller_types: $$("input[name=seller]:checked", f).map((i) => i.value),
      body_types: $$("input[name=body]:checked", f).map((i) => i.value), avoid_colors: $$("input[name=avoid_color]:checked", f).map((i) => i.value),
      no_auction: f.no_auction.checked, no_armored: f.no_armored.checked });
    if (!S.settings.criteria.seller_types.length) S.settings.criteria.seller_types = ["particular", "loja", "concessionaria"];
    S.settings.criteria.adas_required = f.adas_required.checked;
    S.settings.accept_specs = f.accept_specs.checked; S.settings.only_official_specs = f.only_official_specs.checked;
    const refChanged = S.settings.criteria.ref_location !== oldRef;
    if (refChanged) for (const l of S.listings) if (l.distance?.status !== "manual")
      l.distance = { km: null, status: "nao_verificada", precision: null, note: "Aguardando cálculo da rota a partir da nova cidade." };
    E.reclassifyAll(S, deps); renderSettings(); renderCards(); updateTitle(); toast("Filtro salvo e aplicado.");
    critSnapshot = { ...S.settings.criteria };
    await filterChanged();
    if (refChanged) fillDistancesBg();
  });
});
// ---- sugestões de modelos ignorados a partir dos anúncios
const sameRule = (a, b) => JSON.stringify([normKey(a.make), normKey(a.model), normKey(a.version_includes), [].concat(a.version_excludes || []).map(normKey).sort()]) ===
  JSON.stringify([normKey(b.make), normKey(b.model), normKey(b.version_includes), [].concat(b.version_excludes || []).map(normKey).sort()]);
let SUGG = [];
function renderIgnoreSuggestions() {
  SUGG = ignoreSuggestions(S.listings.filter((l) => !l.archived));
  const chip = (rule, text, key) => {
    const done = S.exclusions.some((r) => sameRule(r, rule));
    return `<button type="button" class="${done ? "done" : ""}" data-sugg="${key}" ${done ? "disabled" : ""}>${done ? "✓ " : "⊘ "}${esc(text)}</button>`;
  };
  $("#exclSuggest").innerHTML = SUGG.length ? SUGG.map((g, i) => `<details class="sugg"><summary>
      <b>${esc(cap(g.make))} ${esc(cap(g.model))}</b> <span class="small">${g.count} anúncio(s)</span></summary>
      <span class="lvl">Mais amplo</span><div class="chips">
        ${chip(g.ruleMake, `Toda a marca ${cap(g.make)}`, `${i}:make`)}
        ${chip(g.ruleModel, `Todos os ${cap(g.model)} (${g.count})`, `${i}:model`)}</div>
      ${g.trims.length ? `<span class="lvl">Só um acabamento</span><div class="chips">${g.trims.map((t, j) => chip(t.rule, `Só ${cap(t.trim)} (${t.count})`, `${i}:trim:${j}`)).join("")}</div>` : ""}
    </details>`).join("") : `<p class="small">Quando houver anúncios no app, os modelos aparecem aqui para escolher.</p>`;
}
$("#exclSuggest").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sugg]"); if (!b) return;
  const [i, kind, j] = b.dataset.sugg.split(":"); const g = SUGG[+i]; if (!g) return;
  const rule = kind === "make" ? { ...g.ruleMake, label: `${cap(g.make)} (marca inteira)`.toUpperCase() }
    : kind === "model" ? { ...g.ruleModel, label: `${cap(g.make)} ${cap(g.model)} (todas as versões)`.toUpperCase() }
    : { ...g.trims[+j].rule, label: `${cap(g.make)} ${cap(g.model)} — só ${cap(g.trims[+j].trim)}`.toUpperCase() };
  const affected = S.listings.filter((l) => !l.archived && findExcl([rule], l)).length;
  const reason = prompt(`Ignorar ${rule.label.toLowerCase()}?\n${affected} anúncio(s) irão para Descartados.\n\nMotivo (opcional):`, "");
  if (reason === null) return; // cancelou
  rule.reason = reason.trim();
  act(null, async () => { S.exclusions.push(rule); E.reclassifyAll(S, deps); renderSettings(); renderCards(); toast(`Ignorado: ${affected} anúncio(s) descartados.`); filterChanged(); });
});

const cap = (s) => String(s || "").split(/(\s+|-)/).map((w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
const normKey = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function catalogFor(make) {
  const k = Object.keys(CATALOG).find((m) => normKey(m) === normKey(make));
  return k ? CATALOG[k] : [];
}
function updateModelList() {
  const f = $("#exclForm"), make = f.make.value;
  const fromCatalog = catalogFor(make).map((e) => e[0]);
  const fromListings = S.listings.filter((l) => normKey(l.make) === normKey(make) && l.model).map((l) => cap(l.model));
  $("#dlModels").innerHTML = [...new Set([...fromCatalog, ...fromListings])].sort().map((m) => `<option value="${esc(m)}">`).join("");
  const entry = catalogFor(make).find((e) => normKey(e[0]) === normKey(f.model.value));
  const modelKey = entry ? entry[1] : f.model.value;
  const versions = S.listings.filter((l) => normKey(l.make) === normKey(make) && normKey(l.model) === normKey(modelKey) && l.version).map((l) => l.version);
  $("#dlVersions").innerHTML = [...new Set(versions)].sort().map((v) => `<option value="${esc(v)}">`).join("");
}
$("#exclForm").make.addEventListener("input", () => { $("#exclForm").model.value = ""; updateModelList(); });
$("#exclForm").model.addEventListener("input", updateModelList);
$("#exclForm").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target;
  const make = f.make.value.trim(), modelName = f.model.value.trim(), ver = f.version_includes.value.trim();
  const entry = catalogFor(make).find((x) => normKey(x[0]) === normKey(modelName));
  const rule = entry
    ? { make, model: entry[1], version_includes: ver || entry[2] || "", version_excludes: ver ? "" : (entry[3] || "") }
    : { make, model: modelName, version_includes: ver };
  rule.label = `${cap(make)} ${entry ? entry[0] : cap(modelName)}${ver ? " — " + ver : ""}`.toUpperCase();
  rule.reason = f.reason.value.trim();
  act(null, async () => { S.exclusions.push(rule); f.reset(); E.reclassifyAll(S, deps); renderSettings(); renderCards(); toast("Modelo ignorado."); filterChanged(); });
});
$("#exclList").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target.closest("[data-editexcl]"); if (!f) return;
  act(null, async () => { S.exclusions[+f.dataset.editexcl].reason = f.reason.value.trim(); renderSettings(); toast("Motivo salvo."); });
});
$("#exclList").addEventListener("click", (e) => { const b = e.target.closest("[data-delexcl]"); if (!b) return;
  act(null, async () => { S.exclusions.splice(+b.dataset.delexcl, 1); E.reclassifyAll(S, deps); renderSettings(); renderCards(); filterChanged(); }); });
$("#specList").addEventListener("click", (e) => {
  const t = e.target.closest("[data-togglespec]"), d = e.target.closest("[data-delspec]");
  if (t) act(null, async () => { const id = t.dataset.togglespec; S.disabled_specs = S.disabled_specs.includes(id) ? S.disabled_specs.filter((x) => x !== id) : [...S.disabled_specs, id];
    E.reclassifyAll(S, deps); renderSettings(); renderCards(); });
  if (d) act(null, async () => { S.custom_specs = S.custom_specs.filter((x) => x.id !== d.dataset.delspec); E.reclassifyAll(S, deps); renderSettings(); renderCards(); });
});
$("#specForm").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target, items = {};
  for (const k of Object.keys(ITEMS)) if (f[k].value) items[k] = { state: f[k].value, quote: f.quote.value.trim() || null,
    ...(k === "adas" ? { names: f.adas_names.value.split(/[;,]/).map((s) => s.trim()).filter(Boolean) } : {}) };
  const spec = { id: "custom-" + Date.now(), make: f.make.value.trim().toLowerCase(), model: f.model.value.trim().toLowerCase(),
    version_includes: [f.version_includes.value.trim().toLowerCase()].filter(Boolean),
    version_excludes: f.version_excludes.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    year_from: +f.year_from.value, year_to: +f.year_to.value, items,
    source: { title: f.source_title.value.trim(), url: f.source_url.value.trim(), quality: f.source_quality.value } };
  const errs = validateSpec(spec);
  if (errs.length) return toast("Faltou: " + errs.join(", "));
  act(null, async () => { S.custom_specs.push(spec); f.reset(); $("#specDetails").open = false; E.reclassifyAll(S, deps); renderSettings(); renderCards(); toast("Ficha salva e aplicada."); });
});
$("#notifyForm").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target;
  act($("button[type=submit]", f), async () => {
    Object.assign(S.settings.notify, { new_approved: f.new_approved.checked, new_pending: f.new_pending.checked, price_drop: f.price_drop.checked,
      include_discarded: f.include_discarded.checked, unavailable: f.unavailable.checked, review_digest: f.review_digest.checked, system: f.system.checked,
      price_drop_min_pct: +f.price_drop_min_pct.value || 0, price_drop_min_abs: +f.price_drop_min_abs.value || 0 });
    S.settings.stale_days = Math.max(1, +f.stale_days.value || 3); S.settings.routine_hours = Math.max(1, +f.routine_hours.value || 12);
    if (f.system.checked && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    if (f.system.checked && "Notification" in window && Notification.permission !== "granted") toast("Permissão de notificação negada no Android.");
    else toast("Preferências salvas.");
    renderCards();
  });
});
$("#distForm2").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target;
  act(null, async () => { S.settings.distance = { provider: f.provider.value, ors_key: f.ors_key.value.trim() }; S.geo_cache = {}; toast("Serviço de rotas salvo. Use ↻ para recalcular."); });
});
$("#ghForm").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target;
  act(null, async () => {
    const t = f.token.value.trim();
    if (t) {
      const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(`Token recusado pelo GitHub (${r.status}). Confira se ele dá acesso ao repositório.`);
    }
    S.settings.github_token = t;
    if (!t) return toast("Token removido.");
    await ensureFilterPublished();
    toast(S.meta.filter_error ? `Token salvo, mas o filtro não foi enviado: ${S.meta.filter_error}.` : "Token salvo e filtro enviado. A pesquisa vai usar o seu filtro.");
  });
});
$("#contactForm").addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target;
  act(null, async () => { S.settings.my_car = f.my_car.value.trim(); S.settings.contact_template = f.template.value.trim() || E.CONTACT_TEMPLATE_DEFAULT; toast("Mensagem padrão salva."); });
});
$("#contactReset").onclick = () => { $("#contactForm").template.value = E.CONTACT_TEMPLATE_DEFAULT; $("#contactForm").my_car.value = E.MY_CAR_DEFAULT; };
$("#exportBtn").onclick = () => {
  const copy = JSON.parse(JSON.stringify(S)); copy.settings.github_token = ""; copy.settings.distance.ors_key = ""; // chaves não vão na cópia
  const blob = new Blob([JSON.stringify(copy, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `carmonitor-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("#importFile").onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then((t) => {
    const data = JSON.parse(t);
    if (!Array.isArray(data.listings) || !data.settings) throw new Error("Arquivo não é uma cópia do CarMonitor.");
    if (!confirm(`Substituir os dados atuais por esta cópia (${data.listings.length} anúncios)?`)) return;
    S = E.upgradeState(data); persist(); renderSettings(); renderCards(); updateTitle(); toast("Cópia restaurada.");
  }).catch((err) => toast(err.message)).finally(() => { e.target.value = ""; });
};

// ---------------------------------------------------------------- distâncias em segundo plano
let filling = false;
async function fillDistancesBg() {
  if (filling) return; filling = true;
  try {
    const n = await E.fillDistances(S, deps, (l) => {
      persist(); const span = document.querySelector(`[data-dist="${l.id}"]`); if (span) span.textContent = distText(l);
    });
    if (n) { renderCards(); if (ui.openId) { const l = byId(ui.openId); if (l) renderDetail(l); } toast(`${n} distância(s) calculada(s).`); }
  } finally { filling = false; }
}

// ---------------------------------------------------------------- pesquisa publicada pelo Claude
/** Fichas de versões pesquisadas e publicadas em data/fichas.json (sempre com fonte). */
async function syncSpecs() {
  try {
    const r = await fetch("data/fichas.json", { cache: "no-store" }); if (!r.ok) return false;
    const list = (await r.json()).filter((x) => validateSpec(x).length === 0);
    if (JSON.stringify(list) === JSON.stringify(S.remote_specs || [])) return false;
    S.remote_specs = list; E.reclassifyAll(S, deps); persist(); return true;
  } catch { return false; }
}
async function syncResearch(showNone = false) {
  await syncSpecs();
  let feed;
  try {
    const r = await fetch("data/anuncios.json", { cache: "no-store" });
    if (!r.ok) { if (showNone) toast("Nenhuma pesquisa publicada ainda."); return; }
    feed = await r.json();
  } catch { if (showNone) toast("Sem internet para buscar a pesquisa."); return; }
  const res = await E.syncFeed(S, feed, deps);
  persist(); renderCards(); loadResearchStatus();
  fillDistancesBg();
  const when = feed.generated_at ? E.fmtDate(feed.generated_at) : "—";
  if (res.novos || res.atualizados || res.indisponiveis)
    $("#routineMsg").innerHTML = `<div class="msg ok">Pesquisa do Claude (${esc(when)}): ${res.novos} novo(s), ${res.atualizados} atualizado(s)${res.indisponiveis ? `, ${res.indisponiveis} indisponível(is)` : ""}.</div>`;
  if (res.novos || res.atualizados || res.indisponiveis) setTimeout(() => { $("#routineMsg").innerHTML = ""; }, 6000);
  else if (showNone) toast(`Pesquisa de ${when} já importada.`);
}

// ---------------------------------------------------------------- pedir nova pesquisa (via issue no GitHub)
const REPO = (() => {
  const h = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0];
  return h.endsWith(".github.io") && seg ? `${h.split(".")[0]}/${seg}` : "carlosalmoura-byte/carmonitor";
})();
/** Filtro atual do app (critérios + modelos ignorados) — é o que a pesquisa deve usar. */
function filterPayload() {
  const c = S.settings.criteria;
  return {
    criteria: { min_price: c.min_price, max_price: c.max_price, year_min: c.year_min, year_max: c.year_max, min_km: c.min_km, max_km: c.max_km,
      transmissions: c.transmissions, conditions: c.conditions, seller_types: c.seller_types, ref_location: c.ref_location, max_distance_km: c.max_distance_km,
      adas_required: !!c.adas_required, no_auction: c.no_auction !== false, no_armored: c.no_armored !== false,
      body_types: c.body_types || [], avoid_colors: c.avoid_colors || [] },
    exclusions: S.exclusions.map((r) => ({ make: r.make || null, model: r.model || null, version_includes: r.version_includes || null, version_excludes: r.version_excludes || null })),
  };
}
function researchRequest(reason = "manual") {
  const active = S.listings.filter((l) => !l.archived);
  const fav = active.filter((l) => l.favorite).map((l) => l.url);
  const others = active.filter((l) => !l.favorite && l.available !== false).map((l) => l.url).slice(0, 25);
  const payload = { reason, ...filterPayload(), favorites: fav, urls: others };
  const when = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const why = reason === "filtros" ? "filtros alterados" : "pedido manual";
  return { title: `Atualizar pesquisa — ${when} (${why})`,
    body: `Pedido de nova pesquisa feito pelo app CarMonitor em ${when} (${why}). Não edite o bloco abaixo.\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` };
}
/** Envia o pedido: direto pela API se houver token salvo; senão abre o GitHub com o pedido pronto. */
async function sendResearchRequest(reason = "manual") {
  const { title, body } = researchRequest(reason);
  const token = S.settings.github_token;
  if (token) {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/issues`, { method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }) });
      if (!r.ok) throw new Error(`GitHub respondeu ${r.status}${r.status === 401 || r.status === 403 ? " (token inválido ou sem permissão de Issues)" : ""}`);
      S.meta.research_requested_at = new Date().toISOString(); persist(); renderResearchStatus();
      toast("Pedido enviado. A pesquisa roda em até ~1 h.");
      return true;
    } catch (e) { toast(`Não consegui enviar sozinho: ${e.message}. Abrindo o GitHub…`); }
  }
  S.meta.research_requested_at = new Date().toISOString(); persist(); renderResearchStatus();
  openExternal(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`);
  return false;
}
/** Publica o filtro do app em data/filtro.json no repositório (a pesquisa lê esse arquivo antes de rodar).
 *  Retorna "igual" | "publicado"; lança erro com a causa se não conseguir. */
const b64 = (str) => btoa(unescape(encodeURIComponent(str)));
const unb64 = (str) => decodeURIComponent(escape(atob(str.replace(/\s/g, ""))));
async function publishFilter() {
  const token = S.settings.github_token;
  if (!token) throw new Error("sem token do GitHub (Ajustes → Dados e rotas)");
  const api = `https://api.github.com/repos/${REPO}/contents/data/filtro.json`;
  const h = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const cur = filterPayload();
  let sha = null;
  const g = await fetch(`${api}?ref=main`, { headers: h, cache: "no-store" });
  if (g.ok) {
    const j = await g.json(); sha = j.sha;
    try {
      const pub = JSON.parse(unb64(j.content));
      if (JSON.stringify({ criteria: pub.criteria, exclusions: pub.exclusions }) === JSON.stringify(cur)) {
        S.meta.filter_updated_at = pub.updated_at; S.meta.filter_error = null; return "igual";
      }
    } catch { /* arquivo inválido: regrava */ }
  } else if (g.status !== 404) throw new Error(g.status === 401 ? "token inválido ou expirado" : `GitHub respondeu ${g.status} ao ler o filtro`);
  const updated_at = new Date().toISOString();
  const doc = { updated_at, origem: "app CarMonitor", ...cur };
  const r = await fetch(api, { method: "PUT", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Filtro do app atualizado (${updated_at})`, content: b64(JSON.stringify(doc, null, 1) + "\n"), branch: "main", ...(sha ? { sha } : {}) }) });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 404
    ? "o token não tem permissão para gravar arquivos (dê “Contents: Read and write” ao token no GitHub)"
    : r.status === 401 ? "token inválido ou expirado" : `GitHub respondeu ${r.status} ao gravar o filtro`);
  S.meta.filter_updated_at = updated_at; S.meta.filter_error = null; return "publicado";
}
/** Filtro mudou no app: publica para a pesquisa usar e pede nova pesquisa. Sem token/permissão, cai no pedido por issue. */
async function filterChanged() {
  try {
    const r = await publishFilter();
    if (r === "publicado") { S.meta.research_requested_at = new Date().toISOString(); toast("Filtro enviado. A pesquisa com ele roda em até ~1 h."); }
  } catch (e) {
    S.meta.filter_error = e.message;
    if (confirm(`Não consegui enviar o filtro sozinho (${e.message}).\nAbrir o GitHub com o pedido de pesquisa pronto?`)) await sendResearchRequest("filtros");
  }
  persist(); renderResearchStatus();
}
/** Ao abrir o app: garante que o filtro publicado é o mesmo do aparelho. */
async function ensureFilterPublished() {
  if (!S.settings.github_token) { S.meta.filter_error = "sem token do GitHub"; renderResearchStatus(); return; }
  try {
    const r = await publishFilter();
    if (r === "publicado") S.meta.research_requested_at = new Date().toISOString();
  } catch (e) { S.meta.filter_error = e.message; }
  persist(); renderResearchStatus();
}
$("#researchBtn").onclick = () => {
  if (!S.settings.github_token && !confirm("Vou abrir o GitHub com o pedido pronto. Toque em “Submit new issue” para enviar.\n(Para enviar sem esse passo, configure o token em Ajustes → Dados e rotas.)")) return;
  sendResearchRequest("manual");
};
let lastStatus = null;
async function loadResearchStatus() {
  try { const r = await fetch("data/status.json", { cache: "no-store" }); if (r.ok) lastStatus = await r.json(); } catch { /* sem internet */ }
  renderResearchStatus();
}
/** Próximos horários: pesquisas automáticas (prontas ~6h e ~13h; começam 5:46 e 12:46) e verificação de pedidos (a cada hora, :41). */
function nextAt(hours, minute, from = new Date()) {
  const c = [];
  for (let d = 0; d < 2; d++) for (const h of hours) { const t = new Date(from); t.setDate(t.getDate() + d); t.setHours(h, minute, 0, 0); if (t > from) c.push(t); }
  return c.sort((a, b) => a - b)[0];
}
const hhmm = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
function inTime(d) {
  const m = Math.max(0, Math.round((d - Date.now()) / 60000));
  return m < 60 ? `em ${m} min` : `em ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}
const dayWord = (d) => { const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0);
  const n = Math.round((x - t) / 864e5); return n === 0 ? "hoje" : n === 1 ? "amanhã" : n === -1 ? "ontem" : x.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); };
const when = (d) => `${dayWord(d)} às ${hhmm(d)}`;
function researchState() {
  const req = S.meta.research_requested_at, done = lastStatus?.processed_at || S.meta.feed_generated_at;
  const fu = S.meta.filter_updated_at, used = lastStatus?.filter_used_at;
  const run = lastStatus?.running && Date.now() - new Date(lastStatus.running.since) < 45 * 60000 ? lastStatus.running : null;
  const filterPending = !!(fu && lastStatus && used !== fu);
  const reqPending = !!(req && (!done || new Date(req) > new Date(done)));
  const pending = !run && (filterPending || reqPending);
  // automática: começa 5:46/12:46 e fica pronta ~6h/13h; pedidos: verificação aos :41, exceto 5:41/12:41 (a automática atende)
  const schedStart = nextAt([5, 12], 46), schedReady = new Date(schedStart.getTime() + 14 * 60000);
  const checkHours = [...Array(24).keys()].filter((h) => h !== 5 && h !== 12);
  const check = nextAt(checkHours, 41);
  const viaSched = schedStart <= check;
  return { done, fu, used, run, filterPending, reqPending, pending, schedStart, schedReady, check, viaSched, err: S.meta.filter_error };
}
function renderResearchStatus() {
  const r = researchState();
  let icon, text, cls;
  if (r.run) { icon = "🔄"; cls = "pend"; text = `Pesquisando agora${r.run.filter_at && r.run.filter_at === r.fu ? " com o seu filtro" : ""} (desde ${hhmm(new Date(r.run.since))})`; }
  else if (r.err) { icon = "⚠️"; cls = "warn"; text = "Seu filtro não chegou à pesquisa · toque para ver"; }
  else if (r.pending) { icon = "⏳"; cls = "pend"; const t = r.viaSched ? r.schedStart : r.check; text = `${r.filterPending ? "Filtro novo" : "Pedido recebido"}: pesquisa ${when(t)} (${inTime(t)})`; }
  else { icon = "✅"; cls = "ok"; text = `${r.done ? `Atualizada ${when(new Date(r.done))}` : "Sem pesquisa ainda"} · próxima ${dayWord(r.schedReady)} ~${r.schedReady.getHours()}h`; }
  const nNew = ui.since ? S.listings.filter((l) => !l.archived && l.status !== "descartado" && l.first_seen && new Date(l.first_seen) > new Date(ui.since)).length : 0;
  if (nNew && !r.err) text = `${nNew} novo(s) · ` + text;
  $("#researchIcon").textContent = icon; $("#researchStatus").textContent = text;
  $("#researchPill").className = "researchPill " + cls;
  if ($("#researchSheet").classList.contains("open")) renderResearchSheet();
}
function renderResearchSheet() {
  const r = researchState(), st = lastStatus || {};
  let head;
  if (r.run) head = `🔄 <b>Pesquisando agora.</b> Começou ${when(new Date(r.run.since))}${r.run.filter_at === r.fu ? ", com o seu filtro atual" : ""}. Leva uns 15 minutos; depois puxe a lista para baixo.`;
  else if (r.err) head = `⚠️ <b>Seu filtro não chegou à pesquisa.</b> Motivo: ${esc(r.err)}. Enquanto isso, a pesquisa usa o último filtro recebido.`;
  else if (r.pending) { const t = r.viaSched ? r.schedStart : r.check;
    head = `⏳ <b>${r.filterPending ? "Você mudou o filtro." : "Pedido de pesquisa recebido."}</b> A lista atual ainda é da pesquisa anterior. A nova pesquisa${r.filterPending ? ", com o filtro novo," : ""} começa ${when(t)} (${inTime(t)})${r.viaSched ? " — é a automática, que já usa o seu filtro" : ""}.`; }
  else head = `✅ <b>Lista em dia.</b> A última pesquisa já usou o seu filtro atual.`;
  const res = st.processed_at && st.processed_at === r.done
    ? `${st.novos ? `${st.novos} anúncio(s) novo(s)` : "nenhum anúncio novo"}${st.atualizados ? `, ${st.atualizados} atualizado(s)` : ""}${st.sairam_do_ar ? `, ${st.sairam_do_ar} saíram do ar` : ""}` : "";
  const filt = !r.fu ? "" : r.used === r.fu ? "com o seu filtro atual ✓" : "com um filtro antigo (antes da sua última mudança)";
  const next = [];
  if (r.pending && !r.viaSched) next.push(`<li><b>${when(r.check)}</b> — com o seu ${r.filterPending ? "filtro novo" : "pedido"} (${inTime(r.check)})</li>`);
  next.push(`<li><b>${dayWord(r.schedReady)} ~${r.schedReady.getHours()}h</b> — automática (${inTime(r.schedStart)})</li>`);
  $("#researchBody").innerHTML = `
    <div class="rhead ${r.err ? "warn" : r.pending || r.run ? "pend" : "ok"}">${head}</div>
    <h3 class="rsub">Última pesquisa</h3>
    <p>${r.done ? `${when(new Date(r.done))}${res ? ` — ${res}` : ""}.` : "Ainda não houve pesquisa."}${filt ? `<br><span class="small">Feita ${filt}.</span>` : ""}</p>
    <h3 class="rsub">Próximas pesquisas</h3>
    <ul class="rnext">${next.join("")}</ul>
    <p class="small">Automáticas todo dia por volta das 6h e das 13h. Quando você muda o filtro, uma pesquisa extra roda na próxima hora cheia (aos 41 min) — a não ser que a automática venha antes.</p>
    ${st.note ? `<details><summary class="small">Detalhes técnicos da última pesquisa</summary><p class="small">${esc(st.note)}</p></details>` : ""}`;
}
$("#researchPill").onclick = () => { renderResearchStatus(); renderResearchSheet(); openSheet("#researchSheet"); history.pushState({ sheet: 5 }, ""); };
setInterval(() => { if (document.visibilityState === "visible" && S) renderResearchStatus(); }, 30000);

// ---------------------------------------------------------------- rotina ao abrir
async function routine(force = false) {
  const r = await E.runRoutine(S, deps, { force });
  if (!r) return;
  persist(); renderCards();
  if (!r.processados) return;
  $("#routineMsg").innerHTML = `<div class="msg ok">Rotina: ${r.processados} processados · ${r.distancias_calculadas} rotas calculadas · ${r.novos_aprovados} novos aprovados · ${r.a_reconferir} a reconferir.</div>`;
  setTimeout(() => { $("#routineMsg").innerHTML = ""; }, 8000);
}
/** Há versão nova do app publicada? Compara o ?v= do app.js no index.html do servidor com o carregado. */
const APP_V = (document.querySelector('script[src*="app.js"]')?.getAttribute("src").match(/v=(\d+)/) || [])[1] || "0";
async function checkAppUpdate() {
  try {
    const html = await (await fetch("./?_=" + Date.now(), { cache: "no-store" })).text();
    const v = (html.match(/app\.js\?v=(\d+)/) || [])[1];
    if (v && v !== APP_V) {
      toast("Nova versão do app — carregando…");
      try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* ok */ }
      setTimeout(() => location.reload(), 600); return true;
    }
  } catch { /* sem internet */ }
  return false;
}
async function refreshAll() {
  if (await checkAppUpdate()) return;
  await syncResearch(true); await ensureFilterPublished(); await routine(true); fillDistancesBg();
  toast(`Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`);
}

// puxar para atualizar (na lista de anúncios)
(() => {
  const ptr = $("#ptr"), txt = $("#ptrText"); let y0 = null, dy = 0, busyPtr = false;
  const can = () => !busyPtr && window.scrollY <= 0 && $("#view-listings").classList.contains("active") && !$(".sheet.open");
  window.addEventListener("touchstart", (e) => { y0 = can() ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (y0 == null) return; dy = e.touches[0].clientY - y0;
    if (dy <= 0) { ptr.style.height = "0"; return; }
    ptr.classList.add("pulling"); ptr.style.height = Math.min(dy * 0.5, 70) + "px";
    txt.textContent = dy > 120 ? "Solte para atualizar" : "Puxe para atualizar";
  }, { passive: true });
  window.addEventListener("touchend", async () => {
    if (y0 == null) return; y0 = null; ptr.classList.remove("pulling");
    if (dy > 120) {
      busyPtr = true; ptr.style.height = "44px"; txt.textContent = "Atualizando…";
      try { await refreshAll(); persist(); } finally { busyPtr = false; ptr.style.height = "0"; }
    } else ptr.style.height = "0";
  });
})();

// ---------------------------------------------------------------- compartilhar (Android) e início
function handleShare() {
  const p = new URLSearchParams(location.search);
  if (!p.has("url") && !p.has("text") && !p.has("title")) return;
  const all = [p.get("title"), p.get("text"), p.get("url")].filter(Boolean).join("\n");
  const url = p.get("url") || firstUrl(all) || "";
  const text = (p.get("text") || "").trim();
  history.replaceState(null, "", location.pathname);
  openImport(url, text && text !== url && text.replace(url, "").trim().length > 40 ? text : "");
  if (!url) toast("Não encontrei um link no conteúdo compartilhado.");
}

(async function init() {
  S = await loadState();
  let migrate = false;
  for (const l of S.listings) if (!("seller" in l)) { l.seller = null; l.seller_type = null; E.reparseTexts(l); migrate = true; }
  if (migrate || S.listings.some((l) => !l.score)) { E.reclassifyAll(S, deps); persist(); } // versões antigas
  try { ui.compare = new Set(JSON.parse(localStorage.getItem("cmp") || "[]").filter((id) => byId(id))); } catch { /* ok */ }
  ui.since = S.meta.last_visit || null; S.meta.last_visit = new Date().toISOString(); persist(); // "NOVO" = chegou desde a última abertura
  const hasApproved = S.listings.some((l) => !l.archived && shown(l) === "aprovado");
  saveCompare(); updateTitle(); selectTab(hasApproved ? "aprovado" : "pendente"); handleShare(); renderResearchStatus();
  restoreUi(); // voltou do WebMotors (ou o Android recarregou o app): reabre onde você estava
  const h = location.hash.match(/listing=(\d+)/);
  if (h) { history.replaceState(null, "", location.pathname); openDetail(+h[1]); }
  requestPersistence();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  syncResearch(false).then(() => ensureFilterPublished()).then(() => routine(false)).then(() => fillDistancesBg()).catch((e) => console.warn(e));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkAppUpdate().then((upd) => upd || syncResearch(false).then(() => routine(false))).catch(() => {});
  });
  window.__cm = { get state() { return S; } }; // depuração/testes
})();
