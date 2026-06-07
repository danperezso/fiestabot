// ============================================================
//  FiestaMatch Bot 💘
//  Pon tu BOT_TOKEN en el archivo .env o en la variable de
//  entorno BOT_TOKEN antes de arrancar.
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
  console.error('❌  Falta BOT_TOKEN. Créalo en BotFather y ponlo en .env')
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
  // visto = ya di like O ya pasé (guardamos pasos como "pasado")
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
          [Markup.button.callback('✏️  Editar mi perfil', 'editar_perfil')],
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
  await ctx.answerCbQuery('💘 Like dado!')
  const uid   = String(ctx.from.id)
  const otherId = ctx.match[1]
  const other = getPerfil(otherId)
  if (!other) return

  // Guardar like
  const myLikes = getLikes(uid)
  if (!myLikes.dado.includes(otherId)) {
    myLikes.dado.push(otherId)
    setLikes(uid, myLikes)
    const theirLikes = getLikes(otherId)
    if (!theirLikes.recibido.includes(uid)) {
      theirLikes.recibido.push(uid)
      setLikes(otherId, theirLikes)
    }
  }

  // ¿Match?
  if (esMatch(uid, otherId)) {
    const yo = getPerfil(uid)
    // Notificar al otro
    try {
      await bot.telegram.sendMessage(otherId,
        `💘 *¡MATCH\\!* \\¡${escapeMd(yo.nombre)} también te ha dado like\\!\n\n${formatPerfil(yo, true)}`,
        { parse_mode: 'MarkdownV2' }
      )
    } catch(_) {}
    // Notificar al que acaba de dar like
    await ctx.reply(
      `💘 *¡MATCH con ${escapeMd(other.nombre)}\\!*\n\n${formatPerfil(other, true)}`,
      { parse_mode: 'MarkdownV2' }
    )
  } else {
    await ctx.reply('❤️ Like enviado. Si te corresponde, ¡te avisamos!')
  }

  await mostrarSiguientePerfil(ctx)
})

bot.action(/^pasar_(.+)$/, async ctx => {
  await ctx.answerCbQuery('👋 Pasado')
  const uid = String(ctx.from.id)
  const otherId = ctx.match[1]
  const paso = getPaso(uid)
  const pasados = paso.pasados || []
  if (!pasados.includes(otherId)) pasados.push(otherId)
  setPaso(uid, { ...paso, pasados })
  await mostrarSiguientePerfil(ctx)
})

bot.command('explorar', ctx => mostrarSiguientePerfil(ctx))
bot.command('matches',  ctx => mostrarMatches(ctx))
bot.command('miperfil', async ctx => {
  const uid = String(ctx.from.id)
  const p = getPerfil(uid)
  if (!p) return ctx.reply('Aún no tienes perfil. Escribe /start para crearlo.')
  await ctx.reply(formatPerfil(p, false), { parse_mode: 'MarkdownV2' })
})

// ── Explorar ─────────────────────────────────────────────────
async function mostrarSiguientePerfil(ctx) {
  const uid = String(ctx.from.id)
  if (!getPerfil(uid)) {
    return ctx.reply('Primero crea tu perfil con /start 😊')
  }
  const lista = getPerfilesParaVer(ctx.from.id)
  if (!lista.length) {
    return ctx.reply('😅 Has visto todos los perfiles por ahora. ¡Vuelve más tarde!\n\nEscribe /matches para ver tus matches.')
  }
  const p = lista[0]
  await ctx.reply(
    formatPerfil(p, false),
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        Markup.button.callback('❌ Pasar',    `pasar_${p.userId}`),
        Markup.button.callback('💖 Me gusta', `like_${p.userId}`),
      ])
    }
  )
}

// ── Matches ───────────────────────────────────────────────────
async function mostrarMatches(ctx) {
  const uid = String(ctx.from.id)
  const dado = getLikes(uid).dado
  const matches = dado.filter(id => esMatch(uid, id)).map(id => getPerfil(id)).filter(Boolean)

  if (!matches.length) {
    return ctx.reply('Aún no tienes matches 😢\nEscribe /explorar para ver perfiles.')
  }
  await ctx.reply(`✨ Tienes *${matches.length} match${matches.length > 1 ? 'es' : ''}*\\:`, { parse_mode: 'MarkdownV2' })
  for (const p of matches) {
    await ctx.reply(formatPerfil(p, true), { parse_mode: 'MarkdownV2' })
  }
}

// ── Captura de texto libre (registro) ────────────────────────
bot.on('text', async ctx => {
  const uid  = String(ctx.from.id)
  const estado = getPaso(uid)
  if (!estado.actual) return  // no está en flujo de registro

  const texto = ctx.message.text.trim()
  if (texto.startsWith('/')) return  // comandos los gestionan los handlers de arriba

  await procesarRespuesta(ctx, uid, estado.actual, texto)
})

async function procesarRespuesta(ctx, uid, paso, valor) {
  const estado  = getPaso(uid)
  const perfil  = getPerfil(uid) || { userId: uid }

  // Validaciones
  if (paso === 'edad') {
    const n = parseInt(valor)
    if (!valor || isNaN(n) || n < 18 || n > 99) {
      return ctx.reply('⚠️ Por favor, introduce una edad válida (entre 18 y 99).')
    }
    perfil.edad = n
  } else if (paso === 'nombre') {
    if (!valor || valor.length < 2) return ctx.reply('⚠️ El nombre no puede estar vacío.')
    perfil.nombre = valor
  } else if (paso === 'ciudad') {
    if (!valor || valor.length < 2) return ctx.reply('⚠️ La ciudad no puede estar vacía.')
    perfil.ciudad = valor
  } else if (paso === 'busco') {
    if (!valor) return ctx.reply('⚠️ Elige una opción de los botones de arriba.')
    perfil.busco = valor
  } else if (paso === 'gustos') {
    if (!valor || valor.length < 2) return ctx.reply('⚠️ Cuéntanos al menos un gusto.')
    perfil.gustos = valor
  } else {
    // Campos opcionales
    if (valor) perfil[paso] = valor
    else perfil[paso] = ''
  }

  setPerfil(uid, perfil)
  const idx = PASOS.indexOf(paso)

  if (idx + 1 < PASOS.length) {
    await preguntarSiguiente(ctx, PASOS[idx + 1])
  } else {
    // Registro completado
    setPaso(uid, {})
    await ctx.reply(
      `✅ ¡Perfil listo, *${escapeMd(perfil.nombre)}*\\!\n\n${formatPerfil(perfil, false)}\n\n¿Empezamos a explorar\\?`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👀 Explorar perfiles', 'explorar')],
          [Markup.button.callback('✨ Ver mis matches',   'ver_matches')],
        ])
      }
    )
  }
}

// ── Ayuda ─────────────────────────────────────────────────────
bot.command('ayuda', ctx => ctx.reply(
  `*FiestaMatch* 💘 — Comandos disponibles:\n\n` +
  `/start — Crear o editar tu perfil\n` +
  `/explorar — Ver perfiles y dar likes\n` +
  `/matches — Ver tus matches (con contacto)\n` +
  `/miperfil — Ver tu perfil actual\n` +
  `/ayuda — Esta ayuda`,
  { parse_mode: 'Markdown' }
))

// ── Arrancar ──────────────────────────────────────────────────
bot.launch()
console.log('🤖 FiestaMatch Bot arrancado. Pulsa Ctrl+C para parar.')
process.once('SIGINT',  () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
