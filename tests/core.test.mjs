import assert from "node:assert/strict";
import { test } from "node:test";

import { APPROVED, DISCARDED, PENDING as ST_PENDING, classify, DEFAULT_CRITERIA } from "../core/classify.js";
import { duplicateGroups, normalizeUrl } from "../core/dedup.js";
import { ABSENT, CONFIRMED, PENDING, detectEquipment, mergeDetections } from "../core/equipment.js";
import { importListing, newState, reconfirm, runRoutine, setManualCheck, staleListings, reclassifyAll, editFields } from "../core/engine.js";
import { extractFromText, firstUrl, parseNumber, parseUrl } from "../core/parsing.js";
import { SEED_SPECS, findExclusion, findSpec, validateSpec } from "../core/specs.js";

const st = (text, item) => detectEquipment(text)[item];

// ------------------------------------------------------------ equipamentos (portado do Python)
test("ADAS confirmado pelo nome", () => {
  for (const [text, name] of [
    ["Opcionais: Frenagem autônoma de emergência, ar digital", "Frenagem autônoma de emergência (AEB)"],
    ["Assistente de permanência em faixa\nBancos de couro", "Assistente de permanência em faixa (LKA)"],
    ["Piloto automático adaptativo (ACC)", "Controle de cruzeiro adaptativo (ACC)"],
    ["Alerta de ponto cego nos retrovisores", "Monitoramento de ponto cego (BSM)"],
    ["Sensor de ponto cego", "Monitoramento de ponto cego (BSM)"],
    ["Comutação automática de farol alto", "Farol alto automático (AHB)"],
    ["Pacote Toyota Safety Sense", "Toyota Safety Sense"],
    ["Honda SENSING de série", "Honda SENSING"],
  ]) {
    const d = st(text, "adas");
    assert.equal(d.state, CONFIRMED, text);
    assert.ok(d.detail.includes(name), text);
    assert.ok(d.evidence);
  }
});

test("piloto automático comum e ADAS genérico não contam", () => {
  assert.equal(st("Piloto automático, sensor de estacionamento, câmera de ré", "adas").state, PENDING);
  assert.equal(st("Controle automático de velocidade", "adas").state, PENDING);
  const d = st("Carro com pacote ADAS completo", "adas");
  assert.equal(d.state, PENDING); assert.match(d.note, /sem identificar/);
});

test("negação, versão condicionada e ausência de menção", () => {
  assert.equal(st("Versão de entrada, sem frenagem autônoma de emergência", "adas").state, ABSENT);
  const c = st("Alerta de ponto cego disponível somente na versão Platinum", "adas");
  assert.equal(c.state, PENDING); assert.match(c.note, /versão/);
  assert.ok(Object.values(detectEquipment("Carro impecável, revisado, único dono.")).every((x) => x.state === PENDING));
});

test("carregador por indução", () => {
  for (const t of ["Carregador de celular por indução", "carregador sem fio para smartphone", "Carregamento por indução no console",
    "Base de carregamento wireless", "carregador wireless", "Wireless Charger (Carregador do Celular por Indução)"])
    assert.equal(st(t, "inducao").state, CONFIRMED, t);
  assert.equal(st("Partida sem chave, carregador por indução", "inducao").state, CONFIRMED);
  assert.equal(st("Não possui carregador por indução", "inducao").state, ABSENT);
  assert.equal(st("Carregador por indução: não", "inducao").state, ABSENT);
  const d = st("Carregador por indução.\nSem carregador por indução.", "inducao");
  assert.equal(d.state, PENDING); assert.match(d.note, /conflitantes/);
});

test("Android Auto sem fio", () => {
  for (const t of ["Android Auto sem fio", "Android Auto e Apple CarPlay sem fio", "Apple CarPlay e Android Auto sem fio",
    "Espelhamento sem fio Android Auto e Apple CarPlay", "Multimídia com wireless Android Auto", "Android Auto (wireless)"])
    assert.equal(st(t, "android_auto_sem_fio").state, CONFIRMED, t);
  assert.match(st("Central multimídia com Android Auto e Apple CarPlay", "android_auto_sem_fio").note, /sem indicar/);
  assert.match(st("Apple CarPlay sem fio e Android Auto", "android_auto_sem_fio").note, /CarPlay/);
  assert.equal(st("Android Auto com fio via USB", "android_auto_sem_fio").state, PENDING);
  assert.equal(st("Espelhamento com Smartphone", "android_auto_sem_fio").state, PENDING);
  assert.equal(st("Não possui Android Auto sem fio", "android_auto_sem_fio").state, ABSENT);
  assert.equal(st("Rádio simples, sem Android Auto", "android_auto_sem_fio").state, ABSENT);
  assert.equal(st("Carregador sem fio", "inducao").state, CONFIRMED);
});

