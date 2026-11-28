// UI strings: pt-BR, es and en-US (default).

const en = {
  errApiKey: 'omnium-enhanced-map-card: set `api_key` (Google Maps JavaScript API).',
  errEntities: 'omnium-enhanced-map-card: set `entities` (e.g. person.you).',
  errAuth: 'Google Maps rejected the key. Check `api_key`, billing and the referrer restrictions.',
  errHistory: (msg: string) => `Could not read history: ${msg}`,
  errMapsDownload: 'Could not download Google Maps.',
  actionFailed: (action: string, msg: string) => `${action} failed: ${msg}`,

  people: 'People',
  all: 'All',
  period: 'Period',
  tuningTitle: 'Track settings',
  showStops: 'Show stops',
  hideStops: 'Hide stops (full map)',
  loading: 'Loading history…',
  moving: 'On the move',
  now: 'now',
  noData: 'No data in this period',
  stop: 'Stop',
  stoppedSince: (time: string) => `Stopped since ${time}`,

  mapSection: 'Map',
  stopRadius: 'Stop radius',
  stopRadiusHint: 'Movements smaller than this count as "same place".',
  accuracyFilter: 'Accuracy filter',
  accuracyFilterHint: 'Points with a larger error are only used if they fit the route; above 4× this they are always ignored.',
  minStop: 'Minimum stop time',
  minStopHint: 'Staying still for less than this is not a stop.',
  resetYaml: 'Restore YAML defaults',

  gpsButton: (name: string) => `High-accuracy GPS (${name})`,
  buttonOn: (label: string) => `${label}: on (tap to turn off)`,
  buttonOff: (label: string) => `${label}: off (tap to turn on)`,
  buttonUnknown: (label: string) => `${label}: unknown state (tap to turn on)`,

  phoneSection: (name: string) => `${name}'s phone`,
  phoneInterval: 'High-accuracy interval',
  phonePending: (known: string) => `(sent; the phone still reports ${known} s)`,
  phoneHint: 'Lower = more detailed track, more battery. Only applies while high accuracy is on.',
  phoneMinAccuracy:
    'The app’s minimum accuracy cannot be changed remotely: set it on the phone under Manage sensors → Background location.',
  phoneSending: 'Sending…',
  phoneSent: (sec: number) => `Sent ${sec} s to the phone.`,
  phoneFailed: (msg: string) => `Failed: ${msg}`,
};

export type Strings = typeof en;

const pt: Strings = {
  errApiKey: 'omnium-enhanced-map-card: defina `api_key` (Google Maps JavaScript API).',
  errEntities: 'omnium-enhanced-map-card: defina `entities` (ex.: person.voce).',
  errAuth: 'Chave do Google Maps recusada. Confira a `api_key`, a cobrança e as restrições de referrer.',
  errHistory: (msg) => `Erro ao ler o histórico: ${msg}`,
  errMapsDownload: 'Não foi possível baixar o Google Maps.',
  actionFailed: (action, msg) => `Falha em ${action}: ${msg}`,

  people: 'Pessoas',
  all: 'Todos',
  period: 'Período',
  tuningTitle: 'Ajustes do trajeto',
  showStops: 'Mostrar paradas',
  hideStops: 'Esconder paradas (mapa inteiro)',
  loading: 'Carregando histórico…',
  moving: 'Em deslocamento',
  now: 'agora',
  noData: 'Sem dados neste período',
  stop: 'Parada',
  stoppedSince: (time) => `Parado desde ${time}`,

  mapSection: 'Mapa',
  stopRadius: 'Raio de parada',
  stopRadiusHint: 'Movimentos menores que isso contam como "mesmo lugar".',
  accuracyFilter: 'Filtro de precisão',
  accuracyFilterHint: 'Pontos com erro maior só entram se combinarem com o trajeto; acima de 4× isso são sempre ignorados.',
  minStop: 'Tempo mínimo de parada',
  minStopHint: 'Ficar parado menos que isso não vira parada.',
  resetYaml: 'Restaurar padrão do YAML',

  gpsButton: (name) => `Alta precisão do GPS (${name})`,
  buttonOn: (label) => `${label}: ligado (toque para desligar)`,
  buttonOff: (label) => `${label}: desligado (toque para ligar)`,
  buttonUnknown: (label) => `${label}: estado desconhecido (toque para ligar)`,

  phoneSection: (name) => `Celular de ${name}`,
  phoneInterval: 'Intervalo em alta precisão',
  phonePending: (known) => `(enviado; o celular ainda informa ${known} s)`,
  phoneHint: 'Menor = trajeto mais detalhado, mais bateria. Vale só com a alta precisão ligada.',
  phoneMinAccuracy:
    'A precisão mínima do app não pode ser mudada remotamente: ajuste no celular em Gerenciar sensores → Localização em segundo plano.',
  phoneSending: 'Enviando…',
  phoneSent: (sec) => `Enviado ${sec} s para o celular.`,
  phoneFailed: (msg) => `Falhou: ${msg}`,
};

