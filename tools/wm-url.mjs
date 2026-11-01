#!/usr/bin/env node
// Monta as URLs de listagem filtrada do WebMotors a partir de data/filtro.json (filtros do próprio site:
// cidade, preço, ano, km, câmbio, anunciante). Uso: node tools/wm-url.mjs [páginas=3] [cidade,UF ...]
// Sem cidades extras, usa ref_location e as cidades vizinhas de GRANDE_SP quando a referência estiver na Grande SP.
import { readFileSync } from "node:fs";

const f = JSON.parse(readFileSync(new URL("../data/filtro.json", import.meta.url), "utf8"));
const c = f.criteria || {};
const pages = Number(process.argv[2]) || 3;
const extra = process.argv.slice(3);

const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const GRANDE_SP = ["São Paulo", "Barueri", "Osasco", "Santana de Parnaíba", "Carapicuíba", "Cotia", "Guarulhos",
  "Santo André", "São Bernardo do Campo", "São Caetano do Sul", "Diadema", "Mogi das Cruzes", "Taboão da Serra", "Jundiaí"];

function cityList() {
  if (extra.length) return extra.map((x) => x.split(",").map((s) => s.trim()));
  const [city, uf = "SP"] = String(c.ref_location || "São Paulo, SP").split(",").map((s) => s.trim());
  const list = [[city, uf]];
  if (uf.toUpperCase() === "SP" && GRANDE_SP.some((x) => slug(x) === slug(city)) && (c.max_distance_km ?? 60) >= 30)
    for (const x of GRANDE_SP) if (slug(x) !== slug(city)) list.push([x, "SP"]);
  return list;
}

const CAMBIO = { automatico: ["Automática", "CVT"], automatizado: ["Automatizada", "Automatizada DCT"], manual: ["Manual"] };
const ANUNC = { loja: "Loja", concessionaria: "Concessionária", particular: "Pessoa Física" };

const p = new URLSearchParams();
if (c.max_price) p.set("precoate", String(c.max_price));
if (c.min_price) p.set("precode", String(c.min_price));
if (c.max_km) p.set("kmate", String(c.max_km));
if (c.min_km) p.set("kmde", String(c.min_km));
if (c.year_min) p.set("anode", String(c.year_min));
if (c.year_max) p.set("anoate", String(Math.min(c.year_max, new Date().getFullYear() + 1)));
const cam = [...new Set((c.transmissions || []).flatMap((t) => CAMBIO[t] || []))];
if (cam.length) p.set("cambio", cam.join("|"));
const an = (c.seller_types || []).map((s) => ANUNC[s]).filter(Boolean);
if (an.length && an.length < 3) p.set("anunciante", an.join("|"));

for (const [city, uf] of cityList()) {
  for (let pg = 1; pg <= pages; pg++) {
    const q = new URLSearchParams(p); if (pg > 1) q.set("page", String(pg));
    console.log(`https://www.webmotors.com.br/carros/${uf.toLowerCase()}-${slug(city)}?${q.toString()}`);
  }
}
