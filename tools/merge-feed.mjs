#!/usr/bin/env node
// Mescla o resultado de uma pesquisa em data/anuncios.json e grava data/status.json.
// Uso: node tools/merge-feed.mjs <novos.json> [--issue N] [--note "texto"] [--fichas-pendentes "versões e motivo"]
// TRAVA: se, depois de mesclar, algum anúncio candidato ficar sem ficha da versão/ano, NADA é gravado (sai com código 2)
// e a lista é mostrada. Pesquise as fichas (data/fichas.json) e rode de novo. Só se não houver mesmo como pesquisar
// agora (fonte não encontrada, tempo acabou), passe --fichas-pendentes "<versões> — <motivo>": publica e registra.
// novos.json: [{ "url": "...", "text": "transcrição da página", "available": true|false }]
// Regras: só entra o que foi lido na página; available:false só quando a página mostrou que saiu do ar.
import fs from "node:fs";
import { missingFichas } from "./lib-fichas.mjs";

const [, , file, ...rest] = process.argv;
if (!file) { console.error("uso: node tools/merge-feed.mjs <novos.json> [--issue N] [--note texto]"); process.exit(1); }
const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
const now = new Date().toISOString();
const norm = (u) => { const p = new URL(u.trim()); return `https://www.webmotors.com.br${p.pathname.replace(/\/+$/, "")}`; };

const feedPath = "data/anuncios.json", statusPath = "data/status.json";
const feed = fs.existsSync(feedPath) ? JSON.parse(fs.readFileSync(feedPath, "utf8")) : { listings: [] };
const incoming = JSON.parse(fs.readFileSync(file, "utf8"));
const byUrl = new Map(feed.listings.map((l) => [norm(l.url), l]));
let novos = 0, atualizados = 0, fora = 0, conferidos = 0;
for (const it of incoming) {
  if (!it.url) continue;
  const url = norm(it.url);
  if (!/\/comprar\/.+\/\d{6,}$/.test(url)) { console.warn("ignorado (não é link de anúncio):", url); continue; }
  const prev = byUrl.get(url);
  if (it.available === false) {
    if (prev) { prev.available = false; prev.checked_at = now; delete prev.text; fora++; }
    else byUrl.set(url, { url, checked_at: now, available: false });
    continue;
  }
  if (!it.text || it.text.length < 20) { console.warn("sem texto, ignorado:", url); continue; }
  if (prev && prev.text === it.text && prev.available !== false) { prev.checked_at = now; conferidos++; continue; } // conferido, nada mudou
  // leitura só pelo cartão da busca ("Vendedor: (não verificado)") nunca substitui a transcrição completa da página
  const cardOnly = (t) => /Vendedor:\s*\(não verificado\)/.test(t || "");
  if (prev?.text && prev.available !== false && cardOnly(it.text) && !cardOnly(prev.text)) { prev.checked_at = now; conferidos++; continue; }
  byUrl.set(url, { url, checked_at: now, text: it.text, available: true });
  prev ? atualizados++ : novos++;
}
feed.listings = [...byUrl.values()];
const pendJust = arg("--fichas-pendentes");
const miss = await missingFichas(feed.listings);
if (miss.length && !pendJust) {
  console.error(`\nNÃO PUBLICADO: ${miss.length} versão(ões)/ano(s) de anúncios candidatos sem ficha:`);
  for (const m of miss) console.error(`  ${m.key}   (anúncios: ${m.ids.join(", ")})`);
  console.error(`\nPesquise a ficha de cada uma (RESEARCH.md, "Fichas de versões novas"), acrescente em data/fichas.json, rode` +
    ` node --test tests/core.test.mjs e repita este comando. Sem fonte possível agora: --fichas-pendentes "<versões> — <motivo>".`);
  process.exit(2);
}
feed.generated_at = now;
feed.by = "Claude (pesquisa a pedido)";
feed.nota = "Transcrição dos dados exibidos nas páginas do WebMotors no momento da pesquisa. Nada é inventado; o que não constava fica em branco.";
fs.writeFileSync(feedPath, JSON.stringify(feed, null, 1));
const status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, "utf8")) : {};
const issues = String(arg("--issue") || "").split(",").map(Number).filter(Boolean); // ex.: --issue 7,6
const filtro = fs.existsSync("data/filtro.json") ? JSON.parse(fs.readFileSync("data/filtro.json", "utf8")) : null;
delete status.running;
status.last_attempt = { at: now, ok: true };
Object.assign(status, { filter_used_at: rest.includes("--sem-filtro") ? null : filtro?.updated_at ?? null, processed_at: now, novos, atualizados, sairam_do_ar: fora, conferidos_sem_mudanca: conferidos, note: arg("--note") || null,
  fichas_pendentes: miss.length ? { versoes: miss.map((m) => m.key), motivo: pendJust } : null,
  last_issue: issues.length ? Math.max(...issues) : status.last_issue ?? null,
  processed_issues: [...new Set([...(status.processed_issues || []), ...issues])] });
fs.writeFileSync(statusPath, JSON.stringify(status, null, 1));
console.log(JSON.stringify({ novos, atualizados, sairam_do_ar: fora, conferidos_sem_mudanca: conferidos, total: feed.listings.length }));
