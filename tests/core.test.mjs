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

// ------------------------------------------------------------ pesquisa publicada
import { syncFeed, fillDistances } from "../core/engine.js";
test("pesquisa publicada: importa, atualiza preço só quando é mais nova e marca indisponível", async () => {
  const s = newState();
  const url = "https://www.webmotors.com.br/comprar/chevrolet/onix/10-turbo-flex-premier-automatico/4-portas/2024-2025/79501868";
  const text = (p) => `CHEVROLET ONIX 1.0 TURBO FLEX PREMIER AUTOMÁTICO\nPreço: R$ ${p}\nAno: 2024/2025\nKM: 16.364\nCâmbio: Automática\nCidade: São Paulo - SP\nItens de veículo: Airbag; Tela Multimídia; Bluetooth`;
  const feed1 = { generated_at: "2026-10-30T14:00:00Z", listings: [{ url, checked_at: "2026-10-30T14:00:00Z", text: text("93.900") }] };
  let r = await syncFeed(s, feed1, deps());
  assert.equal(r.novos, 1);
  const l = s.listings[0];
  assert.equal(l.distance.status, "nao_verificada");      // lista aparece antes; rota vem depois
  assert.equal(await fillDistances(s, deps()), 1);
  assert.equal(l.price, 93900); assert.equal(l.year_model, 2025); assert.equal(l.city, "São Paulo");
  assert.equal(l.checks.inducao.method, "ficha");          // Onix Premier 2025 pela ficha
  assert.equal(l.status, "aprovado", JSON.stringify(l.reasons));
  assert.equal(l.last_checked, "2026-10-30T14:00:00Z");
  r = await syncFeed(s, feed1, deps());                    // mesma pesquisa: nada muda
  assert.deepEqual([r.novos, r.atualizados], [0, 0]);
  const feed2 = { generated_at: "2026-11-02T14:00:00Z", listings: [{ url, checked_at: "2026-11-02T14:00:00Z", text: text("91.900") }] };
  r = await syncFeed(s, feed2, deps());
  assert.equal(r.atualizados, 1); assert.equal(l.price, 91900);
  assert.equal(l.texts.length, 1);                          // guarda só a pesquisa mais recente
  assert.ok(s.notifications.some((n) => n.kind === "reducao_preco"));
  assert.equal(l.snapshots.at(-1).at, "2026-11-02T14:00:00Z");
  r = await syncFeed(s, { listings: [{ url, checked_at: "2026-11-05T14:00:00Z", available: false }] }, deps());
  assert.equal(r.indisponiveis, 1); assert.equal(l.status, "descartado");
});

test("ignorar 'Onix (hatch)' não atinge o Onix Plus, e vice-versa", () => {
  const hatch = L("CHEVROLET", "ONIX", "10 TURBO FLEX PREMIER AUTOMATICO", 2025), sedan = L("CHEVROLET", "ONIX", "10 TURBO FLEX PLUS PREMIER AUTOMATICO", 2025);
  const onlyHatch = [{ make: "Chevrolet", model: "onix", version_excludes: "plus" }], onlySedan = [{ make: "Chevrolet", model: "onix", version_includes: "plus" }];
  assert.ok(findExclusion(onlyHatch, hatch)); assert.equal(findExclusion(onlyHatch, sedan), null);
  assert.ok(findExclusion(onlySedan, sedan)); assert.equal(findExclusion(onlySedan, hatch), null);
});

// ------------------------------------------------------------ aderência e faixas
import { scoreListing, byAdherence } from "../core/score.js";
test("nota: só diferenciais; pré-requisitos e distância não pontuam; descartado sem nota", () => {
  const now = new Date("2026-10-31");
  const base = { status: "aprovado", reasons: [], price: 90000, km: 20000, year_model: 2025, fipe: 95000, distance: { km: 20 },
    checks: { adas: { state: "confirmado" } } };
  const spec = { tech: { city_g: 12, trunk_l: 469 } };
  const a = scoreListing(base, DEFAULT_CRITERIA, spec, now).total;
  const longe = scoreListing({ ...base, distance: { km: 59 } }, DEFAULT_CRITERIA, spec, now).total;
  const pend = scoreListing({ ...base, status: "pendente", reasons: [{ field: "inducao", level: "pending" }] }, DEFAULT_CRITERIA, spec, now).total;
  const caro = scoreListing({ ...base, price: 99000, km: 34000 }, DEFAULT_CRITERIA, spec, now).total;
  const semAdas = scoreListing({ ...base, checks: {} }, DEFAULT_CRITERIA, spec, now).total;
  const desc = scoreListing({ ...base, status: "descartado" }, DEFAULT_CRITERIA, spec, now);
  assert.equal(longe, a); assert.equal(pend, a);
  assert.ok(a > caro && a > semAdas, `${a} ${caro} ${semAdas}`);
  assert.equal(desc.total, null); assert.equal(desc.level, "nd");
  const list = [{ status: "descartado", score: { total: null } }, { status: "pendente", score: { total: 60 } }, { status: "aprovado", score: { total: 90 } }].sort(byAdherence);
  assert.deepEqual(list.map((x) => x.score.total), [90, 60, null]);
});

