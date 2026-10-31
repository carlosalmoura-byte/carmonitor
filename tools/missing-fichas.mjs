#!/usr/bin/env node
// Lista as versões/anos dos anúncios do feed que ainda não têm ficha (core/specs.js + data/fichas.json).
// Uso: node tools/missing-fichas.mjs   → a pesquisa deve buscar a ficha de cada linha listada.
import fs from "node:fs";
const E = await import(new URL("../core/engine.js", import.meta.url));
const st = E.newState();
st.remote_specs = fs.existsSync("data/fichas.json") ? JSON.parse(fs.readFileSync("data/fichas.json", "utf8")) : [];
const feed = JSON.parse(fs.readFileSync("data/anuncios.json", "utf8"));
const deps = { fetch: async () => { throw new Error("offline"); }, now: () => new Date() };
for (const l of feed.listings) if (l.text && l.available !== false)
  await E.importListing(st, { url: l.url, text: l.text, origin: "check", at: l.checked_at, skipDistance: true }, deps);
const miss = new Map();
for (const l of st.listings) if (!l.spec_id && l.make && l.model && l.version && l.year_model) {
  const k = `${l.make} ${l.model} | ${l.version} | ${l.year_model}`;
  miss.set(k, [...(miss.get(k) || []), l.url.split("/").pop()]);
}
if (!miss.size) console.log("Todas as versões/anos do feed têm ficha.");
for (const [k, ids] of miss) console.log(`${k}   (anúncios: ${ids.join(", ")})`);
