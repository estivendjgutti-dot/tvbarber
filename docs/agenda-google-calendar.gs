/**
 * Ponte Google Agenda -> TV da recepção.
 * Publica como Web App e devolve SÓ os atendimentos de hoje, em JSON:
 *   [{ "time": "14:00", "client": "Carlos S.", "service": "Manutenção", "duration": 60 }]
 *
 * COMO O LEANDRO MARCA NA AGENDA (Google Agenda normal):
 *   Título:    Nome do cliente - Serviço     (ex.: "Carlos Silva - Manutenção")
 *   ou Título = nome, e a 1ª linha da descrição = serviço.
 *   Eventos "dia inteiro" são ignorados.
 *
 * INSTALAÇÃO (5 min, pelo celular ou PC):
 *  1. script.google.com > Novo projeto > cole este arquivo.
 *  2. Engrenagem > Propriedades do script > adicione:
 *       TOKEN       = uma senha longa aleatória (ex.: 32 letras/números)
 *       CALENDAR_ID = e-mail da agenda (ex.: leandro@gmail.com) — vazio = agenda principal
 *       PRIVACY     = first | initials | full   (padrão: first -> "Carlos S.")
 *  3. Implantar > Nova implantação > App da Web
 *       Executar como: Eu  |  Quem tem acesso: Qualquer pessoa
 *  4. Copie a URL e coloque em playlist.json:
 *       "agendaUrl": "https://script.google.com/macros/s/XXXX/exec?token=SUA_SENHA"
 *  Obs.: o nome é encurtado AQUI, antes de sair do Google (LGPD).
 */
function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token || !e || !e.parameter || e.parameter.token !== token) {
    return json_({ error: 'unauthorized' });
  }

  var tz = 'America/Sao_Paulo';
  var calId = props.getProperty('CALENDAR_ID');
  var cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
  if (!cal) return json_({ error: 'calendar_not_found' });

  var mode = props.getProperty('PRIVACY') || 'first';
  var now = new Date();
  var start = new Date(Utilities.formatDate(now, tz, "yyyy/MM/dd") + ' 00:00:00');
  var end = new Date(start.getTime() + 24 * 3600 * 1000);

  var out = cal.getEvents(start, end)
    .filter(function (ev) { return !ev.isAllDayEvent(); })
    .map(function (ev) {
      var title = ev.getTitle().trim();
      var m = title.split(/\s+[-–—]\s+/);
      var client = m[0];
      var service = m.length > 1 ? m.slice(1).join(' - ') : (ev.getDescription() || '').split('\n')[0].trim();
      return {
        time: Utilities.formatDate(ev.getStartTime(), tz, 'HH:mm'),
        client: mask_(client, mode),
        service: service,
        duration: Math.round((ev.getEndTime() - ev.getStartTime()) / 60000)
      };
    })
    .sort(function (a, b) { return a.time < b.time ? -1 : 1; });

  return json_(out);
}

function mask_(full, mode) {
  var p = String(full).trim().split(/\s+/).filter(Boolean);
  if (mode === 'full' || p.length === 0) return p.join(' ');
  if (mode === 'initials') return p.map(function (x) { return x[0].toUpperCase(); }).join('.') + '.';
  return p[0] + (p[1] ? ' ' + p[1][0].toUpperCase() + '.' : '');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
