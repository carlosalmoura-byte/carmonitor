// Detecção dos equipamentos obrigatórios a partir do TEXTO DO PRÓPRIO ANÚNCIO.
// - Só confirma o que está escrito no texto analisado.
// - Ausência de menção => PENDENTE (nunca "ausente").
// - "Ausente" só com negação explícita.
// - Menção condicionada a outra versão => PENDENTE.
// - "ADAS" genérico sem nome do sistema => PENDENTE.
import { clip, normalize, sentenceSpans } from "./textnorm.js";

export const ITEMS = {
  adas: "Sistema ADAS (identificado pelo nome)",
  inducao: "Carregador de celular por indução",
  android_auto_sem_fio: "Android Auto sem fio",
};
export const CONFIRMED = "confirmado", ABSENT = "ausente", PENDING = "pendente";

const W = String.raw`(?:sem\s+fio|wireless)`;

export const ADAS_SYSTEMS = [
  ["Frenagem autônoma de emergência (AEB)", [
    String.raw`frenagem\s+(?:autonoma|automatica)(?:\s+de\s+emergencia)?`,
    String.raw`frenagem\s+de\s+emergencia\s+(?:autonoma|automatica)`,
    String.raw`\baeb\b`, String.raw`autonomous\s+emergency\s+brak`, String.raw`\bfront\s+assist\b`,
    String.raw`\bcity\s+(?:safety|brake)\b`, String.raw`pre[\s\-]?collision`, String.raw`active\s+safety\s+brake`,
    String.raw`(?:assistente|sistema)\s+de\s+pre[\s\-]?colisao`]],
  ["Alerta de colisão frontal (FCW)", [
    String.raw`alerta\s+(?:de\s+)?(?:pre[\s\-]?)?colisao`, String.raw`aviso\s+de\s+colisao`, String.raw`\bfcw\b`,
    String.raw`forward\s+collision`]],
  ["Assistente de permanência em faixa (LKA)", [
    String.raw`(?:permanencia|manutencao|centralizacao)\s+(?:em|na|de)\s+faixa`, String.raw`\blkas?\b`,
    String.raw`lane\s+(?:keep(?:ing)?\s+)?assist`, String.raw`lane\s+centering`]],
  ["Alerta de saída de faixa (LDW)", [
    String.raw`(?:alerta|aviso)\s+de\s+(?:saida|mudanca|desvio)\s+(?:de|da)\s+faixa`, String.raw`\bldws?\b`,
    String.raw`lane\s+departure`]],
  ["Controle de cruzeiro adaptativo (ACC)", [
    String.raw`(?:piloto\s+automatico|controle\s+(?:automatico\s+)?de\s+(?:cruzeiro|velocidade)|cruise\s+control)\s+adaptativ[oa]`,
    String.raw`adaptive\s+cruise`, String.raw`\(\s*acc\s*\)`, String.raw`\bacc\s+(?:com\s+)?stop`]],
  ["Monitoramento de ponto cego (BSM)", [
    String.raw`(?:monitor(?:amento)?|alerta|sensor|detector|deteccao|aviso|assistente)\s+(?:de\s+|do\s+|dos\s+)?pontos?\s+cegos?`,
    String.raw`\bbs[dm]\b`, String.raw`blind\s+spot`, String.raw`\bblis\b`]],
  ["Alerta de tráfego cruzado traseiro (RCTA)", [String.raw`trafego\s+cruzado`, String.raw`\brcta\b`, String.raw`cross\s+traffic`]],
  ["Farol alto automático (AHB)", [
    String.raw`farol\s+alto\s+(?:automatico|adaptativo)`, String.raw`farois\s+altos?\s+(?:automaticos?|adaptativos?)`,
    String.raw`(?:comutacao|ajuste|controle)\s+automatic[oa]\s+(?:do\s+|dos\s+|de\s+)?farol\s+alto`,
    String.raw`high\s+beam\s+assist`, String.raw`auto\s+high\s+beam`]],
  ["Detector de fadiga", [String.raw`(?:detector|alerta|sensor|monitor(?:amento)?)\s+de\s+fadiga`,
    String.raw`driver\s+attention`, String.raw`alerta\s+de\s+atencao\s+do\s+(?:motorista|condutor)`]],
  ["Reconhecimento de placas de trânsito (TSR)", [String.raw`reconhecimento\s+de\s+(?:placas|sinais)`, String.raw`traffic\s+sign`]],
  ["Toyota Safety Sense", [String.raw`toyota\s+safety\s+sense`]],
  ["Honda SENSING", [String.raw`honda\s+sensing`]],
  ["Hyundai SmartSense", [String.raw`\bsmart\s?sense\b`]],
  ["Nissan Safety Shield", [String.raw`safety\s+shield`]],
  ["VW IQ.DRIVE", [String.raw`\biq\.?\s?drive\b`]],
  ["Travel Assist", [String.raw`travel\s+assist`]],
  ["Mazda i-Activsense", [String.raw`\bi[\s\-]?activ\s?sense\b`]],
  ["Ford Co-Pilot360", [String.raw`co[\s\-]?pilot\s?360`]],
  ["Subaru EyeSight", [String.raw`\beye\s?sight\b`]],
  ["Pilot Assist", [String.raw`\bpilot\s+assist\b`]],
  ["Highway Driving Assist", [String.raw`highway\s+driv(?:ing)?\s+assist`]],
  ["BYD DiPilot", [String.raw`\bdi\s?pilot\b`]],
];

