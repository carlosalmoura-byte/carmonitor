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

### Pedido perto da pesquisa agendada

Se a verificação de pedidos cair entre 5:30 e 5:59 ou entre 12:30 e 12:59 (horário de Brasília), **não pesquise**:
a pesquisa agendada começa às 5:46/12:46 e já usa o filtro atual.

## 2. Regras (obrigatórias)

- Os Termos de Uso da Webmotors proíbem raspagem automatizada. A pesquisa acontece **somente quando há pedido ou no horário agendado pelo usuário (6h e 13h)** e
  é feita página a página como uma consulta humana: **WebSearch** (com `allowed_domains: ["webmotors.com.br"]`)
  para achar páginas de listagem, **WebFetch** dessas páginas e dos anúncios que aparecem nelas. Nada de curl,
  scripts ou contornar bloqueios no webmotors.com.br. URL recusada = siga em frente.
- **Não invente nada.** Transcreva apenas o que a página mostrou. O que não constar fica fora do texto.
- Só marque `available: false` quando a página do anúncio indicar claramente que foi vendido/removido. Se a página
  não puder ser aberta, **não** marque nada (deixe como estava).
- Limite: cerca de 40 páginas de anúncio por pedido.

## 3. Onde procurar (cobertura ampla)

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

### Fichas de versões novas (data/fichas.json)

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