test("preço e km mínimos", () => {
  const c = { ...DEFAULT_CRITERIA, min_price: 80000, min_km: 5000 };
  assert.equal(classify({ ...base, price: 75000 }, allOk, c).status, DISCARDED);
  assert.equal(classify({ ...base, km: 1000 }, allOk, c).status, DISCARDED);
  assert.equal(classify(base, allOk, c).status, APPROVED);
});

import { makeDistance } from "../core/distance.js";
test("rotas: se o OpenRouteService falhar, usa o OSRM", async () => {
  const fake = async (url) => {
    if (url.includes("openrouteservice")) return { ok: false, status: 503, json: async () => ({}) };
    if (url.includes("nominatim")) return { ok: true, json: async () => [{ lat: "-23.5", lon: "-46.8" }] };
    if (url.includes("project-osrm")) return { ok: true, json: async () => ({ code: "Ok", routes: [{ distance: 31234 }] }) };
    throw new Error("inesperado " + url);
  };
  const s = newState(); s.settings.distance = { provider: "ors", ors_key: "x" };
  const r = await makeDistance(fake)(s, "Barueri, SP", "São Paulo", "SP", null);
  assert.equal(r.status, "verificada"); assert.equal(r.km, 31.2); assert.match(r.note, /usado o OSRM/);
});

// ------------------------------------------------------------ vendedor e contato
import { contactMessage, whatsappLink } from "../core/engine.js";
import { sellerType } from "../core/parsing.js";
test("tipo de vendedor e filtro", async () => {
  assert.equal(sellerType("Guilherme (Pessoa Física)"), "particular");
  assert.equal(sellerType("Nissan Sinal Aricanduva"), "concessionaria");
  assert.equal(sellerType("Bexp Jeep Bexp Brooklin"), "concessionaria");
  assert.equal(sellerType("Dinho Multimarcas"), "loja");
  const s = newState();
  await importListing(s, { url: KARDIAN, text: KARDIAN_TXT + "\nVendedor: Guilherme (Pessoa Física)" }, deps());
  const l = s.listings[0];
  assert.equal(l.seller_type, "particular"); assert.equal(l.field_sources.seller_type, "derivado_vendedor");
  assert.equal(l.status, "aprovado");
  s.settings.criteria.seller_types = ["loja", "concessionaria"]; reclassifyAll(s, deps());
  assert.equal(l.status, "descartado");
  await editFields(s, l, { seller_type: "loja" }, deps());
  assert.equal(l.status, "aprovado");
});
test("mensagem padrão e link do WhatsApp", () => {
  const s = newState();
  const l = { make: "RENAULT", model: "KARDIAN", version: "PREMIERE EDITION", year_fab: 2024, year_model: 2025, price: 97990, url: "https://x/1" };
  const m = contactMessage(s, l);
  assert.match(m, /Renault Kardian Premiere Edition 2024\/2025/); assert.match(m, /R\$ 97\.990/); assert.match(m, /Onix Hatch 1\.0 Turbo automático LT 2020, com 108 mil km/);
  assert.equal(whatsappLink("(11) 98765-4321", "oi"), "https://wa.me/5511987654321?text=oi");
  assert.equal(whatsappLink("123", "oi"), null);
});
test("favorito que sai do ar continua guardado e avisa", async () => {
  const s = newState();
  await importListing(s, { url: KARDIAN, text: KARDIAN_TXT }, deps());
  const l = s.listings[0]; l.favorite = true;
  reconfirm(s, l, { available: false }, deps());
  assert.ok(s.notifications.some((n) => n.kind === "favorito_indisponivel"));
  assert.ok(l.unavailable_since); assert.equal(s.listings.length, 1);
});

