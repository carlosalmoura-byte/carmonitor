# Procedimento: atualizar a pesquisa de anúncios (executado pelo Claude a pedido)

Este repositório publica o app CarMonitor (GitHub Pages). O app lê `data/anuncios.json` e `data/status.json`.
O usuário pede uma nova pesquisa pelo botão **Atualizar pesquisa** do app, que abre uma *issue* neste repositório
com o título começando por `Atualizar pesquisa` e um bloco JSON com os critérios. Este documento descreve como
atender esse pedido.

## 1. Qual filtro usar e existe pedido pendente?

**Regra principal: nunca pesquise sem antes ler o filtro que está no app.** O app grava o filtro atual do usuário
(critérios + modelos ignorados) em `data/filtro.json` neste repositório sempre que é aberto ou que o filtro muda.
Comece sempre por:

```bash
git pull --rebase origin main          # traz o filtro mais recente gravado pelo app
cat data/filtro.json                   # filtro a usar (campo updated_at = quando foi salvo no app)
cat data/status.json                   # filter_used_at = filtro usado na última pesquisa
curl -s "https://api.github.com/repos/carlosalmoura-byte/carmonitor/issues?state=open&per_page=20"
```

`data/filtro.json` tem `criteria` (min_price, max_price, year_min, year_max, min_km, max_km, transmissions,
conditions, seller_types, ref_location, max_distance_km, adas_required) e `exclusions` (modelos ignorados).
**Use exatamente esses critérios** — inclusive `seller_types`: se "particular" não estiver na lista, não traga
anúncio de pessoa física; se o tipo de vendedor não aparecer na página, o anúncio pode entrar (o app deixa
pendente), mas registre o nome do vendedor sempre que a página mostrar.

Pedido pendente =
- `data/filtro.json` com `updated_at` diferente de `filter_used_at` em `data/status.json` (o usuário mudou o filtro); **ou**
- issue aberta cujo título começa com `Atualizar pesquisa` e cujo número **não** está em `processed_issues`.