const GENERIC_ADAS = [String.raw`\badas\b`, String.raw`assistencias?\s+(?:avancadas?\s+)?(?:de|a)\s+conducao`,
  String.raw`sistemas?\s+avancados?\s+de\s+(?:assistencia|seguranca)`, String.raw`seguranca\s+ativa`];

const PHONE = String.raw`(?:(?:de|para|do)\s+)?(?:celular|smartphone|telefone|celulares|smartphones)?\s*`;
const INDUCTION = [
  String.raw`carregador(?:es)?\s+${PHONE}(?:(?:por|de)\s+)?(?:inducao|indutivo)`,
  String.raw`carregador(?:es)?\s+${PHONE}${W}`,
  String.raw`carregamento\s+${PHONE}(?:por\s+inducao|indutivo|${W})`,
  String.raw`recarga\s+${PHONE}(?:por\s+inducao|${W})`,
  String.raw`wireless\s+charg`, String.raw`\bqi\s+charg`,
  String.raw`(?:base|plataforma|bandeja|superficie)\s+(?:de\s+)?(?:carregamento|recarga)\s+(?:por\s+inducao|${W})`,
  String.raw`\binducao\s+(?:para\s+|de\s+)?(?:celular|smartphone)`,
];

const AA_POSITIVE = [
  String.raw`android\s+auto\s*\(?\s*${W}`,
  String.raw`android\s+auto\s*(?:e|/|,|&)\s*(?:apple\s+)?car\s?play\s*\(?\s*${W}`,
  String.raw`${W}\s*\(?\s*(?:(?:para|de|com|do|via)\s+)?android\s+auto`,
  String.raw`(?:espelhamento|conexao|projecao|integracao|pareamento)\s+${W}\s+(?:(?:de|do|com|para|via)\s+)?(?:celular\s+|smartphone\s+)?\(?\s*(?:apple\s+car\s?play\s*(?:e|/|,)\s*)?android\s+auto`,
];
const AA_AMBIGUOUS = [String.raw`car\s?play\s*\(?\s*${W}\s*\)?\s*(?:e|/|,|&)\s*android\s+auto(?!\s*\(?\s*${W})`];
const AA_WIRED = [String.raw`android\s+auto\s*\(?\s*(?:com\s+fio|via\s+cabo|via\s+usb|cabeado|por\s+cabo)`];
const AA_MENTION = [String.raw`android\s+auto`];

const NEG_BEFORE = new RegExp(
  String.raw`(?:\bsem\b(?!\s+fio)|\bnao\s+(?:possui|tem|acompanha|conta\s+com|vem\s+com|e\s+equipado\s+com|dispoe\s+de|ha|inclui)` +
  String.raw`|\bausencia\s+de|\bfalta\s+de|\bexceto|\bfalta\b)\s+(?:[\w/\-\.]+\s+){0,3}$`);
const NEG_AFTER = /^[\s:\-=]*(?:nao\b|ausente\b|indisponivel\b|nao\s+possui\b|inexistente\b)/;
const CONDITIONAL = new RegExp(
  String.raw`(?:disponivel|presente|somente|apenas|exclusiv[oa]s?|oferecid[oa]s?|item\s+de\s+serie)\s+(?:\w+\s+){0,2}vers(?:ao|oes)` +
  String.raw`|a\s+partir\s+da\s+versao|vers(?:ao|oes)\s+(?:superior(?:es)?|topo|mais\s+(?:completas?|caras?))` +
  String.raw`|em\s+outras\s+versoes|dependendo\s+da\s+versao|conforme\s+(?:a\s+)?versao|\bconsulte\b|pode\s+variar` +
  String.raw`|nao\s+disponivel\s+nesta\s+versao`);

class Doc {
  constructor(text) {
    this.orig = String(text ?? "");
    this.norm = normalize(this.orig);
    this.spans = sentenceSpans(this.norm);
  }
  sentenceOf(pos) {
    let lo = 0, hi = this.spans.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.spans[mid][0] <= pos) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    if (idx < 0) return [0, this.norm.length];
    const [s, e] = this.spans[idx];
    return pos < e ? [s, e] : [pos, Math.min(this.norm.length, pos + 1)];
  }
  hits(patterns, label = "") {
    const out = [];
    for (const p of patterns) {
      for (const m of this.norm.matchAll(new RegExp(p, "g"))) {
        if (!m[0].length) continue;
        const start = m.index, end = start + m[0].length;
        const [s, e] = this.sentenceOf(start);
        const negated = NEG_BEFORE.test(this.norm.slice(s, start)) || NEG_AFTER.test(this.norm.slice(end, e));
        const conditional = CONDITIONAL.test(this.norm.slice(s, e));
        out.push({ label, start, end, sent: [s, e], negated, conditional });
      }
    }
    return out;
  }
  evidence(hit) {
    let [s, e] = hit.sent;
    if (e - s > 220) { s = Math.max(s, hit.start - 90); e = Math.min(e, hit.end + 90); }
    return clip(this.orig.slice(s, e));
  }
}

