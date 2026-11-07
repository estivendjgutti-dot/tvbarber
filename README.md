# TV Clínica: digital signage para Android TV box

App Android que transforma qualquer TV com HDMI + box Android em uma TV de recepção:
antes/depois, produtos à venda, notícias em ticker e **espaços patrocinados com relatório de exibição**.

```
app/src/main/
├── java/.../MainActivity.kt   # WebView em tela cheia, launcher (abre no boot), kiosk, recuperação de crash
├── java/.../JsBridge.kt       # window.Android: deviceInfo, openSettings, exitKiosk, launchApp...
└── assets/web/                # O PLAYER (HTML/JS) — 90% do trabalho fica aqui
    ├── playlist.json          # conteúdo da TV
    ├── player.js / style.css / index.html
    └── media/                 # imagens (placeholders .svg — trocar pelas reais)
```

## Fluxo de desenvolvimento no S10+ (sem PC)

1. **Editar** a pasta `app/src/main/assets/web/` no Acode (ou qualquer editor).
2. **Testar no navegador**: no Termux, `cd app/src/main/assets/web && python -m http.server 8080`
   e abra `http://localhost:8080` no Chrome. Setas ← → trocam slide; ↑ ↑ ↓ ↓ abre o painel técnico.
3. **Gerar o APK**: commit + push pra `main` → GitHub Actions compila → baixe em *Releases*.
4. **Testar na TV**: S10+ no cabo HDMI (DeX desligado, modo espelho), instale o APK,
   escolha "TV Launcher" como app **Início padrão**. Navegação com teclado/gamepad Bluetooth.

## Conteúdo (`playlist.json`)

| Tipo | Campos |
|---|---|
| `beforeAfter` | `before`, `after`, `title`, `text` |
| `product` | `image`, `tag`, `title`, `text`, `price`, `priceNote`, `cta`, `qr` (imagem do QR) |
| `image` / vídeo | `image` (aceita `.mp4`/`.webm`), `title`, `text` |
| `news` | `source`, `title`, `text` |
| `promo` | `title`, `text`, `background` |

Todos aceitam `duration` (s), `enabled`, `from`/`until` (AAAA-MM-DD).

**Patrocinadores** ficam em `sponsors[]` e entram automaticamente a cada `sponsorEvery` slides,
em rodízio justo. `from`/`until` = período do contrato (sai do ar sozinho no vencimento).
Cada exibição é contada (vezes + minutos) → painel técnico › *Relatório de patrocinadores*.
Com `statsUrl` configurado, as exibições são enviadas por POST a cada 5 min (prova de exibição p/ cobrar).

## Agenda via Google Agenda

`docs/agenda-google-calendar.gs` é um Apps Script que lê a agenda do Leandro e entrega só os atendimentos de hoje
(nome já encurtado) em JSON. Instalação no próprio arquivo; depois é só colocar a URL em `agendaUrl`.
A TV atualiza a cada 2 min e guarda cache se ficar sem internet. Título do evento: `Nome - Serviço`.

## Atualizar conteúdo sem reinstalar (OTA)

Hospede um `playlist.json` (Vercel, GitHub Pages, Supabase Storage…) com CORS liberado e coloque a URL em
`remotePlaylistUrl`. A TV busca a cada `refreshMinutes`, guarda a última versão boa e **continua rodando offline**.
Imagens podem ser URLs `https://` absolutas.

Notícias: `news[]` fixo e/ou `newsUrl` apontando para um JSON `[{"title": "...", "source": "..."}]`.

## Assinatura (necessária pra atualizar o app por cima)

No Termux (`pkg install openjdk-17`):
```
keytool -genkeypair -v -keystore release.jks -alias tv -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks > release.b64
```
GitHub › Settings › Secrets › Actions: `KEYSTORE_BASE64` (conteúdo do .b64), `KEYSTORE_PASSWORD`,
`KEY_ALIAS` (=tv), `KEY_PASSWORD`. **Guarde o .jks fora do repositório** — perdeu, não atualiza mais.

## Instalação no box

1. Instale o APK e defina como app Início padrão (Configurações › Apps › Apps padrão › Início).
   Isso dá o autostart no boot. Em box/Android TV o papel de Início liga sozinho; no celular ele vem
   desligado (o Samsung DeX não abre apps de tela inicial) e liga pelo painel técnico › *Autostart*.
2. **Kiosk total (opcional)**: box resetado, sem conta Google, depuração USB/ADB ligada:
   `adb shell dpm set-device-owner com.estiven4tech.tvlauncher/.AdminReceiver`
   Para sair: painel técnico › *Sair do modo kiosk*.
3. Na TV: ative o HDMI-CEC (na Philco costuma se chamar "Anynet/CEC/HDMI Control") pra TV ligar junto com o box.

## Cuidados

- **Antes/depois**: só com **autorização de uso de imagem por escrito** de cada cliente (LGPD + direito de imagem).
- **Notícias**: use fontes com RSS/API que permitam exibição, sempre com o nome da fonte.
- Box barato tem pouca RAM: prefira JPG/WebP ≤ 1920px e vídeos 720p.

## Próximos passos

- Painel web pra clínica trocar fotos/preços sem mexer em JSON.
- Endpoint `statsUrl` + relatório mensal em PDF por patrocinador (produto vendável).
- Função serverless `newsUrl` (RSS → JSON) com notícias de saúde, estética e da cidade.
- Multi-tela: `screenId` por TV/clínica, uma playlist por cliente.
