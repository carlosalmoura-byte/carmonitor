// Catálogo de marcas e modelos para escolha (Modelos ignorados). Nomes como aparecem no WebMotors.
// Alguns modelos são, no WebMotors, uma versão de outro (ex.: Onix Plus = modelo ONIX, versão "PLUS ...").
// Cada entrada: [nome exibido, modelo no WebMotors, versão contém?, versão não contém?]
export const CATALOG = {
  Chevrolet: [["Onix (hatch)", "onix", "", "plus"], ["Onix Plus (sedã)", "onix", "plus", ""], ["Tracker", "tracker"], ["Montana", "montana"],
    ["Spin", "spin"], ["S10", "s10"], ["Cruze", "cruze"], ["Equinox", "equinox"], ["Trailblazer", "trailblazer"], ["Spark EUV", "spark"]],
  Volkswagen: [["Polo", "polo"], ["Virtus", "virtus"], ["T-Cross", "t cross"], ["Nivus", "nivus"], ["Tera", "tera"], ["Taos", "taos"],
    ["Jetta", "jetta"], ["Saveiro", "saveiro"], ["Amarok", "amarok"], ["Gol", "gol"]],
  Fiat: [["Argo", "argo"], ["Cronos", "cronos"], ["Mobi", "mobi"], ["Pulse", "pulse"], ["Fastback", "fastback"], ["Strada", "strada"],
    ["Toro", "toro"], ["Titano", "titano"]],
  Hyundai: [["HB20 (hatch)", "hb20"], ["HB20S (sedã)", "hb20s"], ["Creta", "creta"], ["Tucson", "tucson"]],
  Toyota: [["Yaris", "yaris"], ["Corolla", "corolla"], ["Corolla Cross", "corolla cross"], ["Hilux", "hilux"], ["SW4", "hilux sw4"]],
  Honda: [["City (sedã)", "city", "", "hatch"], ["City Hatchback", "city", "hatch", ""], ["HR-V", "hr v"], ["ZR-V", "zr v"], ["WR-V", "wr v"], ["Civic", "civic"]],
  Renault: [["Kwid", "kwid"], ["Kardian", "kardian"], ["Duster", "duster"], ["Oroch", "oroch"], ["Logan", "logan"], ["Sandero", "sandero"], ["Captur", "captur"]],
  Nissan: [["Kicks", "kicks"], ["Versa", "versa"], ["Sentra", "sentra"], ["Frontier", "frontier"]],
  Jeep: [["Renegade", "renegade"], ["Compass", "compass"], ["Commander", "commander"]],
  Peugeot: [["208", "208"], ["2008", "2008"], ["3008", "3008"]],
  "Citroën": [["C3", "c3"], ["C3 Aircross", "c3 aircross"], ["Basalt", "basalt"], ["C4 Cactus", "c4 cactus"]],
  "Caoa Chery": [["Tiggo 5x", "tiggo 5x"], ["Tiggo 7", "tiggo 7"], ["Tiggo 8", "tiggo 8"], ["Arrizo 6", "arrizo 6"]],
  BYD: [["Dolphin", "dolphin"], ["Dolphin Mini", "dolphin mini"], ["Seal", "seal"], ["Song Plus", "song plus"], ["Song Pro", "song pro"],
    ["Yuan Plus", "yuan plus"], ["King", "king"]],
  GWM: [["Haval H6", "haval h6"], ["Ora 03", "ora 03"]],
  Ford: [["Ranger", "ranger"], ["Territory", "territory"], ["Bronco Sport", "bronco sport"], ["Maverick", "maverick"]],
  Kia: [["Sportage", "sportage"], ["Stonic", "stonic"], ["Niro", "niro"]],
  Mitsubishi: [["L200", "l200 triton"], ["Eclipse Cross", "eclipse cross"], ["Pajero Sport", "pajero sport"]],
};

export const CITIES = ["Barueri, SP", "São Paulo, SP"];

// Palavras de motorização/câmbio que não identificam o acabamento (versão "comercial")
const NOT_TRIM = new Set(("turbo flex total automatico automatica automatizado aut at mt manual cvt edc dct dsg tsi tgdi tce gdi mpfi " +
  "vtec ivtec i v gasolina diesel hibrido hybrid eletrico mhev 4x4 4x2 awd fwd cd cs cab portas 4p 2p 5p 3p mec tiptronic s tronic " +
  "steptronic aircross hatch sedan tb tbi t200 t270 ecotec").split(" "));

/** Acabamento a partir da versão do WebMotors: "10 TURBO FLEX PLUS PREMIER AUTOMATICO" -> "plus premier". */
export function trimOf(version) {
  const words = String(version || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  return words.filter((w) => !/^\d/.test(w) && !/^\d+v$/.test(w) && !NOT_TRIM.has(w)).join(" ") || null;
}

/**
 * Opções de "ignorar" a partir dos anúncios, do mais amplo ao mais específico.
 * listings: [{make, model, version}] -> [{make, model, count, trims:[{trim, count, rule}], ruleModel, ruleMake}]
 */
export function ignoreSuggestions(listings) {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const groups = new Map();
  for (const l of listings) {
    if (!l.make || !l.model) continue;
    const k = `${norm(l.make)}|${norm(l.model)}`;
    const g = groups.get(k) || { make: l.make, model: l.model, count: 0, trims: new Map() };
    g.count++;
    const t = trimOf(l.version);
    if (t) g.trims.set(t, (g.trims.get(t) || 0) + 1);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).map((g) => {
    const trims = [...g.trims.entries()].map(([trim, count]) => {
      // se outro acabamento do mesmo modelo contém este (ex.: "premier" ⊂ "plus premier"), exclui as palavras a mais
      const mine = new Set(trim.split(" "));
      const extra = [...g.trims.keys()].filter((o) => o !== trim && trim.split(" ").every((w) => o.split(" ").includes(w)))
        .flatMap((o) => o.split(" ").filter((w) => !mine.has(w)));
      return { trim, count, rule: { make: g.make, model: norm(g.model), version_includes: trim, version_excludes: [...new Set(extra)] } };
    }).sort((a, b) => b.count - a.count);
    return { make: g.make, model: g.model, count: g.count, trims,
      ruleModel: { make: g.make, model: norm(g.model) }, ruleMake: { make: g.make } };
  });
}
