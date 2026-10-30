// Duplicatas: (1) mesma URL normalizada ou mesmo ID na fonte => bloqueada na importação;
// (2) provável duplicata: mesma marca+modelo+ano-modelo, km ±max(500, 2%), preço ±5%, mesma cidade (se conhecidas).
import { key } from "./textnorm.js";

export function normalizeUrl(url) {
  let u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const p = new URL(u); // lança erro se inválida
  let host = p.hostname.toLowerCase();
  if (host.startsWith("m.")) host = "www." + host.slice(2);
  const path = p.pathname.replace(/\/+$/, "") || "/";
  return `https://${host}${path}`;
}

export function likelySame(a, b) {
  if (!(a.make && b.make && a.model && b.model)) return false;
  if (key(a.make) !== key(b.make) || key(a.model) !== key(b.model)) return false;
  if (a.year_model == null || a.year_model !== b.year_model) return false;
  if (a.km == null || b.km == null || Math.abs(a.km - b.km) > Math.max(500, 0.02 * Math.max(a.km, b.km))) return false;
  if (a.price == null || b.price == null || Math.abs(a.price - b.price) > 0.05 * Math.max(a.price, b.price)) return false;
  if (a.city && b.city && key(a.city) !== key(b.city)) return false;
  return true;
}

/** items: [{id, ...}] -> {id: "dup-<menorId>"} só para quem tem par */
export function duplicateGroups(items) {
  const parent = new Map(items.map((i) => [i.id, i.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (likelySame(items[i], items[j])) {
        const ra = find(items[i].id), rb = find(items[j].id);
        if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
      }
  const groups = new Map();
  for (const it of items) { const r = find(it.id); groups.set(r, [...(groups.get(r) || []), it.id]); }
  const out = {};
  for (const [root, members] of groups) if (members.length > 1) for (const m of members) out[m] = `dup-${root}`;
  return out;
}
