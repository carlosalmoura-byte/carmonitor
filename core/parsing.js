// Extração de campos de um anúncio a partir da URL ou do texto colado. Nada é inventado:
// o que não for encontrado fica vazio. Cada campo carrega a origem (url | texto_colado | derivado_*).
import { normalize } from "./textnorm.js";

export const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const UF_RE = UFS.join("|");

const UNAVAILABLE = [
  /anuncio\s+(?:nao\s+esta\s+mais\s+disponivel|encerrado|removido|expirado|indisponivel|pausado)/,
  /(?:este\s+)?veiculo\s+(?:ja\s+)?(?:foi\s+)?vendido/,
  /este\s+anuncio\s+nao\s+existe/,
];

export class Parsed {
  constructor() { this.fields = {}; this.sources = {}; }
  put(name, value, source, overwrite = false) {
    if (value === null || value === undefined || value === "") return;
    if (overwrite || !(name in this.fields)) { this.fields[name] = value; this.sources[name] = source; }
  }
}

export function parseNumber(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return s;
  s = String(s).trim().replace(/[^\d,.]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) {
    const i = s.lastIndexOf(","), head = s.slice(0, i), tail = s.slice(i + 1);
    s = head.replace(/,/g, "") + (tail.length <= 2 ? "." + tail : tail);
  } else if (s.includes(".")) {
    const parts = s.split(".");
    if (parts.slice(1).every((p) => p.length === 3)) s = parts.join("");
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function normalizeTransmission(s) {
  if (!s) return null;
  const n = normalize(s);
  if (n.includes("automatizad")) return "automatizado";
  if (/automat|\bcvt\b|dupla\s+embreagem|\bdct\b|\bdsg\b|\baut\b|tiptronic|e-?cvt|\bedc\b/.test(n)) return "automatico";
  if (n.includes("manual") || /\bmec(anico)?\b/.test(n)) return "manual";
  return null;
}

/** Pistas a partir da URL. WebMotors: /comprar/<marca>/<modelo>/<versao>/<portas>/<ano>/<id> */
export function parseUrl(url) {
  const p = new Parsed();
  let u;
  try { u = new URL(url); } catch { return p; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);
  p.fields.source = host.includes("webmotors.com.br") ? "webmotors" : (host.replace(/^www\./, "") || "outro");
  const ids = segs.filter((s) => /^\d{6,}$/.test(s));
  if (ids.length) p.fields.source_id = ids[ids.length - 1];
  if (host.includes("webmotors.com.br") && segs.length >= 4 && segs[0] === "comprar") {
    p.put("make", segs[1].replace(/-/g, " ").toUpperCase(), "url");
    p.put("model", segs[2].replace(/-/g, " ").toUpperCase(), "url");
    p.put("version", segs[3].replace(/-/g, " ").toUpperCase(), "url");
    for (const s of segs.slice(4)) {
      let m = s.match(/^((?:19|20)\d{2})-((?:19|20)\d{2})$/);
      if (m) { p.put("year_fab", +m[1], "url"); p.put("year_model", +m[2], "url"); }
      m = s.match(/^((?:19|20)\d{2})$/);
      if (m) { p.put("year_fab", +m[1], "url"); p.put("year_model", +m[1], "url"); }
    }
    p.put("transmission", normalizeTransmission(segs[3].replace(/-/g, " ")), "url");
  }
  return p;
}

const CITY_STOP = new Set(["cambio", "automatico", "automatica", "automatizado", "manual", "cvt", "flex", "gasolina", "diesel",
  "hibrido", "eletrico", "km", "ano", "cor", "portas", "seminovo", "usado", "localizacao", "local", "cidade", "loja", "vendedor",
  "particular", "concessionaria", "revenda", "preto", "branco", "prata", "cinza", "vermelho", "azul", "turbo", "tsi", "aut",
  "sedan", "hatch", "suv", "de", "da", "do"]);

function cleanCity(raw) {
  const words = raw.split(/\s+/).filter(Boolean);
  while (words.length && CITY_STOP.has(normalize(words[0]).replace(/[.:']/g, ""))) words.shift();
  return words.join(" ") || null;
}

const CITY = String.raw`([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:[ \t]+(?:d[aeo]s?[ \t]+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,4})[ \t]*(?:-|/|,|\()[ \t]*(${UF_RE})\b\)?`;
const CITY_LABELED = new RegExp(String.raw`(?:[Ll]ocaliza[cç][aã]o|LOCALIZA[CÇ][AÃ]O|[Cc]idade|CIDADE|[Ll]ocal|LOCAL)[ \t]*:?[ \t]*` + CITY);
const CITY_ANY = new RegExp(CITY);

export function extractFromText(text, source = "texto_colado", p = new Parsed()) {
  if (!text) return p;
  const n = normalize(text);
  let m = n.match(/(?:preco|valor)\s*[:\-]?\s*r\$\s*([\d.]+(?:,\d{2})?)/) || n.match(/r\$\s*([\d.]+(?:,\d{2})?)/);
  if (m) { const v = parseNumber(m[1]); if (v && v >= 1000) p.put("price", v, source); }

  m = n.match(/\b((?:19|20)\d{2})\s*\/\s*((?:19|20)\d{2})\b/);
  if (m) { p.put("year_fab", +m[1], source); p.put("year_model", +m[2], source); }
  else { m = n.match(/ano[\s\-]*modelo\s*[:\-]?\s*((?:19|20)\d{2})/); if (m) p.put("year_model", +m[1], source); }

  m = n.match(/(?:quilometragem|km\s+rodados?|\bkm\b)\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?!\s*\/)/) ||
      n.match(/\b(\d{1,3}(?:\.\d{3})+|\d+)\s*km\b(?!\s*\/\s*h)/);
  if (m) { const v = parseNumber(m[1]); if (v !== null) p.put("km", Math.trunc(v), source); }

  m = n.match(/(?:cambio|transmissao)\s*[:\-]?\s*([a-z\-]+(?:\s+[a-z\-]+)?)/);
  p.put("transmission", m ? normalizeTransmission(m[1]) : null, source);

  if (/\bseminovo\b/.test(n)) p.put("condition", "seminovo", source);
  else if (/\b0\s?km\b/.test(n)) p.put("condition", "novo", source);
  else if (/\busado\b/.test(n)) p.put("condition", "usado", source);

  m = text.match(CITY_LABELED) || text.match(CITY_ANY);
  if (m) { const city = cleanCity(m[1]); if (city) { p.put("city", city, source); p.put("state", m[2], source); } }

  m = text.match(/\b(\d{5}-?\d{3})\b/);
  if (m && /cep/.test(n.slice(Math.max(0, m.index - 15), m.index))) p.put("address", "CEP " + m[1], source);

  m = text.match(/(?:^|\n)\s*(?:Vendedor|Anunciante|Loja)\s*:\s*([^\n]{2,80})/i);
  if (m && !/n[ãa]o verificado/i.test(m[1])) p.put("seller", m[1].trim(), source);
  if (UNAVAILABLE.some((r) => r.test(n))) p.put("available", false, source);
  return p;
}

const DEALER_BRANDS = /\b(chevrolet|gm|jeep|nissan|renault|hyundai|fiat|volkswagen|vw|toyota|honda|ford|peugeot|citro[eë]n|caoa|chery|byd|gwm|kia|mitsubishi|ram|bmw|audi|mercedes|volvo|jac|land rover|porsche|suzuki|subaru|mini|dodge)\b/i;
/** Tipo de vendedor a partir do nome: particular | concessionaria | loja (derivado, editável). */
export function sellerType(seller) {
  if (!seller) return null;
  if (/pessoa\s+f[ií]sica|particular/i.test(seller)) return "particular";
  if (/concession/i.test(seller) || DEALER_BRANDS.test(seller)) return "concessionaria";
  return "loja";
}

/** Derivações explícitas e rotuladas (não são presunções de equipamento). */
export function deriveFields(p) {
  if (!("seller_type" in p.fields) && p.fields.seller) p.put("seller_type", sellerType(p.fields.seller), "derivado_vendedor");
  if (!("condition" in p.fields) && Number.isInteger(p.fields.km) && p.fields.km >= 1000) p.put("condition", "usado", "derivado_km");
  if (!("transmission" in p.fields)) {
    for (const k of ["version", "title"]) {
      const tr = normalizeTransmission(p.fields[k]);
      if (tr) { p.put("transmission", tr, `derivado_${k}`); break; }
    }
  }
  return p;
}

/** Primeiro link http(s) de um texto (ex.: texto compartilhado pelo app do WebMotors). */
export function firstUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"')\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}
