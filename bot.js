// ============================================================
//  FiestaMatch Bot 💘
//  Pon tu BOT_TOKEN y ADMIN_ID en las variables de entorno
//  antes de arrancar en Railway.
// ============================================================

const { Telegraf, Markup } = require('telegraf')
const low  = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
require('dotenv').config()

// ── Base de datos ────────────────────────────────────────────
const adapter = new FileSync('db.json')
const db = low(adapter)
db.defaults({ perfiles: {}, likes: {}, pasos: {} }).write()

// ── Bot ──────────────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN
if (!TOKEN) {
  console.error('❌ Falta BOT_TOKEN. Créalo en BotFather y ponlo en las variables de entorno.')
  process.exit(1)
}
const bot = new Telegraf(TOKEN)

// ── Constantes ───────────────────────────────────────────────
const PASOS = ['nombre','edad','ciudad','busco','gustos','descripcion','instagram','telefono']
const PREGUNTAS = {
  nombre:      '👋 ¡Hola! Empecemos con tu perfil.\n\n¿Cómo te llamas?',
  edad:        '🎂 ¿Cuántos años tienes?',
  ciudad:      '📍 ¿De qué ciudad o pueblo eres?',
  busco:       '💞 ¿Qué estás buscando?',
  gustos:      '🎯 ¿Cuáles son tus gustos o hobbies? (escríbelos separados por comas)\n_Ej: música en directo, senderismo, cocina..._',
  descripcion: '📝 Cuéntanos algo breve sobre ti (o escribe /saltar para dejarlo en blanco)',
  instagram:   '📸 ¿Cuál es tu Instagram? (o /saltar si no quieres ponerlo)',
  telefono:    '📱 Tu teléfono — *solo se mostrará si hay un match mutuo* (o /saltar)',
}
const BUSCO_OPS = Markup.inlineKeyboard([
  [Markup.button.callback('👧 Chica',  'busco_chica')],
  [Markup.button.callback('👦 Chico',  'busco_chico')],
  [Markup.button.callback('🧑 Cualquier persona', 'busco_cualquier')],
])

// ── Helpers ──────────────────────────────────────────────────
const getPerfil   = id => db.get(`perfiles.${id}`).value()
const setPerfil   = (id, data) => db.set(`perfiles.${id}`, data).write()
const getPaso     = id => db.get(`pasos.${id}`).value() || {}
const setPaso     = (id, data) => db.set(`pasos.${id}`, data).write()
const getLikes    = id => db.get(`likes.${id}`).value() || { dado: [], recibido: [] }
const setLikes    = (id, data) => db.set(`likes.${id}`, data).write()

function esMatch(a, b) {
  return getLikes(a).dado.includes(String(b)) && getLikes(b).dado.includes(String(a))
}

function formatPerfil(p, mostrarContacto = false) {
  const gustos = p.gustos ? p.gustos.split(',').map(g => `#${g.trim().replace(/\s+/g,'_')}`).join(' ') : ''
  let txt = `👤 *${escapeMd(p.nombre)}*, ${p.edad} años\n`
  txt += `📍 ${escapeMd(p.ciudad)}\n`
  txt += `💞 Busca: ${escapeMd(p.busco)}\n`
  if (gustos)     txt += `🎯 ${escapeMd(gustos)}\n`
  if (p.descripcion) txt += `\n_${escapeMd(p.descripcion)}_\n`
  if (mostrarContacto) {
    if (p.instagram) txt += `\n📸 Instagram: ${escapeMd(p.instagram)}`
    if (p.telefono)  txt += `\n📱 Teléfono: ${escapeMd(p.telefono)}`
  } else {
    if (p.instagram) txt += `\n📸 ${escapeMd(p.instagram)}`
  }
  return txt
}

function escapeMd(str) {
  if (!str) return ''
  return String(str).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c)
}

function getPerfilesParaVer(userId) {
  const uid = String(userId)
  const yoLikes = getLikes(uid)
  const vistos = new Set([...yoLikes.dado, ...yoLikes.recibido.filter(id => yoLikes.dado.includes(id)), uid])
  const pasados = db.get(`pasos.${uid}.pasados`).value() || []
  pasados.forEach(id => vistos.add(id))

  return db.get('perfiles').value()
    ? Object.entries(db.get('perfiles').value())
        .filter(([id]) => !vistos.has(id))
        .map(([, p]) => p)
    : []
}

// ── Flujo de registro ────────────────────────────────────────
async function preguntarSiguiente(ctx, paso) {
  const uid = String(ctx.from.id)
  setPaso(uid, { ...getPaso(uid), actual: paso })

  if (paso === 'busco') {
    await ctx.reply(PREGUNTAS.busco, BUSCO_OPS)
  } else {
    await ctx.reply(PREGUNTAS[paso], { parse_mode: 'Markdown' })
  }
}

bot.command('start', async ctx => {
  const uid = String(ctx.from.id)
  const p = getPerfil(uid)
  if (p) {
    await ctx.reply(
      `¡Hola de nuevo, *${escapeMd(p.nombre)}*\\! ¿Qué quieres hacer?`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👀 Explorar perfiles', 'explorar')],
          [Markup.button.callback('✨ Ver mis matches',   'ver_matches')],
          [Markup.button.callback('✏️ Editar mi perfil', 'editar_perfil')],
        ])
      }
    )
  } else {
    setPaso(uid, {})
    await preguntarSiguiente(ctx, 'nombre')
  }
})

bot.command('saltar', async ctx => {
  const uid = String(ctx.from.id)
  const estado = getPaso(uid)
  if (!estado.actual) return
  await procesarRespuesta(ctx, uid, estado.actual, null)
})

// Botones del menú de inicio
bot.action('explorar',      ctx => { ctx.answerCbQuery(); mostrarSiguientePerfil(ctx) })
bot.action('ver_matches',   ctx => { ctx.answerCbQuery(); mostrarMatches(ctx) })
bot.action('editar_perfil', ctx => {
  ctx.answerCbQuery()
  const uid = String(ctx.from.id)
  setPaso(uid, {})
  preguntarSiguiente(ctx, 'nombre')
})

// Botones de "busco"
for (const val of ['chica','chico','cualquier']) {
  bot.action(`busco_${val}`, async ctx => {
    await ctx.answerCbQuery()
    const uid = String(ctx.from.id)
    const label = val === 'chica' ? 'Chica' : val === 'chico' ? 'Chico' : 'Cualquier persona'
    await procesarRespuesta(ctx, uid, 'busco', label)
  })
}

// Botones de like / pasar
bot.action(/^like_(.+)$/, async ctx => {
  await ctx.answer