test("fontes divergentes do mesmo anúncio => pendente", () => {
  const a = detectEquipment("Carregador por indução").inducao, b = detectEquipment("Sem carregador por indução").inducao;
  assert.equal(mergeDetections([["p", a], ["c", b]])[0].state, PENDING);
  assert.equal(mergeDetections([["p", a]])[0].state, CONFIRMED);
});

// ------------------------------------------------------------ classificação
const base = { price: 95000, year_model: 2023, km: 20000, transmission: "automatico", condition: "usado", available: true,
  distance: { km: 30, status: "verificada", precision: "cidade" } };
const allOk = { adas: { state: CONFIRMED }, inducao: { state: CONFIRMED }, android_auto_sem_fio: { state: CONFIRMED } };

test("aprovado só com tudo comprovado; pendente bloqueia; violação descarta", () => {
  assert.equal(classify(base, allOk, DEFAULT_CRITERIA).status, APPROVED);
  assert.equal(classify(base, { ...allOk, inducao: { state: PENDING } }, DEFAULT_CRITERIA).status, ST_PENDING);
  assert.equal(classify(base, { ...allOk, inducao: { state: ABSENT } }, DEFAULT_CRITERIA).status, DISCARDED);
  assert.equal(classify({ ...base, price: 100001 }, allOk, DEFAULT_CRITERIA).status, DISCARDED);
  assert.equal(classify({ ...base, price: 100000, km: 35000, year_model: 2025 }, allOk, DEFAULT_CRITERIA).status, APPROVED);
  assert.equal(classify({ ...base, distance: { km: null, status: "nao_verificada" } }, allOk, DEFAULT_CRITERIA).status, ST_PENDING);
  assert.equal(classify({ ...base, distance: { km: 58, status: "verificada", precision: "cidade" } }, allOk, DEFAULT_CRITERIA).status, ST_PENDING);
  assert.equal(classify({ ...base, distance: { km: 58, status: "verificada", precision: "endereco" } }, allOk, DEFAULT_CRITERIA).status, APPROVED);
  assert.equal(classify({ ...base, distance: { km: 61, status: "verificada", precision: "endereco" } }, allOk, DEFAULT_CRITERIA).status, DISCARDED);
});

test("modelo desconsiderado é descartado mesmo atendendo tudo", () => {
  const r = classify(base, allOk, DEFAULT_CRITERIA, { label: "CHEVROLET ONIX" });
  assert.equal(r.status, DISCARDED);
  assert.ok(r.reasons.some((x) => x.field === "excluded"));
});

test("dado conflitante entre fontes fica pendente", () => {
  const r = classify({ ...base, conflicts: { transmission: [{ value: "automatico", source: "URL" }, { value: "manual", source: "Texto" }] } }, allOk, DEFAULT_CRITERIA);
  assert.equal(r.status, ST_PENDING);
});

// ------------------------------------------------------------ fichas e exclusões
const L = (make, model, version, year_model) => ({ make, model, version, year_model });

