#!/usr/bin/env node
// Gera o trecho de JavaScript que prepara o navegador para a pesquisa (cole o resultado no javascript_tool UMA vez,
// numa página qualquer do webmotors.com.br). Ele grava no localStorage do site:
//   cmx  = extrator de anúncio (tools/wm-extract.js)       cmc = extrator de cartões (tools/wm-cards.js)
//   cms  = acumulador: roda o cmx e guarda o resultado em cmres (usa window.__exp = URL esperada, para detectar
//          anúncio removido, que redireciona para a lista de estoque)
// Depois, em cada anúncio: window.__exp = "<url>"; eval(localStorage.getItem("cms"))
// No fim: JSON.parse(localStorage.getItem("cmres")).slice(0, 15)  (leia em blocos de ~15)
// Uso: node tools/wm-setup.mjs
import fs from "node:fs";

const strip = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").trim();
const cmx = `JSON.stringify((()=>{const r=${strip("./wm-extract.js")};return r.ok?{u:r.url,t:r.text}:r})())`;
const cmc = strip("./wm-cards.js");
const cms = `(()=>{const r=JSON.parse(eval(localStorage.getItem('cmx')));const a=JSON.parse(localStorage.getItem('cmres')||'[]');` +
  `if(r.u)a.push(r);else if(r.removed&&window.__exp)a.push({u:window.__exp,removed:true});localStorage.setItem('cmres',JSON.stringify(a));` +
  `return (r.u?'ok':r.removed?'REMOVIDO':'FALHA '+(r.blocked?'BLOQUEADO':r.reason||''))+' total='+a.length+' '+location.pathname.split('/').pop()})()`;
console.log(`localStorage.setItem("cmx",${JSON.stringify(cmx)});localStorage.setItem("cmc",${JSON.stringify(cmc)});` +
  `localStorage.setItem("cms",${JSON.stringify(cms)});localStorage.setItem("cmres","[]");"pronto"`);