const det = (state = PENDING, extra = {}) => ({ state, detail: null, evidence: null, note: null, names: [], ...extra });

function resolve(doc, positives, pendingNote) {
  const clean = positives.filter((h) => !h.negated && !h.conditional);
  const negs = positives.filter((h) => h.negated);
  const conds = positives.filter((h) => h.conditional && !h.negated);
  if (clean.length && negs.length)
    return det(PENDING, { evidence: doc.evidence(negs[0]) + " | " + doc.evidence(clean[0]), note: "Informações conflitantes no texto (menção positiva e negativa)." });
  if (clean.length)
    return det(CONFIRMED, { evidence: doc.evidence(clean[0]), names: [...new Set(clean.map((h) => h.label).filter(Boolean))].sort() });
  if (negs.length) return det(ABSENT, { evidence: doc.evidence(negs[0]), note: "Negação explícita no texto do anúncio." });
  if (conds.length) return det(PENDING, { evidence: doc.evidence(conds[0]), note: "Menção condicionada a versão/consulta; não comprova o veículo anunciado." });
  return det(PENDING, { note: pendingNote || "Não mencionado no texto analisado." });
}

function detectAdas(doc) {
  let hits = [];
  for (const [name, pats] of ADAS_SYSTEMS) hits = hits.concat(doc.hits(pats, name));
  const d = resolve(doc, hits);
  if (d.state === CONFIRMED) { d.detail = d.names.join("; "); return d; }
  if (d.state === PENDING && !hits.length) {
    const generic = doc.hits(GENERIC_ADAS).filter((h) => !h.negated);
    if (generic.length) return det(PENDING, { evidence: doc.evidence(generic[0]), note: "Menção genérica a ADAS/segurança ativa sem identificar o sistema pelo nome." });
  }
  return d;
}

const detectInduction = (doc) => resolve(doc, doc.hits(INDUCTION, "Carregador por indução"));

function detectAndroidAuto(doc) {
  let positives = doc.hits(AA_POSITIVE, "Android Auto sem fio");
  const ambiguous = doc.hits(AA_AMBIGUOUS).filter((h) => !h.negated);
  positives = positives.filter((h) => !ambiguous.some((a) => a.start <= h.start && h.start < a.end));
  const negMentions = doc.hits(AA_MENTION, "Android Auto").filter((h) => h.negated);
  const d = resolve(doc, positives.concat(negMentions));
  if (d.state === CONFIRMED && negMentions.length)
    return det(PENDING, { evidence: doc.evidence(negMentions[0]), note: "Informações conflitantes no texto (menção positiva e negativa)." });
  if (d.state !== PENDING || d.evidence) return d;
  if (ambiguous.length) return det(PENDING, { evidence: doc.evidence(ambiguous[0]), note: "'Sem fio' refere-se ao Apple CarPlay; Android Auto sem fio não comprovado." });
  const wired = doc.hits(AA_WIRED);
  if (wired.length) return det(PENDING, { evidence: doc.evidence(wired[0]), note: "Anúncio indica Android Auto com fio; conexão sem fio não comprovada." });
  const mention = doc.hits(AA_MENTION);
  if (mention.length) return det(PENDING, { evidence: doc.evidence(mention[0]), note: "Android Auto citado sem indicar conexão sem fio." });
  return d;
}

export function detectEquipment(text) {
  const doc = new Doc(text);
  return { adas: detectAdas(doc), inducao: detectInduction(doc), android_auto_sem_fio: detectAndroidAuto(doc) };
}

/** Combina detecções de vários textos do MESMO anúncio. perSource: [[rótulo, detecção], ...] */
export function mergeDetections(perSource) {
  const conf = perSource.filter(([, d]) => d.state === CONFIRMED);
  const absn = perSource.filter(([, d]) => d.state === ABSENT);
  if (conf.length && absn.length)
    return [det(PENDING, { evidence: `${conf[0][1].evidence} | ${absn[0][1].evidence}`, note: "Fontes do anúncio divergem (uma confirma, outra nega)." }), null];
  if (conf.length) {
    const names = [...new Set(conf.flatMap(([, d]) => d.names))].sort();
    const d = { ...conf[0][1] };
    if (names.length) { d.names = names; d.detail = names.join("; "); }
    return [d, conf[0][0]];
  }
  if (absn.length) return [absn[0][1], absn[0][0]];
  const withEv = perSource.filter(([, d]) => d.evidence);
  if (withEv.length) return [withEv[0][1], withEv[0][0]];
  if (perSource.length) return [perSource[0][1], null];
  return [det(PENDING, { note: "Nenhum texto do anúncio disponível para análise." }), null];
}
