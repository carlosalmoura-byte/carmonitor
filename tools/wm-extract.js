// Cole o conteúdo desta função no javascript_tool do navegador, com a página do anúncio do WebMotors ABERTA
// (navegada pelo usuário/navegador do app — nunca via fetch). Só LÊ o que a página mostra; não clica nem preenche nada.
// Retorna { ok, blocked, url, text, fields } — `text` já no formato da seção 4 do RESEARCH.md.
(() => {
  const body = document.body.innerText;
  const flat = body.replace(/\s+/g, " ");
  if (/Pressione e segure|Access to this page has been denied/i.test(flat)) return { ok: false, blocked: true, url: location.href };
  const title = (document.title.split(" - WebMotors")[0] || "").trim();
  if (!/\d{6,}$/.test(location.pathname) || !title) return { ok: false, blocked: false, url: location.href, reason: "não é página de anúncio (ainda carregando ou saiu do ar)" };
  const lines = body.split("\n").map(s => s.trim()).filter(Boolean);
  const after = (label) => { const i = lines.findIndex(l => l.toLowerCase() === label.toLowerCase()); return i >= 0 ? lines[i + 1] : null; };
  const sec = (start, end) => { const m = body.match(new RegExp(start + "\\n([\\s\\S]*?)\\n" + end)); return m ? m[1].split("\n").map(s => s.trim()).filter(Boolean) : []; };
  const f = {
    cidade: after("Cidade"), ano: after("Ano"), km: after("KM"), cambio: after("Câmbio"), carroceria: after("Carroceria"),
    placa: after("Final de placa"), cor: after("Cor"), blindado: after("Blindado"), leilao: after("Leilão"),
  };
  const preco = flat.match(/Valor anunciado R\$ ?([\d.]+)/) || flat.match(/R\$ ?([\d.]{5,})/);
  const fipe = flat.match(/fipe R\$ ?([\d.]+) Valor deste carro na Tabela Fipe/i);
  f.preco = preco && preco[1]; f.fipe = fipe && fipe[1];
  // Características: rótulos Sim/Não que o WebMotors mostra no bloco de dados
  const car = [];
  for (const [lab, out] of [["Único dono", "Único dono"], ["IPVA pago", "IPVA pago"], ["Licenciado", "Licenciado"],
    ["Garantia de fábrica", "Garantia de fábrica"], ["Todas as revisões feitas pela concessionária", "Todas as revisões feitas pela concessionária"],
    ["Revisões feitas pela concessionária", "Todas as revisões feitas pela concessionária"]]) {
    if ((after(lab) || "").toLowerCase() === "sim") car.push(out);
  }
  f.caracteristicas = [...new Set(car)];
  f.itens = sec("Itens de veículo", "(Sobre o vendedor|Sobre o veículo|Observações do vendedor|Compare os preços|Confiança e tranquilidade)");
  const vend = sec("Sobre o vendedor", "(Compare os preços|Para ver as parcelas)");
  const nome = vend[0] || null;
  const temLoja = /Ver todos os carros deste vendedor/.test(vend.join(" "));
  f.vendedor = nome ? `${nome} (${temLoja ? "Loja" : "Pessoa Física"})` : null;
  f.whatsapp = /whatsapp/i.test(vend.join(" ")) || !!document.querySelector('a[href*="wa.me"],a[href*="whatsapp"]');
  f.selo = /Abaixo da Fipe/i.test(flat);
  const obs = sec("(Observações do vendedor|Sobre o veículo)", "(Itens de veículo|Sobre o vendedor|Compare os preços)");
  const mes = new Date().toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(". de ", "/").replace(" de ", "/");
  const t = [title];
  if (f.preco) t.push(`Preço: R$ ${f.preco}`);
  if (f.ano) t.push(`Ano: ${f.ano}`);
  if (f.km) t.push(`KM: ${f.km}`);
  if (f.cambio) t.push(`Câmbio: ${f.cambio}`);
  if (f.cidade) t.push(`Cidade: ${f.cidade}`);
  if (f.vendedor) t.push(`Vendedor: ${f.vendedor}`);
  t.push(f.fipe ? `FIPE: R$ ${f.fipe} (página do anúncio no WebMotors, ${mes})` : "FIPE: não encontrada");
  if (f.selo) t.push("Selo: Abaixo da Fipe");
  if (f.carroceria) t.push(`Carroceria: ${f.carroceria}`);
  if (f.cor) t.push(`Cor: ${f.cor}`);
  if (f.placa) t.push(`Final de placa: ${f.placa}`);
  if (f.leilao) t.push(`Leilão: ${f.leilao}`);
  if (f.blindado) t.push(`Blindado: ${f.blindado}`);
  if (f.caracteristicas.length) t.push(`Características: ${f.caracteristicas.join("; ")}`);
  if (f.whatsapp) t.push("WhatsApp: Sim");
  if (f.itens.length) t.push(`Itens de veículo: ${f.itens.join("; ")}`);
  if (obs.length) t.push(obs.join(" ").slice(0, 1500));
  return { ok: true, blocked: false, url: location.href.split("?")[0], text: t.join("\n"), fields: f };
})()