test("mensagem formata versão do WebMotors", () => {
  const m = contactMessage(newState(), { make: "CHEVROLET", model: "ONIX", version: "10 TURBO FLEX PLUS PREMIER AUTOMATICO", year_model: 2025, price: 88800, url: "u" });
  assert.match(m, /Chevrolet Onix 1\.0 Turbo Flex Plus Premier Automatico 2025/);
});

// ------------------------------------------------------------ sugestões de modelos ignorados
import { ignoreSuggestions, trimOf } from "../core/catalog.js";
test("acabamento e sugestões do mais amplo ao mais específico", () => {
  assert.equal(trimOf("10 TURBO FLEX PLUS PREMIER AUTOMATICO"), "plus premier");
  assert.equal(trimOf("10 TCE FLEX PREMIERE EDITION EDC"), "premiere edition");
  assert.equal(trimOf("1.4 MPFI LTZ 8V FLEX 4P AUTOMATICO"), "ltz");
  const ls = [L("CHEVROLET", "ONIX", "10 TURBO FLEX PREMIER AUTOMATICO", 2025), L("CHEVROLET", "ONIX", "10 TURBO FLEX PLUS PREMIER AUTOMATICO", 2025),
    L("CHEVROLET", "ONIX", "14 MPFI LTZ 8V FLEX 4P AUTOMATICO", 2019), L("FIAT", "PULSE", "10 TURBO 200 FLEX IMPETUS CVT", 2022)];
  const sg = ignoreSuggestions(ls);
  const onix = sg.find((g) => g.model === "ONIX");
  assert.equal(onix.count, 3);
  const premier = onix.trims.find((t) => t.trim === "premier").rule, ltz = onix.trims.find((t) => t.trim === "ltz").rule;
  assert.deepEqual(premier.version_excludes, ["plus"]);
  assert.ok(findExclusion([premier], ls[0])); assert.equal(findExclusion([premier], ls[1]), null);   // só o hatch Premier
  assert.ok(findExclusion([ltz], ls[2])); assert.equal(findExclusion([ltz], ls[0]), null);            // só o LTZ
  assert.ok(ls.slice(0, 3).every((l) => findExclusion([onix.ruleModel], l)));                          // todos os Onix
  assert.equal(findExclusion([onix.ruleModel], ls[3]), null);
  assert.ok(ls.slice(0, 3).every((l) => findExclusion([onix.ruleMake], l)));                           // a marca toda
});

import { allSpecs } from "../core/engine.js";
test("fichas publicadas em data/fichas.json entram na validação", async () => {
  const s = newState();
  s.remote_specs = [{ id: "vw-virtus-exclusive-2023", make: "volkswagen", model: "virtus", version_includes: ["exclusive"], version_excludes: [],
    year_from: 2023, year_to: 2023, items: { inducao: { state: "confirmado", quote: "carregador por indução" } },
    source: { title: "Catálogo VW", url: "https://exemplo.com", quality: "oficial" } }];
  assert.ok(allSpecs(s).some((x) => x.id === "vw-virtus-exclusive-2023"));
  assert.equal(findSpec(allSpecs(s), L("VOLKSWAGEN", "VIRTUS", "10 200 TSI EXCLUSIVE AUTOMATICO", 2023)).id, "vw-virtus-exclusive-2023");
});

