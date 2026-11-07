# TV Clínica (tvbarber): contexto para o Claude Code

Digital signage para TV de recepção da clínica **Leandro Sales Prótese Capilar** (São José dos Campos-SP).
Dono do projeto: Gutti (Estiven4tech). Responder em português, direto e técnico.

## Arquitetura
- `app/` Android (Kotlin, minSdk 29): `MainActivity` = WebView fullscreen + launcher HOME + kiosk (lock task, só com Device Owner) + recuperação de crash do renderer. `JsBridge` = `window.Android` (deviceInfo, openSettings, exitKiosk, launchApp...), recusa chamadas se a origem não for autorizada.
- `app/src/main/assets/web/` **player HTML/JS** (90% do trabalho): `playlist.json` (conteúdo), `player.js`, `style.css`, `media/`.
- `docs/agenda-google-calendar.gs` Apps Script que expõe a agenda de hoje do Google Agenda em JSON (nomes encurtados, LGPD). URL vai em `agendaUrl`.
- `.github/workflows/build.yml` compila o APK a cada push na `main` (ignora mudanças só de web/painel/docs) e publica em Releases (`build-N`).
- `.github/workflows/pages.yml` publica player + `painel/` no GitHub Pages (`https://estivendjgutti-dot.github.io/tvbarber/`) a cada push em web/painel/tools e a cada 30 min, gerando `news.json` com `tools/build_news.py` (RSS g1 Vale, ge futebol, g1; os feeds não têm CORS, por isso o servidor monta o JSON). `news.json` é gerado, está no `.gitignore`.
- `painel/index.html` editor de conteúdo (celular): lê/grava `playlist.json` pela API do GitHub com token fine-grained do dono (Contents: read/write só no tvbarber, guardado no localStorage do aparelho dele). Fotos enviadas vão para `web/media/uploads/`.
- APK com `vars.START_URL` = URL do Pages carrega o player de lá (fallback: assets locais). Assim conteúdo e código web mudam sem APK novo; `version` no playlist mudou -> a TV recarrega a página.

## Tipos de slide (playlist.json)
`promo`, `image`, `beforeAfter`, `product` (com `hero` = foto larga 16:9 com o produto à esquerda e terço direito vazio + `benefits[]`), `newsPortal` (`feed`: local | esportes | brasil | all, aceita vírgula), `agenda`, `news`. Patrocinado "rico" (`sponsors[]` com `logo`/`headline`): `logoText`, `benefits`, `cta`, `contact`, `qr`, `image` + `visualStyle` (photo | screen | tv), `color`. Prévia de um item: `?slide=N` ou `?sponsor=id`.

## Fluxo
Conteúdo: painel (`/tvbarber/painel/`) -> Salvar -> Pages publica -> TV atualiza em até ~10 min.
Código web: editar `assets/web/` -> testar no navegador (`python -m http.server` na pasta web; ← → trocam slide; ↑↑↓↓ painel técnico) -> push -> Pages.
Kotlin: push -> baixar APK em Releases. O app **não compila em ambiente sem acesso ao Google/Maven**; o build de verdade é o do GitHub Actions.

## Pendências
1. **Imagens**: as 8 geradas (Gemini via Figma, arquivo `7uikGniFSTIjhwTGT1H6PG`) já estão em `assets/web/media/` como `.jpg` (`antes-1`, `depois-1`, `produto-1`, `produto-2`, `ambiente`, `patrocinador-1`, `patrocinador-2`, `fundo-agenda`). `antes-1`/`depois-1` são o antes/depois da mesma pessoa (confirmado pelo dono); continuam sendo imagens de IA, trocar por fotos reais só com autorização escrita.
2. ~~Logo~~ feito: `media/logo.png` (circular, fundo transparente, 256px), usado em `brand.logo`. Funciona offline.
3. **Assinatura fixa** do APK (secrets KEYSTORE_BASE64/KEYSTORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD, ver README). Sem isso cada build tem chave diferente.
4. **Agenda real**: instalar o Apps Script e preencher `agendaUrl`.
5. Produtos/preços/benefícios no playlist são **exemplos** (o site da clínica não lista produtos): confirmar com o Leandro. Fotos `produto-*-beneficio.jpg` geradas no Gemini (Figma, nós 6:2 e 6:3).
6. **Teste em aparelho real** (S10+ via HDMI, depois box Android 10/11): autostart como Home, D-pad, HDMI-CEC, RAM baixa. No S10 com DeX o autostart (HOME) precisa ficar DESLIGADO: a Samsung bloqueia app de tela inicial no DeX, sem contorno.
7. Slides só de texto estão fracos visualmente (usar foto de fundo / QR do WhatsApp).
8. **Patrocinados próprios** (Estiven4Tech sites, CRM4Tech, Med4Tech, Estiven4TV) em `media/sponsors/`: logos reais da Estiven4Tech e do CRM4Tech (de `C:\Clientes\crm4tech-site`); marcas do Med4Tech e Estiven4TV são SVG provisórios. Med4Tech está como "em breve" (produto ainda não lançado). QR = wa.me com mensagem pronta.
9. **Ativar Pages + START_URL**: Settings › Pages › Source = GitHub Actions; variável `START_URL` = `https://estivendjgutti-dot.github.io/tvbarber/` e gerar APK (workflow_dispatch). Workflow agendado é desligado pelo GitHub após 60 dias sem atividade no repositório.
10. Portal de notícias usa só título, linha fina e foto do RSS com a fonte; não há placar estruturado no RSS do ge.

## Regras do produto
- Antes/depois: só com autorização escrita do cliente (LGPD). Imagens atuais são ilustrativas/IA.
- Agenda na TV: nome encurtado por padrão (`agendaPrivacy`: first | initials | full).
- Patrocinadores: `from`/`until` = contrato; relatório de exibições no painel técnico (`statsUrl` opcional).
- Box alvo: Android TV box genérico (Aquário STV-3000 / SmartPro) ou Xiaomi TV Box S. Evitar Fire TV com Vega OS (não roda APK).