test("ficha só vale para mesma marca, modelo, versão e ano-modelo", () => {
  assert.equal(findSpec(SEED_SPECS, L("RENAULT", "KARDIAN", "10 TCE FLEX PREMIERE EDITION EDC", 2025)).id, "renault-kardian-premiere-2025");
  assert.equal(findSpec(SEED_SPECS, L("RENAULT", "KARDIAN", "10 TCE FLEX TECHNO EDC", 2025)), null); // outra versão
  assert.equal(findSpec(SEED_SPECS, L("RENAULT", "KARDIAN", "10 TCE FLEX PREMIERE EDITION EDC", 2026)), null); // outro ano
  assert.equal(findSpec(SEED_SPECS, L("CHEVROLET", "ONIX", "10 TURBO FLEX PREMIER AUTOMATICO", 2025)).id, "chevrolet-onix-premier-2025");
  assert.equal(findSpec(SEED_SPECS, L("CHEVROLET", "ONIX", "10 TURBO FLEX PLUS PREMIER AUTOMATICO", 2025)).id, "chevrolet-onix-plus-premier-2025");
  assert.equal(findSpec(SEED_SPECS, L("CHEVROLET", "ONIX", "10 TURBO FLEX PREMIER AUTOMATICO", 2024)), null);
  assert.equal(findSpec(SEED_SPECS, L("HYUNDAI", "HB20S", "10 TGDI FLEX PLATINUM PLUS AUTOMATICO", 2024)), null);
  assert.equal(findSpec(SEED_SPECS, L("FIAT", "PULSE", "10 TURBO 200 FLEX IMPETUS CVT", 2022)).id, "fiat-pulse-impetus-2022");
  assert.equal(findSpec(SEED_SPECS, L("FIAT", "PULSE", "10 TURBO 200 FLEX IMPETUS CVT", 2022), { onlyOfficial: true }), null);
  for (const s of SEED_SPECS) assert.deepEqual(validateSpec(s), [], s.id);
});

test("exclusão por marca/modelo/versão", () => {
  const rules = [{ make: "chevrolet", model: "onix", version_includes: "plus" }, { model: "pulse" }];
  assert.ok(findExclusion(rules, L("CHEVROLET", "ONIX", "10 TURBO PLUS PREMIER", 2025)));
  assert.equal(findExclusion(rules, L("CHEVROLET", "ONIX", "10 TURBO PREMIER", 2025)), null);
  assert.ok(findExclusion(rules, L("FIAT", "PULSE", "IMPETUS", 2022)));
});

// ------------------------------------------------------------ parsing / dedup
test("parsing de URL e texto do WebMotors", () => {
  const p = parseUrl("https://www.webmotors.com.br/comprar/renault/kardian/10-tce-flex-premiere-edition-edc/4-portas/2024-2025/81177511");
  assert.equal(p.fields.source_id, "81177511"); assert.equal(p.fields.year_model, 2025); assert.equal(p.fields.transmission, "automatico");
  const p2 = parseUrl("https://www.webmotors.com.br/comprar/chevrolet/onix/10-turbo-flex-premier-automatico/4-portas/2025/81599500");
  assert.equal(p2.fields.year_model, 2025);
  const t = extractFromText("RENAULT KARDIAN\nR$ 97.990\n2024/2025\nKM\n17.670\nCâmbio\nAutomática\nSão Paulo - SP\nSensor de ponto cego");
  assert.equal(t.fields.price, 97990); assert.equal(t.fields.year_model, 2025); assert.equal(t.fields.km, 17670);
  assert.equal(t.fields.transmission, "automatico"); assert.equal(t.fields.city, "São Paulo"); assert.equal(t.fields.state, "SP");
  assert.equal(parseNumber("R$ 98.900,00"), 98900);
  assert.equal(firstUrl("Olha esse carro https://www.webmotors.com.br/comprar/x/y/z/1/2025/123456. Abs"), "https://www.webmotors.com.br/comprar/x/y/z/1/2025/123456");
  assert.equal(normalizeUrl("m.webmotors.com.br/comprar/a/b/?x=1"), "https://www.webmotors.com.br/comprar/a/b");
});

test("duplicatas prováveis", () => {
  const a = { id: 1, make: "VW", model: "T-Cross", year_model: 2023, km: 20000, price: 99000, city: "Barueri" };
  const g = duplicateGroups([a, { ...a, id: 2, km: 20300, price: 97000 }, { ...a, id: 3, km: 30000 }]);
  assert.equal(g[1], g[2]); assert.equal(g[3], undefined);
});

// ------------------------------------------------------------ fluxo completo (motor)
const KARDIAN = "https://www.webmotors.com.br/comprar/renault/kardian/10-tce-flex-premiere-edition-edc/4-portas/2024-2025/81177511";
const KARDIAN_TXT = "RENAULT KARDIAN 1.0 TCE Flex Premiére Edition EDC\nR$ 97.990\n2024/2025\nKM 17.670\nCâmbio Automática\nSão Paulo - SP\nItens: Sensor de ponto cego, Espelhamento com Smartphone, Tela Multimídia";
let clock = new Date("2026-10-27T12:00:00Z");
const deps = (km = 35) => ({ now: () => clock, distance: async (s, ref, city) => city ? { km, status: "verificada", precision: "endereco", note: "fake" } : { km: null, status: "nao_verificada", note: "x" } });

