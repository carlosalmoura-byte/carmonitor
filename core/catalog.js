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
