#!/usr/bin/env node
// Mescla o resultado de uma pesquisa em data/anuncios.json e grava data/status.json.
// Uso: node tools/merge-feed.mjs <novos.json> [--issue N] [--note "texto"]
// novos.json: [{ "url": "...", "text": "transcrição da página", "available": true|false }]
// Regras: só entra o que foi lido na página; available:false só quando a página mostrou que saiu do ar.
import fs from "node:fs";

const [, , file, ...rest] = process.argv;
if (!file) { console.error("uso: node tools/merge-feed.mjs <novos.json> [--issue N] [--note texto]"); process.exit(1); }
const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
const now = new Date().toISOString();
const norm = (u) => { const p = new URL(u.trim()); return `https://www.webmotors.com.br${p.pathname.replace(/\/+$/, "")}`; };

const feedPath = "data/anuncios.json", statusPath = "data/status.json";
const feed = fs.existsSync(feedPath) ? JSON.parse(fs.readFileSync(feedPath, "utf8")) : { listings: [] };
const incoming = JSON.parse(fs.readFileSync(file, "utf8"));
const byUrl = new Map(feed.listings.map((l) => [norm(l.url), l]));
let novos = 0, atualizados = 0, fora = 0;
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
  if (prev && prev.text === it.text && prev.available !== false) continue; // nada mudou
  byUrl.set(url, { url, checked_at: now, text: it.text, available: true });
  prev ? atualizados++ : novos++;
}
feed.listings = [...byUrl.values()];
feed.generated_at = now;
feed.by = "Claude (pesquisa a pedido)";
feed.nota = "Transcrição dos dados exibidos nas páginas do WebMotors no momento da pesquisa. Nada é inventado; o que não constava fica em branco.";
fs.writeFileSync(feedPath, JSON.stringify(feed, null, 1));
const status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, "utf8")) : {};
const issues = String(arg("--issue") || "").split(",").map(Number).filter(Boolean); // ex.: --issue 7,6
Object.assign(status, { processed_at: now, novos, atualizados, sairam_do_ar: fora, note: arg("--note") || null,
  last_issue: issues.length ? Math.max(...issues) : status.last_issue ?? null,
  processed_issues: [...new Set([...(status.processed_issues || []), ...issues])] });
fs.writeFileSync(statusPath, JSON.stringify(status, null, 1));
console.log(JSON.stringify({ novos, atualizados, sairam_do_ar: fora, total: feed.listings.length }));