const es: Strings = {
  errApiKey: 'omnium-enhanced-map-card: define `api_key` (Google Maps JavaScript API).',
  errEntities: 'omnium-enhanced-map-card: define `entities` (p. ej. person.tu).',
  errAuth: 'Google Maps rechazó la clave. Revisa la `api_key`, la facturación y las restricciones de referrer.',
  errHistory: (msg) => `Error al leer el historial: ${msg}`,
  errMapsDownload: 'No se pudo descargar Google Maps.',
  actionFailed: (action, msg) => `Falló ${action}: ${msg}`,

  people: 'Personas',
  all: 'Todos',
  period: 'Período',
  tuningTitle: 'Ajustes del recorrido',
  showStops: 'Mostrar paradas',
  hideStops: 'Ocultar paradas (mapa completo)',
  loading: 'Cargando historial…',
  moving: 'En movimiento',
  now: 'ahora',
  noData: 'Sin datos en este período',
  stop: 'Parada',
  stoppedSince: (time) => `Detenido desde ${time}`,

  mapSection: 'Mapa',
  stopRadius: 'Radio de parada',
  stopRadiusHint: 'Los movimientos menores que esto cuentan como "mismo lugar".',
  accuracyFilter: 'Filtro de precisión',
  accuracyFilterHint: 'Los puntos con más error solo se usan si encajan en el recorrido; por encima de 4× esto siempre se ignoran.',
  minStop: 'Tiempo mínimo de parada',
  minStopHint: 'Quedarse quieto menos que esto no cuenta como parada.',
  resetYaml: 'Restaurar valores del YAML',

  gpsButton: (name) => `GPS de alta precisión (${name})`,
  buttonOn: (label) => `${label}: activado (toca para desactivar)`,
  buttonOff: (label) => `${label}: desactivado (toca para activar)`,
  buttonUnknown: (label) => `${label}: estado desconocido (toca para activar)`,

  phoneSection: (name) => `Teléfono de ${name}`,
  phoneInterval: 'Intervalo en alta precisión',
  phonePending: (known) => `(enviado; el teléfono aún informa ${known} s)`,
  phoneHint: 'Menor = recorrido más detallado, más batería. Solo aplica con la alta precisión activada.',
  phoneMinAccuracy:
    'La precisión mínima de la app no se puede cambiar a distancia: ajústala en el teléfono en Administrar sensores → Ubicación en segundo plano.',
  phoneSending: 'Enviando…',
  phoneSent: (sec) => `Enviado ${sec} s al teléfono.`,
  phoneFailed: (msg) => `Falló: ${msg}`,
};

/** pt-* → Brazilian Portuguese, es-* → Spanish, anything else → English */
export function strings(lang?: string): Strings {
  const l = lang?.toLowerCase() ?? '';
  if (l.startsWith('pt')) return pt;
  if (l.startsWith('es')) return es;
  return en;
}
