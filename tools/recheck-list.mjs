#!/usr/bin/env node
// Lista os anúncios a reconferir hoje (se ainda estão no ar e se o preço mudou), em ordem de prioridade:
//   1) data/acompanhar.json — favoritos e aprovados do usuário (sempre todos);
//   2) demais anúncios do feed ainda no ar que passam no filtro do app (não descartados), do conferido há mais tempo.
// Pula os conferidos nas últimas 20 h. Uso: node tools/recheck-list.mjs [limite=40] [--sem-fotos]
// --sem-fotos: em vez disso, lista os ativos não descartados cuja transcrição ainda não tem a linha "Fotos:" (mesmo conferidos hoje).
import fs from "node:fs";
import * as E from "../core/engine.js";

const limit = Number(process.argv.find((a) => /^\d+$/.test(a))) || 40;
const noPhotos = process.argv.includes("--sem-fotos");
const read = (p, d) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
const feed = read("data/anuncios.json", { listings: [] });
const filtro = read("data/filtro.json", null);
const watch = new Set(read("data/acompanhar.json", { urls: [] }).urls || []);
const fichas = read("data/fichas.json", []);
const recent = (l) => l.checked_at && Date.now() - new Date(l.checked_at) < 20 * 3600000;

const s = E.newState();
if (filtro) { Object.assign(s.settings.criteria, filtro.criteria); s.exclusions = filtro.exclusions || []; }
s.custom_specs = fichas;
const deps = { now: () => new Date(), notify: () => {} };
const alive = feed.listings.filter((l) => l.available !== false && l.text);
const status = new Map();
for (const l of alive) {
  try { await E.importListing(s, { url: l.url, text: l.text, skipDistance: true }, deps); } catch { /* conta como ativo */ }
}
const id = (u) => (u.match(/(\d{6,})$/) || [])[1];
for (const x of s.listings) status.set(feed.listings.find((l) => id(l.url) === id(x.url))?.url, x.status);
const first = alive.filter((l) => watch.has(l.url) && (!noPhotos || !/\nFotos:/.test(l.text)));
const rest = alive.filter((l) => !watch.has(l.url) && status.get(l.url) !== "descartado" && (noPhotos ? !/\nFotos:/.test(l.text) : !recent(l)))
  .sort((a, b) => new Date(a.checked_at || 0) - new Date(b.checked_at || 0));
const out = [...first, ...rest].slice(0, limit);
for (const l of out) console.log(l.url + (watch.has(l.url) ? "   # favorito/aprovado" : ""));
console.error(`${out.length} para reconferir (${first.length} favoritos/aprovados; ${rest.length} outros ativos no filtro)`);
