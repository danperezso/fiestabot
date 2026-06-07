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
  await ctx.answerCbQuery('💘 Like dado!')
  const uid   = String(ctx.from.id)
  const otherId = ctx.match[1]
  const other = getPerfil(otherId)
  if (!other) return

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

  if (esMatch(uid, otherId)) {
    const yo = getPerfil(uid)
    try {
      await bot.telegram.sendMessage(otherId,
        `💘 *¡MATCH\\!* \\¡${escapeMd(yo.nombre)} también te ha dado like\\!\n\n${formatPerfil(yo, true)}`,
        { parse_mode: 'MarkdownV2' }
      )
    } catch(_) {}
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
  if (!estado.actual) return

  const texto = ctx.message.text.trim()
  if (texto.startsWith('/')) return

  await procesarRespuesta(ctx, uid, estado.actual, texto)
})

async function procesarRespuesta(ctx, uid, paso, valor) {
  const estado  = getPaso(uid)
  const perfil  = getPerfil(uid) || { userId: uid }

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
    if (valor) perfil[paso] = valor
    else perfil[paso] = ''
  }

  setPerfil(uid, perfil)
  const idx = PASOS.indexOf(paso)

  if (idx + 1 < PASOS.length) {
    await preguntarSiguiente(ctx, PASOS[idx + 1])
  } else {
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

// ── Admin ─────────────────────────────────────────────────────
function isAdmin(ctx) {
  const adminIdEnv = process.env.ADMIN_ID;
  if (!adminIdEnv) return false;
  return String(ctx.from.id) === String(adminIdEnv).trim();
}

bot.command('admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ No tienes permiso para esto.')
  const perfiles = db.get('perfiles').value() || {}
  const total = Object.keys(perfiles).length
  await ctx.reply(
    `🛠 *Panel de Admin*\n\n👥 Perfiles registrados: *${total}*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👥 Ver todos los perfiles', 'admin_ver')],
        [Markup.button.callback('🗑 Borrar un perfil',        'admin_borrar_menu')],
        [Markup.button.callback('💘 Ver todos los matches',  'admin_matches')],
        [Markup.button.callback('🔄 Resetear TODO',          'admin_reset_confirm')],
      ])
    }
  )
})

bot.action('admin_ver', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Sin permiso')
  await ctx.answerCbQuery()
  const perfiles = db.get('perfiles').value() || {}
  const lista = Object.values(perfiles)
  if (!lista.length) return ctx.reply('No hay perfiles aún.')
  
  await ctx.reply(`👥 *${lista.length} perfiles registrados:*`, { parse_mode: 'MarkdownV2' })
  for (const p of lista) {
    const likes = getLikes(p.userId)
    const numMatches = likes.dado.filter(id => esMatch(p.userId, id)).length
    
    // Todo el texto plano dinámico y caracteres como '·' pasados de forma segura por escapeMd
    const textoAdmin = formatPerfil(p, true) + 
      `\n\n🆔 ID: \`${escapeMd(p.userId)}\`` +
      escapeMd(`\n💖 Likes dados: ${likes.dado.filter(id=>!id.endsWith('_pass')).length} · Matches: ${numMatches}`);

    await ctx.reply(textoAdmin, {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          Markup.button.callback(`🗑 Borrar a ${p.nombre}`, `admin_del_${p.userId}`)
        ])
      }
    )
  }
})

bot.action('admin_borrar_menu', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Sin permiso')
  await ctx.answerCbQuery()
  const perfiles = db.get('perfiles').value() || {}
  const lista = Object.values(perfiles)
  if (!lista.length) return ctx.reply('No hay perfiles para borrar.')
  const botones = lista.map(p => [Markup.button.callback(`🗑 ${p.nombre} (${p.edad}) — ${p.ciudad}`, `admin_del_${p.userId}`)])
  await ctx.reply('¿Qué perfil quieres borrar?', Markup.inlineKeyboard(botones))
})

