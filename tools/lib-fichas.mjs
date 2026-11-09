// Versões/anos de anúncios CANDIDATOS sem ficha — usado por missing-fichas.mjs e pelo merge-feed.mjs (trava de publicação).
// Candidato = anúncio no ar que não é reprovado por nada que independa da ficha (preço, ano, km, câmbio, vendedor,
// modelo ignorado, fotos, leilão...). Reprovado só por item de equipamento ainda conta como candidato.
import fs from "node:fs";

const EQUIP = new Set(["adas", "inducao", "android_auto_sem_fio"]);
const read = (p, d) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);

export async function missingFichas(listings, { all = false } = {}) {
  const E = await import(new URL("../core/engine.js", import.meta.url));
  const st = E.newState();
  const filtro = read("data/filtro.json", null);
  if (filtro) { Object.assign(st.settings.criteria, filtro.criteria); st.exclusions = filtro.exclusions || []; }
  st.remote_specs = read("data/fichas.json", []);
  const deps = { fetch: async () => { throw new Error("offline"); }, now: () => new Date(), notify: () => {} };
  for (const l of listings) if (l.text && l.available !== false) {
    try { await E.importListing(st, { url: l.url, text: l.text, origin: "check", at: l.checked_at, skipDistance: true }, deps); } catch { /* ignora */ }
  }
  const miss = new Map();
  for (const l of st.listings) {
    if (l.spec_id || !l.make || !l.model || !l.version || !l.year_model) continue;
    const blocked = (l.reasons || []).some((r) => r.level === "fail" && !EQUIP.has(r.field));
    if (blocked && !all) continue;
    const k = `${l.make} ${l.model} | ${l.version} | ${l.year_model}`;
    miss.set(k, [...(miss.get(k) || []), l.url.split("/").pop()]);
  }
  return [...miss].map(([key, ids]) => ({ key, ids }));
}
