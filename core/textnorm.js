// Normalização de texto com mapeamento 1:1 de posições (por unidade UTF-16) com o texto original.

export function normChar(c) {
  let b = c.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (b.length !== 1) return b.length ? b[0] : " ";
  if ("   \t".includes(b)) return " ";
  if ("–—".includes(b)) return "-";
  return b;
}

/** Remove acentos e passa para minúsculas, preservando o comprimento. */
export function normalize(text) {
  const s = String(text ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) out += normChar(s[i]);
  return out;
}

const SEP = /[\n\r;•|]+|(?<!\d)\.(?!\d)|\s{3,}/g;

/** Divide em "sentenças" (linhas, itens de lista, frases). Vírgula não divide. */
export function sentenceSpans(norm) {
  const spans = [];
  let start = 0;
  for (const m of norm.matchAll(SEP)) {
    if (m.index > start) spans.push([start, m.index]);
    start = m.index + m[0].length;
  }
  if (start < norm.length) spans.push([start, norm.length]);
  return spans;
}

export function clip(s, limit = 220) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + "…";
}

/** Chave para comparar marca/modelo/versão: só letras e números. */
export const key = (s) => normalize(s || "").replace(/[^a-z0-9]/g, "");