Sem pedido pendente: **pare aqui sem fazer nada** (fora do modo agendado). Com issue pendente, os critérios continuam
sendo os de `data/filtro.json` se ele for mais recente que a issue; senão, os do bloco ```json da issue
(`criteria`, `exclusions`, `urls` = anúncios já no app, `favorites` = links favoritos — reconfira-os primeiro).
Registre todas as issues pendentes como processadas (`--issue N,M`).

### Modo agendado (6h e 13h)

As execuções agendadas das 6h e 13h (horário de Brasília) pesquisam **mesmo sem pedido pendente**, a pedido do
usuário, sempre com os critérios de `data/filtro.json`. Só se esse arquivo não existir, use o bloco JSON da issue
"Atualizar pesquisa" mais recente; e só se também não houver issue, use o padrão (até R$ 100.000; ano-modelo
2022–2025; até 35.000 km; automático; usados/seminovos; particular, loja e concessionária; Barueri, SP, até 60 km)
e escreva no `--note` "filtro do app indisponível — critérios padrão" e passe `--sem-filtro`. Use
`--note "pesquisa agendada"` nos demais casos.

### Antes de publicar: reaplique o filtro em tudo

Confira também os anúncios que **já estão** em `data/anuncios.json` contra o filtro atual. O app reclassifica
sozinho (descarta o que não atende), então não apague nada; mas não traga anúncios novos fora do filtro.

### Ao começar a pesquisar (avise o app)

Assim que decidir que vai pesquisar, antes de abrir o WebMotors:

```bash
node tools/start-research.mjs pedido      # ou: agendada
git add data/status.json && git commit -m "Pesquisa iniciada" && git pull --rebase origin main && git push origin main
```

O app mostra "Pesquisando agora". O `merge-feed` limpa essa marca ao publicar.

**Se a pesquisa não puder concluir** (WebMotors inacessível, erro, nada pôde ser lido), não deixe a marca "em andamento":
rode `node tools/fail-research.mjs "<motivo curto>"`, faça commit de `data/status.json` e push. O app mostra
"Última tentativa falhou: <motivo>" e a hora da próxima tentativa; o pedido continua pendente.

### Pedido perto da pesquisa agendada

Se a verificação de pedidos cair entre 5:30 e 5:59 ou entre 12:30 e 12:59 (horário de Brasília), **não pesquise**:
a pesquisa agendada começa às 5:46/12:46 e já usa o filtro atual.

### Avisos de problema enviados pelo app

Issues abertas com título começando por `Problema no anúncio` trazem um bloco JSON com `url`, `kind`
(`nao_abre`, `vendido`, `dados`, `outro`) e `text`. Também são pedido pendente: reabra a página do anúncio (ou
procure-o na listagem). Se a página mostrar que saiu do ar, publique `{ "url": ..., "available": false }`; se os dados
estiverem errados, publique a transcrição corrigida. Ao terminar, feche a issue com um comentário curto do que achou
(`curl -X PATCH .../issues/N -d '{"state":"closed"}'` com o token do git, se houver; senão só registre em
`--issue N`).

## 2. Regras (obrigatórias)

- Os Termos de Uso da Webmotors proíbem raspagem automatizada. A pesquisa acontece **somente quando há pedido ou no horário agendado pelo usuário (6h e 13h)** e
  é feita página a página como uma consulta humana: **WebSearch** (com `allowed_domains: ["webmotors.com.br"]`)
  para achar páginas de listagem, **WebFetch** dessas páginas e dos anúncios que aparecem nelas. Nada de curl,
  scripts ou contornar bloqueios no webmotors.com.br. URL recusada = siga em frente.
- **Não invente nada.** Transcreva apenas o que a página mostrou. O que não constar fica fora do texto.
- Só marque `available: false` quando a página do anúncio indicar claramente que foi vendido/removido. Se a página
  não puder ser aberta, **não** marque nada (deixe como estava).
- Limite: cerca de 40 páginas de anúncio por pedido.
- **Leilão, blindagem, carroceria e cores:** respeite `no_auction`, `no_armored`, `body_types` (vazio = qualquer) e
  `avoid_colors` de `data/filtro.json` — não traga anúncio que a página mostre como de leilão, blindado, de carroceria
  fora da lista ou de cor evitada.
- **Tipo de vendedor:** no WebMotors, pessoa física aparece com um só nome (ex.: "Maximiliano") e sem o link
  "Ver todos os carros deste vendedor" (/loja/); escreva `Vendedor: <nome> (Pessoa Física)`. Loja/concessionária tem
  esse link; escreva `Vendedor: <nome> (Loja)`. Se `seller_types` não incluir "particular", não traga anúncio cuja
  página mostre pessoa física.
- **Anúncio visto só no cartão da listagem (página não abriu):** pode entrar, desde que o cartão atenda aos critérios
  de preço, ano, km, câmbio e região. Transcreva só o que o cartão mostra, com `Vendedor: (não verificado)` e a linha
  `Origem: cartão da listagem (página do anúncio não abriu)`; FIPE pela Tabela Fipe da versão/ano. O app deixa o
  anúncio pendente com "vendedor a verificar" e o usuário confirma com um toque.
- **FIPE:** prefira sempre o valor da página do anúncio; a Tabela Fipe da versão/ano é só o plano B.

## 3. Onde procurar

### Primeiro: versões-alvo (data/versoes-alvo.json) — preferencial

Listagens amplas (cidade, marca, modelo sem versão) vêm cheias de carros fora do preço e são cortadas pelo WebFetch
(~39 mil caracteres); o resto chega só como resumo, que **não** pode ser transcrito. Por isso a pesquisa começa pelas
listagens **por versão** de `data/versoes-alvo.json`, que são curtas e trazem só versões que cabem no preço e têm (ou
podem ter) indução e Android Auto sem fio.

1. **Quais abrir:** nível `A` em toda pesquisa; `B` só na pesquisa das 13h; `C` só na das 13h de segunda-feira (ou se
   sobrar limite). Pule o que estiver em `exclusions`. Dentro do nível, abra primeiro as de maior `rendeu`.
2. **Só URLs vindas do WebSearch.** As URLs do arquivo vieram de resultados de busca. URL montada à mão costuma ser
   recusada pelo WebFetch (erro de permissão). Para uma versão nova, ache a listagem com WebSearch
   (`allowed_domains: ["webmotors.com.br"]`, ex.: "webmotors Fiat Pulse impetus cvt usado São Paulo") e só então a
   acrescente ao arquivo. Se uma URL do arquivo falhar, procure de novo pela busca e troque-a.
3. **Limite:** cerca de 40 páginas de anúncio no total; reserve ~30 para o nível A.
4. **Ao terminar, atualize o arquivo** (vai no mesmo commit de `data/`): em cada alvo aberto grave
   `ultima_verificacao` (data) e `ultimo_resultado` (curto: "2 anúncios", "nenhum no filtro", "não abriu"); some em
   `rendeu` os anúncios novos que entraram no feed. Rebaixe para `B` um alvo `A` com 4 verificações seguidas sem nada
   no filtro, e para `C` um `B` na mesma situação; promova para `A` um alvo que render anúncio. Versão com ficha que
   mostre indução **ausente** sai da lista (ex.: Kicks Active).
5. Depois das versões-alvo, se sobrar limite, use a busca filtrada e a busca por modelo abaixo para cobrir o que não
   está na lista, e acrescente ao arquivo as versões que renderem.

### Depois: busca filtrada e por modelo (cobertura ampla)

**A busca filtrada do WebMotors.** O WebMotors permite filtrar numa busca só por: cidade
(`ref_location`) com raio de alcance, preço, ano, km, câmbio (Automática, CVT), anunciante (Loja, Concessionária —
conforme `seller_types`), "Leilão: sem passagem por leilão" (se `no_auction`), blindagem (se `no_armored`) e opcionais.
Procure com WebSearch a página de listagem do WebMotors para a cidade de referência (ex.: "webmotors carros usados
Barueri SP") e abra as páginas de resultado; prefira esta lista à busca modelo a modelo, porque ela mostra todos os
anúncios da região que passam nos filtros. Use raio de ~50 km em linha reta (≈ `max_distance_km` por estrada).
Abra os anúncios priorizando: selo "Abaixo da Fipe", menor km, carroceria em `body_types` (se houver) e modelos que não
estejam em `exclusions`. Se a busca filtrada não estiver acessível, use a busca por modelo abaixo.


O WebMotors não filtra por ADAS, carregador por indução nem Android Auto sem fio. Por isso a busca é **por modelo**,
cobrindo todos os compactos e médios que podem caber no preço — não só os que já têm ficha.

Modelos a verificar em toda pesquisa (versões mais equipadas de cada um; pule o que estiver em `exclusions`):

| Marca | Modelos |
|---|---|
| Chevrolet | Onix, Onix Plus, Tracker, Montana |
| Volkswagen | Polo, Virtus, T-Cross, Nivus, Tera |
| Fiat | Argo, Cronos, Pulse, Fastback |
| Hyundai | HB20, HB20S, Creta |
| Renault | Kardian, Duster |
| Jeep | Renegade, Compass |
| Nissan | Kicks, Versa |
| Honda | City, City Hatchback, WR-V, HR-V |
| Toyota | Yaris, Yaris Sedan, Corolla Cross |
| Peugeot / Citroën | 208, 2008 / C3, Basalt, C3 Aircross |
| Caoa Chery / BYD / GWM | Tiggo 5x / Dolphin Mini, Dolphin / Ora 03 |

Obrigatórios: carregador por indução e Android Auto sem fio (Apple CarPlay sem fio não basta). ADAS é **desejável**:
versões sem ADAS também entram, desde que tenham os dois itens obrigatórios. Anúncios com selo "Abaixo da Fipe" ou
preço abaixo do valor FIPE exibido são oportunidades — priorize abri-los.

Para cada modelo:
1. Busque a página de listagem do WebMotors em SP (WebSearch, ex.: "webmotors Volkswagen Virtus Exclusive automático
   usado São Paulo"; use também páginas por ano, ex. `/de.2023/ate.2023`). Se `conditions` incluir `novo`, procure
   também carros 0 km.
2. Abra a listagem e filtre pelos critérios (preço, ano-modelo, km, câmbio). Região: cidades a até
   `max_distance_km` por estrada de `ref_location` (Grande São Paulo; na dúvida, inclua — o app calcula a rota).
3. Abra os anúncios candidatos (priorize os mais baratos e com menos km) e os links de `favorites`/`urls`.
4. Distribua o limite de ~40 anúncios entre os modelos; anote no `--note` os modelos que ficaram sem verificação.

### Fichas de versões novas (data/fichas.json) — obrigatório em toda pesquisa

Antes de publicar, rode `node tools/missing-fichas.mjs` (depois do merge-feed). Ele lista cada versão/ano-modelo do
feed sem ficha. **Pesquise a ficha de cada linha listada** (catálogo da montadora; senão imprensa especializada) e
acrescente em `data/fichas.json`. Se não achar fonte para algum item, deixe o item fora (fica pendente no app) e cite a
versão/ano no `--note` como "ficha sem fonte para <item>".

O app só confirma itens que o anúncio não cita quando existe ficha da **mesma versão e ano-modelo**. Ao encontrar
versão/ano sem ficha (veja `core/specs.js` e `data/fichas.json`), pesquise a ficha (de preferência catálogo da
montadora; senão imprensa especializada) e acrescente em `data/fichas.json` um objeto no mesmo formato de
`SEED_SPECS` (id, make, model, version_includes, version_excludes, year_from, year_to, items com
state "confirmado" | "opcional" | "ausente" e trecho citado em `quote`, nomes do ADAS em `names`, `source` com
title, url e quality "oficial" | "concessionária" | "secundária"; `tech` opcional com potência, torque, consumo,
porta-malas, tanque). **Nunca preencha item sem fonte**: o que a fonte não disser fica fora de `items`.
Item que é opcional/pacote na versão = "opcional".

## 4. Formato de cada anúncio (texto que o app analisa)

Pergunte ao WebFetch pelos dados **copiados literalmente** e monte:

```
<TÍTULO DA PÁGINA>
Preço: R$ <valor>
Ano: <fab>/<modelo>
KM: <km>
Câmbio: <câmbio>
Cidade: <Cidade> - <UF>
Vendedor: <nome do vendedor, com "(Pessoa Física)" quando a página indicar>
FIPE: R$ <valor> (<fonte>, <mês de referência>)   ← OBRIGATÓRIO em todo anúncio apresentado
Selo: Abaixo da Fipe   (só se a página/listagem mostrar esse selo)
Carroceria: <Hatchback | Sedã | SUV | Picape>   (como na página)
Cor: <cor>
Final de placa: <dígito>
Leilão: <Sim | Não>        (só se a página informar; "sem passagem por leilão" = Não)
Blindado: <Sim | Não>      (só se a página informar)
Características: <lista como na página, separada por ; — ex.: Único dono; IPVA pago; Licenciado; Todas as revisões feitas pela concessionária; Garantia de fábrica>
WhatsApp: Sim              (só se o anúncio oferecer contato por WhatsApp)
Itens de veículo: <lista separada por ; exatamente como na página>
<trechos da descrição do vendedor que citem equipamentos, se houver>
```

**FIPE é obrigatória.** Use o valor FIPE exibido na página do anúncio; se a página não mostrar, pesquise a Tabela
FIPE da mesma versão e ano-modelo (página "Tabela Fipe" do WebMotors para a versão/ano, ou veiculos.fipe.org.br) e
informe a fonte e o mês de referência, ex.: `FIPE: R$ 95.988 (Tabela Fipe no WebMotors, out/2026)`. Se não for
possível achar a FIPE da versão exata, escreva `FIPE: não encontrada` — nunca estime.

Grave um arquivo JSON (fora do repositório, ex.: no diretório temporário) com
`[{ "url": "...", "text": "...", "available": true }]` e, para anúncios que saíram do ar,
`{ "url": "...", "available": false }`.

## 5. Publicar

```bash
node tools/merge-feed.mjs /caminho/novos.json --issue <número> --note "<resumo curto>"
git add data && git commit -m "Pesquisa atualizada (issue #<número>)"
git pull --rebase origin main && git push origin main   # o app pode ter gravado data/filtro.json no meio tempo
```

Se houver mais de um pedido pendente, passe todos: `--issue 7,6`. O app importa o resultado sozinho na próxima abertura ou ao puxar a lista para baixo. O `merge-feed` grava em
`status.json` o `filter_used_at` (o `updated_at` de `data/filtro.json`), e o app mostra se a pesquisa usou o filtro atual.