// ------------------------------------------------------------ ADAS desejável e FIPE
import { fipeDiscount } from "../core/score.js";
test("ADAS desejável: sem ADAS ainda aprova; com ADAS a nota sobe; opção de tornar obrigatório", () => {
  const sem = { ...allOk, adas: { state: PENDING } }, nao = { ...allOk, adas: { state: ABSENT } };
  assert.equal(classify(base, sem, DEFAULT_CRITERIA).status, APPROVED);
  assert.equal(classify(base, nao, DEFAULT_CRITERIA).status, APPROVED);
  assert.equal(classify(base, sem, { ...DEFAULT_CRITERIA, adas_required: true }).status, ST_PENDING);
  assert.equal(classify(base, nao, { ...DEFAULT_CRITERIA, adas_required: true }).status, DISCARDED);
  const mk = (checks) => { const r = classify(base, checks, DEFAULT_CRITERIA); return scoreListing({ ...base, ...r, checks }, DEFAULT_CRITERIA).total; };
  assert.ok(mk(allOk) > mk(sem), `${mk(allOk)} > ${mk(sem)}`);
});
test("FIPE: extrai do texto, não confunde com o preço e calcula o desconto", () => {
  const p = extractFromText("ONIX\nFIPE: R$ 95.988\nPreço: R$ 88.800\nAno: 2025/2025\nSelo: Abaixo da Fipe");
  assert.equal(p.fields.price, 88800); assert.equal(p.fields.fipe, 95988); assert.equal(p.fields.below_fipe_tag, true);
  const q = extractFromText("Preço: R$ 97.990\nFIPE: R$ 95.988");
  assert.equal(q.fields.price, 97990); assert.equal(q.fields.fipe, 95988);
  assert.equal(fipeDiscount({ price: 88800, fipe: 95988 }), 7.5);
  assert.equal(fipeDiscount({ price: 97990, fipe: 95988 }), -2.1);
  assert.equal(fipeDiscount({ price: 90000 }), null);
  const cheap = scoreListing({ ...base, status: "aprovado", reasons: [], price: 88800, fipe: 95988 }, DEFAULT_CRITERIA).total;
  const exp = scoreListing({ ...base, status: "aprovado", reasons: [], price: 88800, fipe: 85000 }, DEFAULT_CRITERIA).total;
  assert.ok(cheap > exp);
});

// ------------------------------------------------------------ leilão, blindagem, carroceria, cores e características
test("leilão/blindagem/carroceria/cor e características", () => {
  const ok = { ...allOk };
  const st = (extra, crit = {}) => classify({ ...base, ...extra }, ok, { ...DEFAULT_CRITERIA, ...crit }).status;
  assert.equal(st({ auction: true }), DISCARDED);
  assert.equal(st({ auction: null }), APPROVED); // não informado não trava
  assert.equal(st({ auction: true }, { no_auction: false }), APPROVED);
  assert.equal(st({ armored: true }), DISCARDED);
  assert.equal(st({ body: "hatch" }, { body_types: ["suv"] }), DISCARDED);
  assert.equal(st({ body: null, body_ficha: "suv" }, { body_types: ["suv"] }), APPROVED);
  assert.equal(st({ body: null }, { body_types: ["suv"] }), ST_PENDING);
  assert.equal(st({ color: "prata" }, { avoid_colors: ["prata"] }), DISCARDED);
  const p = extractFromText("Características: Único dono; Garantia de fábrica\nFinal de placa: 3\nLeilão: Não\nCarroceria: Sedã");
  assert.deepEqual(p.fields.features, ["unico_dono", "garantia_fabrica"]); assert.equal(p.fields.plate_end, 3);
  assert.equal(p.fields.auction, false); assert.equal(p.fields.body, "sedan");
  const s0 = scoreListing({ ...base, status: "aprovado", reasons: [] }, DEFAULT_CRITERIA).total;
  const s1 = scoreListing({ ...base, status: "aprovado", reasons: [], features: ["unico_dono", "revisoes_concessionaria", "garantia_fabrica"] }, DEFAULT_CRITERIA).total;
  assert.ok(s1 > s0, `${s1} > ${s0}`);
});

test("todas as fichas publicadas (data/fichas.json) passam na validação do app", async () => {
  const { validateSpec } = await import("../core/specs.js");
  const fs = await import("node:fs");
  const fichas = JSON.parse(fs.readFileSync(new URL("../data/fichas.json", import.meta.url), "utf8"));
  const bad = fichas.map((s) => [s.id, validateSpec(s)]).filter(([, e]) => e.length);
  assert.deepEqual(bad, []);
});

test("fotos: mínimo do filtro, sem foto e anúncio em preparação", () => {
  const r = (l, c = {}) => classify(l, {}, { ...DEFAULT_CRITERIA, ...c }).reasons.find((x) => x.field === "photos");
  assert.equal(r({ photos: 1 }).level, "fail");
  assert.equal(r({ photos: 1 }, { min_photos: 1 }).level, "ok");
  assert.equal(r({ photos: 0 }, { min_photos: 1 }).level, "fail");
  assert.equal(r({ photos: 8 }).level, "ok");
  assert.equal(r({ photos: null }).level, "info");
  assert.equal(r({ photos: 5, preparing: true }, { min_photos: 1 }).level, "fail");
  const ex = extractFromText("VW POLO\nFotos: 1 (em preparação)\nCor: Branco");
  assert.ok(JSON.stringify(ex).includes('"photos"'));
  assert.ok(JSON.stringify(ex).includes('"preparing"'));
});
