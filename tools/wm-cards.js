// Cole no javascript_tool com uma página de LISTAGEM do WebMotors aberta no navegador. Só lê a página.
// Retorna { blocked, n, cards:[{url, ano, km, preco, cidade, abaixoFipe, card}] } — `card` é o texto do cartão.
(() => {
  if (/Pressione e segure|Access to this page has been denied/i.test(document.body.innerText)) return { blocked: true };
  const id = (h) => (h.split("?")[0].match(/\/(\d{6,})$/) || [])[1];
  const seen = new Map();
  for (const a of document.querySelectorAll('a[href*="/comprar/"]')) {
    const ad = id(a.href); if (!ad || seen.has(ad)) continue;
    let el = a;
    while (el.parentElement) {
      const ids = new Set([...el.parentElement.querySelectorAll('a[href*="/comprar/"]')].map((x) => id(x.href)).filter(Boolean));
      if (ids.size > 1) break;
      el = el.parentElement;
    }
    const t = el.innerText.replace(/\s+/g, " ").trim();
    if (/Oferta de Fábrica|Patrocinado/i.test(t) && !/ Km /.test(t)) continue;
    const ak = t.match(/(\d{4}\/\d{4}|\d{4}) • ([\d.]+) Km/);
    seen.set(ad, { url: a.href.split("?")[0], ano: ak && ak[1], km: ak && ak[2], preco: (t.match(/R\$ ?([\d.]{5,})/) || [])[1],
      cidade: (t.match(/Km ([^()]+) \((\w\w)\)/) || []).slice(1).join("/"), abaixoFipe: /Abaixo da Fipe/i.test(t), card: t.slice(0, 220) });
  }
  const cards = [...seen.values()];
  return { blocked: false, n: cards.length, cards };
})()