bot.action(/^admin_del_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Sin permiso')
  await ctx.answerCbQuery()
  const uid = ctx.match[1]
  const p = getPerfil(uid)
  if (!p) return ctx.reply('Perfil no encontrado.')
  await ctx.reply(
    `⚠️ ¿Seguro que quieres borrar el perfil de *${escapeMd(p.nombre)}*?`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        Markup.button.callback('✅ Sí, borrar', `admin_delok_${uid}`),
        Markup.button.callback('❌ Cancelar',   'admin_cancel'),
      ])
    }
  )
})

bot.action(/^admin_delok_(.+)$/, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Sin permiso')
  await ctx.answerCbQuery()
  const uid = ctx.match[1]
  const p = getPerfil(uid)
  if (!p) return ctx.reply('Perfil no encontrado.')
  const nombre = p.nombre
  db.unset(`perfiles.${uid}`).write()
  db.unset(`likes.${uid}`).write()
  db.unset(`pasos.${uid}`).write()
  
  const todosLikes = db.get('likes').value() || {}
  for (const [otherId, data] of Object.entries(todosLikes)) {
    if (data.dado)      data.dado     = data.dado.filter(id => id !== uid && id !== uid+'_pass')
    if (data.recibido) data.recibido = data.recibido.filter(id => id !== uid)
    db.set(`likes.${otherId}`, data).write()
  }
  await ctx.reply(`✅ Perfil de *${escapeMd(nombre)}* borrado correctamente.`, { parse_mode: 'MarkdownV2' })
})

bot.action('admin_matches', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Sin permiso')
  await ctx.answerCbQuery()
  const perfiles = db.get('perfiles').value() || {}
  const vistos = new Set()
  const matches = []
  for (const [uid] of Object.entries(perfiles)) {
    const likes = getLikes(uid).dado.filter(id => !id.endsWith('_pass'))
    for (const otherId of likes) {
      const key = [uid, otherId].sort().join('_')
      if (!vistos.has(key) && esMatch(uid, otherId)) {
        vistos.add(key)
        const a = getPerfil(uid)
        const b = getPerfil(otherId)
        if (a && b) matches.push([a, b])
      }
    }
  }
  if (!matches.length) return ctx.reply('No hay matches aún.')
  await ctx.reply(`💘 *${matches.length} match${matches.length > 1 ? 'es' : ''} en total:*`, { parse_mode: 'MarkdownV2' })
  for (const [a, b] of matches) {
    // Escapados explícitos de los caracteres especiales para evitar crashes
    const textoMatch = `💘 *${escapeMd(a.nombre)}* \\+ *${escapeMd(b.nombre)}*\n` +
      `📱 ${escapeMd(a.nombre)}\\: ${escapeMd(a.telefono || '—')} ${escapeMd(a.instagram || '')}\n` +
      `📱 ${escapeMd(b.nombre)}\\: ${escapeMd(b.telefono || '—')} ${escapeMd(b.instagram || '')}`;
      
    await ctx.reply(textoMatch, { parse_mode: 'MarkdownV2' })
  }
})

bot.action('admin_reset_confirm', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Sin permiso')
  await ctx.answerCbQuery()
  await ctx.reply(
    '⚠️ *¿Borrar TODOS los perfiles, likes y matches?*\nEsta acción no se puede deshacer\\.',
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        Markup.button.callback('💣 Sí, resetear todo', 'admin_reset_ok'),
        Markup.button.callback('❌ Cancelar',            'admin_cancel'),
      ])
    }
  )
})

bot.action('admin_reset_ok', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Sin permiso')
  await ctx.answerCbQuery()
  db.set('perfiles', {}).set('likes', {}).set('pasos', {}).write()
  await ctx.reply('✅ Base de datos reseteada. Todo borrado.')
})

bot.action('admin_cancel', async ctx => {
  await ctx.answerCbQuery()
  await ctx.reply('❌ Operación cancelada.')
})

// ── Arrancar ──────────────────────────────────────────────────
bot.launch()
console.log('🤖 FiestaMatch Bot arrancado. Pulsa Ctrl+C para parar.')
process.once('SIGINT',  () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
