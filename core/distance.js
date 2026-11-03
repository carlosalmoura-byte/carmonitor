// Distância POR ESTRADA calculada no próprio celular.
// OSRM (servidor público, uso leve) + Nominatim (geocodificação, máx. 1 req/s) ou OpenRouteService (chave do usuário).
// Sem cidade/UF ou com falha do provedor => "não verificada" (nunca linha reta).

let lastNominatim = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeDistance(fetchFn = (...a) => fetch(...a)) {
  async function getJson(url, opts) {
    const r = await fetchFn(url, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function geocode(state, provider, q, poiOnly = false) {
    const ck = `geo:${provider}:${poiOnly ? "poi:" : ""}${q.toLowerCase()}`;
    if (state.geo_cache[ck] === false) return null; // já procurado sem sucesso
    if (state.geo_cache[ck]) return state.geo_cache[ck];
    let coords = null;
    if (provider === "ors") {
      const d = await getJson(`https://api.openrouteservice.org/geocode/search?api_key=${encodeURIComponent(state.settings.distance.ors_key)}&text=${encodeURIComponent(q)}&boundary.country=BR&size=1`);
      const f = d.features?.[0];
      if (f && !(poiOnly && ["locality", "localadmin", "county", "region", "neighbourhood", "borough"].includes(f.properties?.layer))) coords = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
    } else {
      const wait = lastNominatim + 1100 - Date.now();
      if (wait > 0) await sleep(wait);
      lastNominatim = Date.now();
      const d = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`);
      // poiOnly: só aceita estabelecimento/endereço, nunca a cidade/bairro inteiro (sinal de que a loja não foi achada)
      if (d[0] && !(poiOnly && ["boundary", "place"].includes(d[0].category))) coords = [Number(d[0].lat), Number(d[0].lon)];
    }
    state.geo_cache[ck] = coords || false;
    return coords;
  }

  async function roadKm(state, provider, a, b) {
    const ck = `route:${provider}:${a.map((x) => x.toFixed(5))}->${b.map((x) => x.toFixed(5))}`;
    if (state.geo_cache[ck] != null) return state.geo_cache[ck];
    let km = null;
    if (provider === "ors") {
      const d = await getJson("https://api.openrouteservice.org/v2/directions/driving-car", {
        method: "POST", headers: { Authorization: state.settings.distance.ors_key, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [[a[1], a[0]], [b[1], b[0]]] }) });
      if (d.routes?.[0]) km = d.routes[0].summary.distance / 1000;
    } else {
      const d = await getJson(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false`);
      if (d.code === "Ok" && d.routes?.[0]) km = d.routes[0].distance / 1000;
    }
    if (km != null) { km = Math.round(km * 10) / 10; state.geo_cache[ck] = km; }
    return km;
  }

  // km em linha reta (só para validar se o ponto achado da loja está mesmo na cidade do anúncio)
  const straight = (a, b) => { const R = 6371, r = (x) => x * Math.PI / 180, dl = r(b[0] - a[0]), dn = r(b[1] - a[1]);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  /** Nome da loja limpo para busca no mapa: tira "(Loja)", códigos entre parênteses e sufixos jurídicos. */
  const storeQuery = (s) => String(s || "").replace(/\([^)]*\)/g, " ").replace(/\b(ltda|me|eireli|s\.?a\.?|comercio de veiculos|com[eé]rcio de ve[ií]culos)\b\.?/gi, " ")
    .replace(/\s+/g, " ").trim();

  async function distance(state, ref, city, uf, address, forced = null, store = null) {
    let provider = forced || state.settings.distance.provider;
    if (provider === "ors" && !state.settings.distance.ors_key) provider = "none";
    if (provider === "none") return { km: null, status: "nao_verificada", precision: null, note: "Cálculo de rota desativado nos ajustes." };
    if (!city || !uf) return { km: null, status: "nao_verificada", precision: null, note: "Cidade/UF do anúncio desconhecida." };
    let precision = address ? "endereco" : "cidade";
    try {
      const origin = await geocode(state, provider, `${ref}, Brasil`);
      let dest = address ? await geocode(state, provider, `${address}, ${city}, ${uf}, Brasil`) : null;
      if (!dest) {
        const center = await geocode(state, provider, `${city}, ${uf}, Brasil`);
        const sq = storeQuery(store);
        // loja achada no mapa pelo nome — só vale se estiver a até 40 km do centro da cidade do anúncio
        const shop = sq.length >= 4 ? await geocode(state, provider, `${sq}, ${city}, ${uf}`, true) : null;
        if (shop && center && straight(shop, center) <= 40) { dest = shop; precision = "loja"; }
        else { dest = center; precision = "cidade"; }
      }
      if (!origin || !dest) return { km: null, status: "nao_verificada", precision: null, note: "Local não encontrado na geocodificação." };
      const km = await roadKm(state, provider, origin, dest);
      if (km == null) return { km: null, status: "nao_verificada", precision: null, note: "Rota rodoviária não encontrada." };
      const alvo = precision === "endereco" ? "endereço/CEP do anúncio" : precision === "loja" ? `local da loja “${storeQuery(store)}” no mapa (OpenStreetMap)` : "centro da cidade do anúncio";
      return { km, status: "verificada", precision, note: `Rota de carro (${provider.toUpperCase()}) de ${ref} até o ${alvo}.` };
    } catch (e) {
      if (provider === "ors") { // OpenRouteService fora do ar ou chave inválida: usa o OSRM gratuito
        const r = await distance(state, ref, city, uf, address, "osrm", store);
        if (r.status === "verificada") r.note += ` (OpenRouteService indisponível: ${e.message || e.name}; usado o OSRM.)`;
        return r;
      }
      return { km: null, status: "nao_verificada", precision: null, note: `Falha no serviço de rotas (${e.message || e.name}). Sem internet? Tente de novo.` };
    }
  }
  return distance;
}
