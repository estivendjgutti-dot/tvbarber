# TV Clínica (tvbarber): contexto para o Claude Code

Digital signage para TV de recepção da clínica **Leandro Sales Prótese Capilar** (São José dos Campos-SP).
Dono do projeto: Gutti (Estiven4tech). Responder em português, direto e técnico.

## Arquitetura
- `app/` Android (Kotlin, minSdk 29): `MainActivity` = WebView fullscreen + launcher HOME + kiosk (lock task, só com Device Owner) + recuperação de crash do renderer. `JsBridge` = `window.Android` (deviceInfo, openSettings, exitKiosk, launchApp...), recusa chamadas se a origem não for autorizada.
- `app/src/main/assets/web/` **player HTML/JS** (90% do trabalho): `playlist.json` (conteúdo), `player.js`, `style.css`, `media/`.
- `docs/agenda-google-calendar.gs` Apps Script que expõe a agenda de hoje do Google Agenda em JSON (nomes encurtados, LGPD). URL vai em `agendaUrl`.
- `.github/workflows/build.yml` compila o APK a cada push na `main` e publica em Releases (`build-N`).

## Fluxo
Editar `assets/web/` -> testar no navegador (`python3 -m http.server` na pasta web; ← → trocam slide; ↑↑↓↓ painel técnico) -> push -> baixar APK em Releases.
O app **não compila em ambiente sem acesso ao Google/Maven**; o build de verdade é o do GitHub Actions.

## Pendências
1. **Imagens**: as 8 geradas (Gemini via Figma, arquivo `7uikGniFSTIjhwTGT1H6PG`) precisam ser exportadas e salvas em `assets/web/media/` com os nomes: `antes-1`, `depois-1`, `produto-1`, `produto-2`, `ambiente`, `patrocinador-1`, `patrocinador-2`, `fundo-agenda` (.png). Hoje são placeholders "(trocar)". Links do Figma expiram em 7 dias.
2. **Logo**: hoje vem de `https://leandrosales.netlify.app/assets/logo-mark.jpg` (só online). Baixar para `media/`.
3. **Assinatura fixa** do APK (secrets KEYSTORE_BASE64/KEYSTORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD, ver README). Sem isso cada build tem chave diferente.
4. **Agenda real**: instalar o Apps Script e preencher `agendaUrl`.
5. Produtos/preços no playlist são **exemplos** (o site da clínica não lista produtos): confirmar com o Leandro.
6. **Teste em aparelho real** (S10+ via HDMI, depois box Android 10/11): autostart como Home, D-pad, HDMI-CEC, RAM baixa.
7. Slides só de texto estão fracos visualmente (usar foto de fundo / QR do WhatsApp).

## Regras do produto
- Antes/depois: só com autorização escrita do cliente (LGPD). Imagens atuais são ilustrativas/IA.
- Agenda na TV: nome encurtado por padrão (`agendaPrivacy`: first | initials | full).
- Patrocinadores: `from`/`until` = contrato; relatório de exibições no painel técnico (`statsUrl` opcional).
- Box alvo: Android TV box genérico (Aquário STV-3000 / SmartPro) ou Xiaomi TV Box S. Evitar Fire TV com Vega OS (não roda APK).
