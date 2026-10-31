#!/usr/bin/env node
// Marca em data/status.json que uma pesquisa começou (o app mostra "pesquisando agora").
// Uso: node tools/start-research.mjs [agendada|pedido]
import fs from "node:fs";
const p = "data/status.json";
const st = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
const filtro = fs.existsSync("data/filtro.json") ? JSON.parse(fs.readFileSync("data/filtro.json", "utf8")) : null;
st.running = { since: new Date().toISOString(), kind: process.argv[2] || "pedido", filter_at: filtro?.updated_at ?? null };
fs.writeFileSync(p, JSON.stringify(st, null, 1));
console.log("pesquisa marcada como em andamento");
