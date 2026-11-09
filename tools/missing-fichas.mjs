#!/usr/bin/env node
// Lista as versões/anos de anúncios CANDIDATOS do feed que ainda não têm ficha (core/specs.js + data/fichas.json).
// Uso: node tools/missing-fichas.mjs [--todos]   (--todos inclui anúncios já fora por preço, modelo ignorado etc.)
// A pesquisa deve buscar a ficha de cada linha listada ANTES do merge-feed (que se recusa a publicar sem elas).
import fs from "node:fs";
import { missingFichas } from "./lib-fichas.mjs";
const feed = JSON.parse(fs.readFileSync("data/anuncios.json", "utf8"));
const miss = await missingFichas(feed.listings, { all: process.argv.includes("--todos") });
if (!miss.length) console.log("Todas as versões/anos candidatos do feed têm ficha.");
for (const m of miss) console.log(`${m.key}   (anúncios: ${m.ids.join(", ")})`);
process.exitCode = miss.length ? 1 : 0;
