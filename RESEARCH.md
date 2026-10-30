# Procedimento: atualizar a pesquisa de anúncios (executado pelo Claude a pedido)

Este repositório publica o app CarMonitor (GitHub Pages). O app lê `data/anuncios.json` e `data/status.json`.
O usuário pede uma nova pesquisa pelo botão **Atualizar pesquisa** do app, que abre uma *issue* neste repositório
com o título começando por `Atualizar pesquisa` e um bloco JSON com os critérios. Este documento descreve como
atender esse pedido.

## 1. Existe pedido pendente?

```bash
curl -s "https://api.github.com/repos/carlosalmoura-byte/carmonitor/issues?state=open&per_page=20"
```

Pedido pendente = issue aberta cujo título começa com `Atualizar pesquisa` e cujo número **não** está em
`processed_issues` de `data/status.json`. Se não houver pedido pendente, **pare aqui sem fazer nada**
(não pesquise o WebMotors sem pedido). Se houver vários, atenda só o mais recente e registre todos como processados.

O corpo da issue tem um bloco ```json com:
`criteria` (min_price, max_price, year_min, year_max, min_km, max_km, transmissions, conditions, seller_types,
ref_location, max_distance_km), `exclusions` (modelos ignorados), `urls` (anúncios que já estão no app) e
`favorites` (links favoritos — dê prioridade a reconferi-los).

### Modo agendado (6h e 13h)

As execuções agendadas das 6h e 13h (horário de Brasília) pesquisam **mesmo sem pedido pendente**, a pedido do
usuário. Critérios: use o bloco JSON da issue "Atualizar pesquisa" **mais recente** (aberta ou fechada, processada
ou não). Se não existir nenhuma, use: preço até R$ 100.000; ano-modelo 2022–2025; até 35.000 km; câmbio automático;
usados/seminovos; particular, loja e concessionária; Barueri, SP, até 60 km por estrada. Registre também como
processados os pedidos pendentes que existirem (`--issue N,M`) e use `--note "pesquisa agendada"`.

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
Itens de veículo: <lista separada por ; exatamente como na página>
<trechos da descrição do vendedor que citem equipamentos, se houver>
```

Grave um arquivo JSON (fora do repositório, ex.: no diretório temporário) com
`[{ "url": "...", "text": "...", "available": true }]` e, para anúncios que saíram do ar,
`{ "url": "...", "available": false }`.

## 5. Publicar

```bash
node tools/merge-feed.mjs /caminho/novos.json --issue <número> --note "<resumo curto>"
git fetch origin main && git rebase origin/main
git add data && git commit -m "Pesquisa atualizada a pedido (issue #<número>)" && git push origin main
```

Se houver mais de um pedido pendente, passe todos: `--issue 7,6`. O app importa o resultado sozinho na próxima abertura ou ao puxar a lista para baixo.
