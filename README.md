# CarMonitor — versão Android (app instalável, dados só no celular)

App web instalável (PWA) que roda inteiro no celular: sem servidor, sem conta, sem custo.
Os dados ficam no próprio aparelho (IndexedDB); faça cópias em **Ajustes → Dados e rotas → Exportar cópia**.

## Como colocar no celular

O Android só instala um app web servido por **https**. A opção gratuita mais simples é o GitHub Pages:

1. Crie um repositório (ex.: `carmonitor`) no GitHub e envie o **conteúdo desta pasta** para ele.
2. No repositório: **Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save**.
3. Em 1–2 minutos o app fica em `https://SEU-USUARIO.github.io/carmonitor/`.
4. Abra esse endereço no **Chrome do Android** → menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").

Qualquer outra hospedagem estática com https serve (Netlify, Cloudflare Pages etc.).
Para testar no computador: `python -m http.server 8000` nesta pasta e abra http://localhost:8000.

## Uso no dia a dia

- No app ou site do WebMotors, abra um anúncio → **Compartilhar → CarMonitor**. O link chega preenchido.
- Recomendado: no anúncio, **selecionar tudo → copiar** e tocar em **Colar da área de transferência** — o app lê preço,
  ano, km, câmbio, cidade e os itens escritos no anúncio.
- Ao abrir o app (no máximo a cada 12 h, ajustável) a **rotina** recalcula rotas pendentes, reclassifica e lista o que
  precisa ser reconferido. Em cada anúncio, **Reconferir** registra preço/km/situação no histórico e gera alertas.

## Regras de validação

- Aprovado só com todos os critérios comprovados; dado ausente, não verificado ou **conflitante entre fontes** ⇒ Pendente;
  violação ⇒ Descartado.
- Equipamento comprovado pelo **texto do anúncio**, por **validação sua** (exige fonte e evidência) ou pela
  **ficha da mesma versão e ano-modelo** (sempre com fonte e marcado como "pela ficha"). Ficha de outra versão ou de
  outro ano nunca vale; item opcional na ficha fica pendente; se o anúncio negar e a ficha afirmar, fica pendente.
  Dá para desligar o uso de fichas ou aceitar só fontes oficiais em **Ajustes → Critérios**.
- **Modelos ignorados** (Ajustes ou "Ignorar este modelo" no anúncio) vão para Descartados e não geram alertas.
- Distância por estrada calculada no celular (OSRM/OpenStreetMap ou OpenRouteService com sua chave); sem dados ⇒
  "não verificada", nunca linha reta.

Fichas incluídas (pesquisadas em 27/10/2026): Renault Kardian Première Edition 2025 (catálogo oficial), Fiat Pulse
Impetus 2022 (lista de série), Hyundai HB20 Platinum Plus 2024, Chevrolet Onix Premier 2025 e Onix Plus Premier 2025
(fontes secundárias). Novas fichas podem ser cadastradas em **Ajustes → Fichas** (com link da fonte).

## Limitações

- O app **não acessa o WebMotors sozinho** (os Termos de Uso proíbem raspagem por terceiros): anúncios entram por
  Compartilhar/colar, e preço e disponibilidade se atualizam quando você reconfere.
- Sem servidor, não há alertas com o app fechado; a rotina roda ao abrir. Notificações do Android aparecem enquanto o
  app está aberto ou em segundo plano recente, se ativadas em Ajustes → Alertas.
- O servidor público do OSRM/Nominatim é para uso leve; para muitas rotas configure uma chave gratuita do OpenRouteService.
- Os dados ficam só neste aparelho: trocar de celular ou limpar os dados do Chrome apaga tudo — exporte cópias.

## Testes

`npm test` (Node 18+): 18 testes das regras (equipamentos, classificação, fichas, modelos ignorados, conflitos,
duplicatas, extração, reconferência, rotina).