test("ficha da versão completa o que o anúncio não diz => aprovado, com origem marcada", async () => {
  const s = newState();
  const r = await importListing(s, { url: KARDIAN, text: KARDIAN_TXT }, deps());
  const l = s.listings.find((x) => x.id === r.id);
  assert.equal(l.checks.adas.method, "anuncio"); // "Sensor de ponto cego" está no anúncio
  assert.equal(l.checks.inducao.method, "ficha");
  assert.equal(l.checks.android_auto_sem_fio.method, "ficha");
  assert.match(l.checks.inducao.source, /Catálogo oficial Renault/);
  assert.equal(l.status, "aprovado", JSON.stringify(l.reasons));
  // desligar a aceitação de fichas => volta a pendente
  s.settings.accept_specs = false; reclassifyAll(s, deps());
  assert.equal(l.status, "pendente");
});

test("câmbio conflitante (URL EDC x anúncio 'Manual') fica pendente até você confirmar", async () => {
  const s = newState();
  const r = await importListing(s, { url: KARDIAN, text: KARDIAN_TXT.replace("Câmbio Automática", "Câmbio Manual") }, deps());
  const l = s.listings[0];
  assert.equal(l.status, "pendente");
  assert.ok(l.reasons.some((x) => x.field === "transmission" && /conflitante/.test(x.msg)));
  await editFields(s, l, { transmission: "automatico" }, deps());
  assert.equal(l.status, "aprovado");
  assert.ok(r.id);
});

test("modelo desconsiderado, reimportação, reconferência e alertas", async () => {
  const s = newState();
  await importListing(s, { url: KARDIAN, text: KARDIAN_TXT }, deps());
  const l = s.listings[0];
  assert.ok(s.notifications.some((n) => n.kind === "novo_aprovado"));
  assert.equal((await importListing(s, { url: KARDIAN + "?utm=1" }, deps())).result, "duplicado");
  const ev = reconfirm(s, l, { available: true, price: 94990 }, deps());
  assert.equal(ev[0].type, "price_drop");
  assert.ok(s.notifications.some((n) => n.kind === "reducao_preco"));
  s.exclusions.push({ make: "renault", model: "kardian" }); reclassifyAll(s, deps());
  assert.equal(l.status, "descartado");
  reconfirm(s, l, { available: true, price: 90000 }, deps());
  assert.ok(!s.notifications.some((n) => n.dedupe === `queda:${l.id}:94990:90000`)); // excluído não notifica
});

test("validação manual exige fonte e evidência e prevalece", async () => {
  const s = newState();
  await importListing(s, { url: "https://www.webmotors.com.br/comprar/vw/polo/x/4-portas/2023/12345678" }, deps());
  const l = s.listings[0];
  assert.throws(() => setManualCheck(l, "inducao", { state: "confirmado", source: "", evidence: "" }), /fonte/);
  assert.throws(() => setManualCheck(l, "adas", { state: "confirmado", source: "foto", evidence: "botão" }), /nome do sistema/);
  setManualCheck(l, "inducao", { state: "confirmado", source: "Foto 7 do anúncio", evidence: "Base com símbolo de indução" });
  reclassifyAll(s, deps());
  assert.equal(l.checks.inducao.method, "manual");
});

test("rotina ao abrir: respeita intervalo, calcula distância pendente e lista reconferências", async () => {
  const s = newState();
  await importListing(s, { url: KARDIAN, text: KARDIAN_TXT }, { now: () => clock }); // sem serviço de rota
  assert.equal(s.listings[0].distance.status, "nao_verificada");
  assert.equal(s.listings[0].status, "pendente");
  clock = new Date("2026-10-31T12:00:00Z");
  const r = await runRoutine(s, deps());
  assert.equal(r.distancias_calculadas, 1);
  assert.equal(r.a_reconferir, 1);
  assert.equal(staleListings(s, deps()).length, 1);
  assert.ok(s.notifications.some((n) => n.kind === "reconferir"));
  assert.equal(await runRoutine(s, deps()), null); // menos de 12 h depois: não roda de novo
});
