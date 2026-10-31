#!/usr/bin/env node
// Registra em data/status.json que a pesquisa NÃO concluiu (o app mostra o aviso e a próxima tentativa).
// Uso: node tools/fail-research.mjs "motivo curto"
import fs from "node:fs";
const p = "data/status.json";
const st = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
delete st.running;
st.last_attempt = { at: new Date().toISOString(), ok: false, reason: process.argv.slice(2).join(" ") || "não informado" };
fs.writeFileSync(p, JSON.stringify(st, null, 1));
console.log("falha registrada:", st.last_attempt.reason);
