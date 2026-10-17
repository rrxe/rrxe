const fsSync = require('node:fs')
const path = require('node:path')
function loadEnvFile() {
  try {
    const contents = fsSync.readFileSync(path.join(__dirname, '.env'), 'utf8')
    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue
      let value = match[2].trim()
      if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      process.env[match[1]] = value
    }
  } catch {}
}
loadEnvFile()
const express = require('./lib/mini-express')
const crypto = require('node:crypto')
const { TelegramBot, Markup } = require('./lib/telegram-bot')
const { initStore, snapshot, mutate } = require('./lib/store')
const { uploadProof, deleteProof, downloadProof, signedProofUrl, uploadHostingFile, downloadHostingFile, signedHostingUrl } = require('./lib/supabase')

const app = express()
app.set('trust proxy', true)
app.disable('x-powered-by')
app.use(express.json({ limit: '22mb' }))
app.use(express.urlencoded({ extended: false, limit: '32kb' }))

const PORT = Number(process.env.PORT || 3000)
const ADMIN_SECRET = process.env.ADMIN_SECRET || ''
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || ''
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/+$/, '')
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || ''
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN) : null
const CUSTOMER_STATUSES = new Set(['PAYMENT_REVIEW', 'PAYMENT_REJECTED', 'PAID', 'IN_PROGRESS', 'NEED_INFO', 'DELIVERED', 'REJECTED', 'CANCELLED'])

const STATUS_LABELS = {
  PAYMENT_REVIEW: 'بانتظار مراجعة الدفع',
  PAYMENT_REJECTED: 'إثبات الدفع مرفوض',
  PAID: 'تم تأكيد الدفع',
  IN_PROGRESS: 'قيد التنفيذ',
  NEED_INFO: 'بانتظار معلومات منك',
  DELIVERED: 'تم التسليم',
  REJECTED: 'مرفوض',
  CANCELLED: 'ملغي',
}

function randomId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex')
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function readCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim())
  }
  return ''
}

function ensureSession(req, res) {
  let id = readCookie(req, 'storm_session')
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    id = crypto.randomUUID()
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
    res.append('Set-Cookie', `storm_session=${encodeURIComponent(id)}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax${secure}`)
  }
  return id
}

function verifyTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) return null
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')
    const pairs = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort()
    const dataCheckString = pairs.join('\n')
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
    const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex')
    const expectedBuffer = Buffer.from(expected, 'hex')
    const receivedBuffer = Buffer.from(hash, 'hex')
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return null
    const authDate = Number(params.get('auth_date') || 0)
    const now = Math.floor(Date.now() / 1000)
    if (!authDate || now - authDate > 24 * 60 * 60 || authDate - now > 60) return null
    const rawUser = params.get('user')
    if (!rawUser) return null
    const user = JSON.parse(rawUser)
    if (!user.id) return null
    return {
      id: String(user.id),
      username: user.username || '',
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      photoUrl: user.photo_url || '',
      languageCode: user.language_code || '',
    }
  } catch {
    return null
  }
}

function telegramUserFor(req) {
  const header = req.headers.authorization || ''
  const initData = header.startsWith('tga ') ? header.slice(4) : (req.headers['x-telegram-init-data'] || '')
  return verifyTelegramInitData(initData)
}

function currentCustomer(req, res) {
  const sessionId = ensureSession(req, res)
  const telegram = telegramUserFor(req)
  return { sessionId, telegram, telegramId: telegram?.id || null }
}

function adminOnly(req, res, next) {
  if (!ADMIN_SECRET || ADMIN_SECRET.length < 16) {
    return res.status(503).json({ error: 'ضبط ADMIN_SECRET بطول 16 حرفًا على الأقل في متغيرات البيئة لتفعيل لوحة الإدارة.' })
  }
  const supplied = String(req.headers['x-admin-secret'] || '')
  const a = Buffer.from(ADMIN_SECRET)
  const b = Buffer.from(supplied)
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!valid) return res.status(401).json({ error: 'كلمة مرور لوحة الإدارة غير صحيحة.' })
  next()
}

function cleanText(value, max = 3000) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function numeric(value, fallback = 0) {
  if (value === '' || value == null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function publicSettings(settings) {
  return {
    studioName: settings.studioName,
    tagline: settings.tagline,
    walletUsdtTon: settings.walletUsdtTon,
    walletGram: settings.walletGram,
    gramUsdRate: numeric(settings.gramUsdRate, 0),
    hostingMonthlyPrice: numeric(settings.hostingMonthlyPrice, 2.5),
    privateOwnershipPrice: numeric(settings.privateOwnershipPrice, 1),
    adsDisclosure: settings.adsDisclosure,
    paymentNote: settings.paymentNote,
    brandColors: settings.brandColors,
    gramConfigured: numeric(settings.gramUsdRate, 0) > 0 && Boolean(settings.walletGram),
    adminNotificationsConfigured: Boolean(BOT_TOKEN && ADMIN_TELEGRAM_ID),
  }
}

function calculatePrice(service, options, settings) {
  let price = Number(service.price)
  if (service.category === 'telegram_bot' && options?.privateOwnership === true) {
    price += numeric(settings.privateOwnershipPrice, 1)
  }
  return Math.round(price * 100) / 100
}

function parseScreenshot(dataUrl) {
  if (typeof dataUrl !== 'string') throw new Error('أرفق لقطة شاشة للتحويل.')
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
  if (!match) throw new Error('صيغة الصورة غير مدعومة. استخدم PNG أو JPG أو WebP.')
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (buffer.length < 100 || buffer.length > 6 * 1024 * 1024) throw new Error('حجم الصورة يجب أن يكون أقل من 6MB.')
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
  const isWebp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  const valid = match[1] === 'png' ? isPng : match[1] === 'jpeg' ? isJpeg : isWebp
  if (!valid) throw new Error('محتوى الصورة لا يطابق نوع الملف.')
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  return { buffer, extension, mime: `image/${match[1]}` }
}

function validateColors(colors) {
  if (!Array.isArray(colors)) return []
  return colors.slice(0, 3).map((color) => /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color).toUpperCase() : null).filter(Boolean)
}

async function proofUrl(order) {
  if (!order?.screenshotFile) return null
  try {
    return await signedProofUrl(path.basename(String(order.screenshotFile)), 3600)
  } catch (error) {
    console.error('[storage] could not create signed proof URL:', error.message)
    return null
  }
}

async function notifyAdmin(order) {
  if (!bot || !ADMIN_TELEGRAM_ID) return
  const label = STATUS_LABELS[order.status] || order.status
  const caption = [
    `🆕 <b>طلب جديد في STORM Studio</b>`,
    `<b>رقم الطلب:</b> <code>${escapeHtml(order.id)}</code>`,
    `<b>الخدمة:</b> ${escapeHtml(order.serviceName)}`,
    `<b>المبلغ:</b> ${escapeHtml(order.paymentAmount)} ${escapeHtml(order.paymentCurrency)} (≈ $${Number(order.priceUsd).toFixed(2)})`,
    `<b>طريقة الدفع:</b> ${escapeHtml(order.paymentMethodLabel)}`,
    `<b>TXID:</b> <code>${escapeHtml(order.txid)}</code>`,
    `<b>العميل:</b> ${escapeHtml(order.customerName || 'غير محدد')} ${order.telegramId ? `(Telegram ID: <code>${escapeHtml(order.telegramId)}</code>)` : ''}`,
    `<b>الحالة:</b> ${escapeHtml(label)}`,
    '',
    '<i>افتح لوحة الإدارة لمراجعة الإيصال وتحديث الحالة.</i>',
    WEBAPP_URL ? `${escapeHtml(WEBAPP_URL)}/admin` : '',
  ].filter(Boolean).join('\n')
  try {
    if (order.screenshotFile) {
      const filename = path.basename(String(order.screenshotFile))
      const proof = await downloadProof(filename)
      await bot.telegram.sendPhoto(ADMIN_TELEGRAM_ID, { source: proof, filename }, { caption, parse_mode: 'HTML' })
    } else {
      await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, caption, { parse_mode: 'HTML', disable_web_page_preview: true })
    }
  } catch (error) {
    console.error('[telegram] failed to notify admin:', error.message)
  }
}

async function notifyCustomer(order, message) {
  if (!bot || !order.telegramId) return
  try {
    await bot.telegram.sendMessage(order.telegramId, message)
  } catch (error) {
    console.error('[telegram] failed to notify customer:', error.message)
  }
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'STORM Studio', uptime: Math.round(process.uptime()) }))

app.get('/api/session', (req, res) => {
  const customer = currentCustomer(req, res)
  res.json({
    authenticatedInTelegram: Boolean(customer.telegram),
    customer: customer.telegram ? {
      id: customer.telegram.id,
      username: customer.telegram.username,
      firstName: customer.telegram.firstName,
      lastName: customer.telegram.lastName,
      photoUrl: customer.telegram.photoUrl,
    } : null,
    botConfigured: Boolean(BOT_TOKEN),
  })
})

app.get('/api/config', async (req, res, next) => {
  try {
    // STORM_TG_ONLY_GUARD_CONFIG
    if (!telegramUserFor(req)) return res.status(403).json({ error: 'افتح STORM Studio من داخل Telegram.' })
    const db = await snapshot()
    const settings = publicSettings(db.settings)
    res.json({
      studio: { name: settings.studioName, tagline: settings.tagline, colors: settings.brandColors },
      settings,
      services: db.services.filter((service) => service.active && service.category !== 'hosting').sort((a, b) => a.sortOrder - b.sortOrder),
      hostingPlans: (db.hostingPlans || []).filter((plan) => plan.active).sort((a, b) => a.sortOrder - b.sortOrder),
      projects: db.projects.filter((project) => project.active).sort((a, b) => a.sortOrder - b.sortOrder),
      botUsername: process.env.BOT_USERNAME || '',
    })
  } catch (error) { next(error) }
})

app.get('/api/orders', async (req, res, next) => {
  try {
    // STORM_TG_ONLY_GUARD_ORDERS_GET
    if (!telegramUserFor(req)) return res.status(403).json({ error: 'افتح STORM Studio من داخل Telegram.' })
    const customer = currentCustomer(req, res)
    const db = await snapshot()
    const orders = await Promise.all(db.orders
      .filter((order) => order.sessionId === customer.sessionId || (customer.telegramId && order.telegramId === customer.telegramId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(async (order) => ({
        id: order.id, createdAt: order.createdAt, updatedAt: order.updatedAt,
        serviceName: order.serviceName, category: order.category, projectTitle: order.projectTitle,
        details: order.details, options: order.options, colors: order.colors,
        priceUsd: order.priceUsd, paymentAmount: order.paymentAmount, paymentCurrency: order.paymentCurrency,
        paymentMethod: order.paymentMethod, status: order.status, statusLabel: STATUS_LABELS[order.status] || order.status,
        paymentStatus: order.paymentStatus, adminNote: order.adminNote || '', screenshotUrl: await proofUrl(order),
        txid: order.txid,
      })))
    res.json({ orders })
  } catch (error) { next(error) }
})

app.post('/api/orders', async (req, res, next) => {
  let savedFile = null
  try {
    const customer = currentCustomer(req, res)
    const body = req.body || {}
    const serviceId = cleanText(body.serviceId, 100)
    const hostingPlanId = cleanText(body.hostingPlanId, 100)
    const txid = cleanText(body.txid, 256)
    const paymentMethod = body.paymentMethod === 'GRAM' ? 'GRAM' : body.paymentMethod === 'USDT_TON' ? 'USDT_TON' : ''
    if (!serviceId && !hostingPlanId) return res.status(400).json({ error: 'اختر الخدمة أولًا.' })
    if (!paymentMethod) return res.status(400).json({ error: 'اختر طريقة الدفع.' })
    if (txid.length < 4) return res.status(400).json({ error: 'أدخل TXID صحيحًا للتحويل.' })
    const db = await snapshot()
    let service
    if (hostingPlanId) {
      const plan = (db.hostingPlans || []).find((item) => item.id === hostingPlanId && item.active)
      if (!plan) return res.status(400).json({ error: 'خطة الاستضافة غير متاحة حاليًا. حدّث الصفحة وحاول مجددًا.' })
      service = { ...plan, id: plan.id, category: 'hosting', hostingPlanId: plan.id }
    } else {
      service = db.services.find((item) => item.id === serviceId && item.active && item.category !== 'hosting')
    }
    if (!service) return res.status(400).json({ error: 'الخدمة غير متاحة حاليًا. حدّث الصفحة وحاول مجددًا.' })
    const options = {
      privateOwnership: service.category === 'telegram_bot' && body.options?.privateOwnership === true,
      hosting: false,
      botType: cleanText(body.options?.botType, 120),
      websiteType: cleanText(body.options?.websiteType, 120),
      appPurpose: cleanText(body.options?.appPurpose, 180),
    }
    const priceUsd = calculatePrice(service, options, db.settings)
    const wallet = paymentMethod === 'USDT_TON' ? db.settings.walletUsdtTon : db.settings.walletGram
    if (!wallet || wallet.length < 10) return res.status(409).json({ error: 'عنوان محفظة الدفع غير مضبوط. تواصل مع الأدمن.' })
    if (paymentMethod === 'GRAM' && !(numeric(db.settings.gramUsdRate, 0) > 0)) {
      return res.status(409).json({ error: 'الدفع بـ GRAM متوقف مؤقتًا حتى يضبط الأدمن سعر التحويل في لوحة الإدارة.' })
    }
    const screenshot = parseScreenshot(body.screenshotDataUrl)
    const projectTitle = cleanText(body.projectTitle, 160)
    const details = cleanText(body.details, 5000)
    const customerName = cleanText(body.customerName || customer.telegram?.firstName || '', 120)
    const contact = cleanText(body.contact || (customer.telegram?.username ? `@${customer.telegram.username}` : ''), 160)
    if (projectTitle.length < 2) return res.status(400).json({ error: 'اكتب اسمًا للمشروع.' })
    if (details.length < 12) return res.status(400).json({ error: 'اشرح فكرتك بتفاصيل أكثر (12 حرفًا على الأقل).' })
    const paymentCurrency = paymentMethod === 'USDT_TON' ? 'USDT' : 'GRAM'
    const paymentAmount = paymentMethod === 'USDT_TON'
      ? priceUsd.toFixed(2)
      : (Math.ceil((priceUsd / numeric(db.settings.gramUsdRate, 0)) * 10000) / 10000).toFixed(4)
    const id = `ST-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    const filename = `${id.toLowerCase()}-${crypto.randomUUID()}.${screenshot.extension}`
    await uploadProof(filename, screenshot.buffer, screenshot.mime)
    savedFile = filename
    const timestamp = new Date().toISOString()
    const order = {
      id, sessionId: customer.sessionId, telegramId: customer.telegramId,
      customerName, contact, serviceId: service.id, serviceName: service.name,
      category: service.category, hostingPlanId: service.category === 'hosting' ? service.hostingPlanId : null,
      planDurationDays: service.category === 'hosting' ? Math.max(1, Math.min(3650, Number(service.durationDays || 30))) : null,
      projectTitle, details, options,
      colors: service.category === 'mini_app' ? validateColors(body.colors) : [],
      priceUsd, paymentAmount, paymentCurrency, paymentMethod,
      paymentMethodLabel: paymentMethod === 'USDT_TON' ? 'USDT على شبكة TON' : 'GRAM',
      walletAddress: wallet, txid, screenshotFile: filename,
      status: 'PAYMENT_REVIEW', paymentStatus: 'PENDING_REVIEW',
      adminNote: '', createdAt: timestamp, updatedAt: timestamp,
    }
    await mutate((state) => { state.orders.push(order); return { id: order.id } })
    notifyAdmin(order).catch(() => {})
    res.status(201).json({ success: true, order: { id, status: order.status, statusLabel: STATUS_LABELS[order.status], priceUsd, paymentAmount, paymentCurrency } })
  } catch (error) {
    if (savedFile) await deleteProof(savedFile).catch((cleanupError) => console.error('[storage] cleanup failed:', cleanupError.message))
    if (error.message && (/أرفق|صيغة الصورة|حجم الصورة|محتوى الصورة/.test(error.message))) return res.status(400).json({ error: error.message })
    next(error)
  }
})

function hostingPlanPayload(plan, existing = {}) {
  const name = cleanText(plan.name ?? existing.name, 120)
  const description = cleanText(plan.description ?? existing.description, 1000)
  const price = Number(plan.price ?? existing.price)
  const durationDays = Math.floor(numeric(plan.durationDays, existing.durationDays || 30))
  if (name.length < 2 || !Number.isFinite(price) || price < 0 || price > 100000 || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw new Error('تحقق من اسم خطة الاستضافة والسعر وعدد الأيام (1–3650).')
  }
  const includes = Array.isArray(plan.includes) ? plan.includes.slice(0, 12).map((item) => cleanText(item, 120)).filter(Boolean) : (existing.includes || [])
  return {
    ...existing,
    id: existing.id || cleanText(plan.id, 100), name, description,
    price: Math.round(price * 100) / 100, durationDays,
    icon: cleanText(plan.icon ?? existing.icon ?? '⌂', 12),
    featured: plan.featured == null ? Boolean(existing.featured) : Boolean(plan.featured),
    active: plan.active == null ? (existing.active !== false) : Boolean(plan.active),
    sortOrder: Math.max(0, Math.min(999, Math.floor(numeric(plan.sortOrder, existing.sortOrder || 99)))),
    includes,
  }
}

function publicHostingSubscription(sub) {
  const now = Date.now()
  const expiresAt = sub.expiresAt ? Date.parse(sub.expiresAt) : NaN
  const daysRemaining = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - now) / 86400000)) : null
  return {
    id: sub.id, serialId: sub.serialId, orderId: sub.orderId,
    customerName: sub.customerName || '', contact: sub.contact || '', projectTitle: sub.projectTitle || '',
    planId: sub.planId, planName: sub.planName, priceUsd: sub.priceUsd, durationDays: sub.durationDays,
    status: sub.status, runtimeStatus: sub.runtimeStatus || 'stopped', runtimeUrl: sub.runtimeUrl || '',
    startedAt: sub.startedAt || null, expiresAt: sub.expiresAt || null, daysRemaining,
    latestVersion: sub.latestVersion || 0, activeVersion: sub.activeVersion || 0,
    updatePending: Boolean(sub.updatePending), createdAt: sub.createdAt, updatedAt: sub.updatedAt,
    versions: (sub.versions || []).map((version) => ({ version: version.version, uploadedAt: version.uploadedAt, fileName: version.fileName || 'project.zip' })),
  }
}

function customerOwnsSubscription(sub, customer) {
  return Boolean((customer.telegramId && sub.telegramId && String(customer.telegramId) === String(sub.telegramId)) || (customer.sessionId && sub.sessionId && customer.sessionId === sub.sessionId))
}

const HOSTING_ZIP_MAX_BYTES = 500 * 1024

function decodeZipDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw new Error('اختر ملف ZIP للمشروع.')
  const match = /^data:([A-Za-z0-9.+/-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
  if (!match) throw new Error('صيغة ملف ZIP غير صحيحة.')
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!buffer.length || buffer.length > HOSTING_ZIP_MAX_BYTES) throw new Error('حجم ZIP يجب ألا يتجاوز 500KB.')
  const signature = buffer.subarray(0, 4)
  if (!(signature[0] === 0x50 && signature[1] === 0x4b && [0x03, 0x05, 0x07].includes(signature[2]) && [0x04, 0x06, 0x08].includes(signature[3]))) {
    throw new Error('الملف لا يبدو ZIP صالحًا.')
  }
  return buffer
}

function validateEnvText(value) {
  const text = String(value == null ? '' : value)
  if (!text.trim()) throw new Error('اكتب متغيرات ENV الخاصة بالمشروع في الحقل النصي.')
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024) throw new Error('حجم ENV يجب ألا يتجاوز 64KB.')
  if (text.includes('\0')) throw new Error('نص ENV يحتوي على محارف غير صالحة.')
  if (!/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/m.test(text)) throw new Error('نص ENV يجب أن يحتوي على متغيرات بصيغة KEY=VALUE.')
  return text.endsWith('\n') ? text : `${text}\n`
}

app.get('/api/hosting/subscriptions', async (req, res, next) => {
  try {
    const telegram = telegramUserFor(req)
    if (!telegram) return res.status(403).json({ error: 'افتح STORM Studio من داخل Telegram.' })
    const customer = currentCustomer(req, res)
    const db = await snapshot()
    const subscriptions = (db.hostingSubscriptions || []).filter((sub) => customerOwnsSubscription(sub, customer)).sort((a, b) => b.serialId - a.serialId).map(publicHostingSubscription)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ subscriptions })
  } catch (error) { next(error) }
})

app.post('/api/hosting/subscriptions/:id/upload', async (req, res, next) => {
  try {
    const telegram = telegramUserFor(req)
    if (!telegram) return res.status(403).json({ error: 'افتح STORM Studio من داخل Telegram.' })
    const customer = currentCustomer(req, res)
    const id = cleanText(req.params.id, 100)
    const db = await snapshot()
    const sub = (db.hostingSubscriptions || []).find((item) => item.id === id)
    if (!sub || !customerOwnsSubscription(sub, customer)) return res.status(404).json({ error: 'اشتراك الاستضافة غير موجود.' })
    if (sub.expiresAt && Date.parse(sub.expiresAt) < Date.now()) return res.status(409).json({ error: 'انتهت مدة الاشتراك. جدّد المدة من الإدارة قبل رفع تحديث.' })
    const zipBuffer = decodeZipDataUrl(req.body?.zipDataUrl)
    const envText = validateEnvText(req.body?.envText)
    const nextVersion = Math.max(0, Number(sub.latestVersion || 0)) + 1
    const zipKey = `hosting/${sub.id}/v${nextVersion}/project.zip`
    const envKey = `hosting/${sub.id}/v${nextVersion}/environment.env`
    await uploadHostingFile(zipKey, zipBuffer, 'application/zip')
    await uploadHostingFile(envKey, Buffer.from(envText, 'utf8'), 'text/plain')
    const fileName = cleanText(req.body?.fileName || 'project.zip', 180).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'project.zip'
    const updated = await mutate((state) => {
      const target = state.hostingSubscriptions.find((item) => item.id === id)
      if (!target || !customerOwnsSubscription(target, customer)) return null
      target.versions = Array.isArray(target.versions) ? target.versions : []
      target.versions.push({ version: nextVersion, zipKey, envKey, fileName, uploadedAt: new Date().toISOString(), uploadedByCustomer: true })
      target.latestVersion = nextVersion
      target.updatePending = Boolean(target.activeVersion)
      target.status = target.activeVersion ? (target.runtimeStatus === 'running' ? 'running' : 'update_pending') : 'ready_to_run'
      target.updatedAt = new Date().toISOString()
      return target
    })
    if (!updated) return res.status(404).json({ error: 'اشتراك الاستضافة غير موجود.' })
    res.status(201).json({ success: true, subscription: publicHostingSubscription(updated), message: 'تم استلام الملفات بأمان، وهي الآن بانتظار مراجعة الإدارة.' })
  } catch (error) {
    if (error.message && /اختر ملف|صيغة ملف ZIP|حجم ZIP|لا يبدو ZIP|اكتب متغيرات ENV|حجم ENV|محارف غير صالحة|يجب أن يحتوي على متغيرات/.test(error.message)) return res.status(400).json({ error: error.message })
    next(error)
  }
})

// Admin API: every endpoint is protected by the same server-only secret used by SLY's admin tools.
app.use('/api/admin', adminOnly)

app.get('/api/admin/hosting', async (req, res, next) => {
  try {
    const db = await snapshot()
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      manualHosting: true,
      plans: (db.hostingPlans || []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
      subscriptions: (db.hostingSubscriptions || []).slice().sort((a, b) => b.serialId - a.serialId).map(publicHostingSubscription),
      orders: db.orders.filter((order) => order.category === 'hosting' && order.paymentStatus !== 'APPROVED' && !['PAYMENT_REJECTED', 'REJECTED', 'CANCELLED'].includes(order.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((order) => ({
        id: order.id, createdAt: order.createdAt, updatedAt: order.updatedAt, orderId: order.id,
        serviceName: order.serviceName, hostingPlanId: order.hostingPlanId, projectTitle: order.projectTitle,
        customerName: order.customerName, contact: order.contact, telegramId: order.telegramId,
        priceUsd: order.priceUsd, paymentMethodLabel: order.paymentMethodLabel, paymentStatus: order.paymentStatus,
        status: order.status, statusLabel: STATUS_LABELS[order.status] || order.status,
      })),
    })
  } catch (error) { next(error) }
})

app.post('/api/admin/hosting/plans', async (req, res, next) => {
  try {
    const id = `hosting_plan_${crypto.randomBytes(5).toString('hex')}`
    const plan = hostingPlanPayload(req.body || {}, { id, active: true, featured: false, sortOrder: 99, includes: [] })
    plan.id = id
    const created = await mutate((db) => { db.hostingPlans.push(plan); return plan })
    res.status(201).json({ success: true, plan: created })
  } catch (error) { if (error.message?.startsWith('تحقق')) return res.status(400).json({ error: error.message }); next(error) }
})

app.patch('/api/admin/hosting/plans/:id', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const result = await mutate((db) => {
      const index = (db.hostingPlans || []).findIndex((plan) => plan.id === id)
      if (index < 0) return null
      db.hostingPlans[index] = hostingPlanPayload(req.body || {}, db.hostingPlans[index])
      return db.hostingPlans[index]
    })
    if (!result) return res.status(404).json({ error: 'خطة الاستضافة غير موجودة.' })
    res.json({ success: true, plan: result })
  } catch (error) { if (error.message?.startsWith('تحقق')) return res.status(400).json({ error: error.message }); next(error) }
})

app.delete('/api/admin/hosting/plans/:id', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const result = await mutate((db) => {
      const plan = (db.hostingPlans || []).find((item) => item.id === id)
      if (!plan) return null
      const used = db.orders.some((order) => order.category === 'hosting' && order.hostingPlanId === id) || (db.hostingSubscriptions || []).some((sub) => sub.planId === id)
      if (used) { plan.active = false; return { deleted: false, deactivated: true } }
      db.hostingPlans = db.hostingPlans.filter((item) => item.id !== id)
      return { deleted: true, deactivated: false }
    })
    if (!result) return res.status(404).json({ error: 'خطة الاستضافة غير موجودة.' })
    res.json({ success: true, ...result })
  } catch (error) { next(error) }
})

app.get('/api/admin/hosting/:id/env', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const db = await snapshot()
    const sub = (db.hostingSubscriptions || []).find((item) => item.id === id)
    const version = sub?.versions?.find((entry) => entry.version === Number(sub.latestVersion))
    if (!sub || !version?.envKey) return res.status(404).json({ error: 'ENV غير موجود لهذا الاشتراك.' })
    const buffer = await downloadHostingFile(version.envKey)
    res.setHeader('Cache-Control', 'no-store, private')
    res.json({ envText: buffer.toString('utf8'), version: version.version })
  } catch (error) { next(error) }
})

app.patch('/api/admin/hosting/:id/env', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const envText = validateEnvText(req.body?.envText)
    const db = await snapshot()
    const sub = (db.hostingSubscriptions || []).find((item) => item.id === id)
    const version = sub?.versions?.find((entry) => entry.version === Number(sub.latestVersion))
    if (!sub || !version?.envKey) return res.status(404).json({ error: 'ENV غير موجود لهذا الاشتراك.' })
    await uploadHostingFile(version.envKey, Buffer.from(envText, 'utf8'), 'text/plain')
    await mutate((state) => {
      const target = state.hostingSubscriptions.find((item) => item.id === id)
      if (!target) return null
      const current = target.versions.find((entry) => entry.version === Number(target.latestVersion))
      if (current) current.envUpdatedAt = new Date().toISOString()
      target.updatedAt = new Date().toISOString()
      return target
    })
    res.json({ success: true, message: 'تم حفظ ENV بأمان. أعد تشغيل الخدمة لتطبيق التغييرات.' })
  } catch (error) {
    if (error.message && /اكتب متغيرات ENV|حجم ENV|محارف غير صالحة|يجب أن يحتوي على متغيرات/.test(error.message)) return res.status(400).json({ error: error.message })
    next(error)
  }
})

app.get('/api/admin/hosting/:id/download', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const db = await snapshot()
    const sub = (db.hostingSubscriptions || []).find((item) => item.id === id)
    if (!sub) return res.status(404).json({ error: 'الاشتراك غير موجود.' })
    const wanted = req.query.version === 'latest' || !req.query.version ? Number(sub.latestVersion) : Number(req.query.version)
    const version = sub.versions?.find((entry) => entry.version === wanted)
    if (!version?.zipKey) return res.status(404).json({ error: 'ملف ZIP غير موجود.' })
    const buffer = await downloadHostingFile(version.zipKey)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="project-${sub.serialId}-v${version.version}.zip"`)
    res.setHeader('Cache-Control', 'no-store, private')
    res.send(buffer)
  } catch (error) { next(error) }
})

app.post('/api/admin/hosting/:id/activate', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const db = await snapshot()
    const sub = (db.hostingSubscriptions || []).find((item) => item.id === id)
    if (!sub) return res.status(404).json({ error: 'الاشتراك غير موجود.' })
    const version = sub.versions?.find((entry) => entry.version === Number(sub.latestVersion))
    if (!version?.zipKey || !version?.envKey) return res.status(409).json({ error: 'لا يمكن التفعيل قبل أن يرسل العميل ملف ZIP ونص ENV.' })
    if (sub.expiresAt && Date.parse(sub.expiresAt) < Date.now()) return res.status(409).json({ error: 'مدة الاشتراك منتهية؛ أضف أيامًا من لوحة الإدارة قبل التفعيل.' })

    const submittedUrl = typeof req.body?.runtimeUrl === 'string' ? req.body.runtimeUrl.trim() : ''
    let runtimeUrl = sub.runtimeUrl || ''
    if (submittedUrl) {
      let parsed
      try { parsed = new URL(submittedUrl) } catch { return res.status(400).json({ error: 'رابط المشروع غير صالح.' }) }
      if (parsed.protocol !== 'https:') return res.status(400).json({ error: 'رابط المشروع يجب أن يبدأ بـ HTTPS.' })
      runtimeUrl = parsed.href.slice(0, 500)
    }

    const now = new Date()
    const updated = await mutate((state) => {
      const target = state.hostingSubscriptions.find((item) => item.id === id)
      if (!target) return null
      const latestVersion = Number(target.latestVersion || 0)
      const wasStarted = Boolean(target.startedAt)
      if (!wasStarted) {
        target.startedAt = now.toISOString()
        target.expiresAt = new Date(now.getTime() + Number(target.durationDays || 30) * 86400000).toISOString()
      }
      target.runtimeUrl = runtimeUrl
      target.runtimeStatus = 'running'
      target.status = 'running'
      target.activeVersion = latestVersion
      target.updatePending = false
      target.lastRunAt = now.toISOString()
      target.manualActivation = true
      target.manualActivatedAt = now.toISOString()
      target.updatedAt = now.toISOString()
      return target
    })
    if (!updated) return res.status(404).json({ error: 'الاشتراك لم يعد موجودًا.' })
    res.json({ success: true, subscription: publicHostingSubscription(updated), message: 'تم تفعيل الاشتراك يدويًا. تأكد أنك شغّلت المشروع على استضافتك وأنه يعمل فعلًا.' })
  } catch (error) { next(error) }
})

app.post('/api/admin/hosting/:id/stop', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const updated = await mutate((state) => {
      const target = (state.hostingSubscriptions || []).find((item) => item.id === id)
      if (!target) return null
      target.status = 'stopped'
      target.runtimeStatus = 'stopped'
      target.manualStoppedAt = new Date().toISOString()
      target.updatedAt = new Date().toISOString()
      return target
    })
    if (!updated) return res.status(404).json({ error: 'الاشتراك غير موجود.' })
    res.json({ success: true, subscription: publicHostingSubscription(updated), message: 'تم تسجيل حالة الاشتراك كمتوقف. أوقف العملية أيضًا من لوحة استضافتك.' })
  } catch (error) { next(error) }
})

app.patch('/api/admin/hosting/:id/extend', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const days = Math.floor(Number(req.body?.days))
    if (!Number.isInteger(days) || days < 1 || days > 3650) return res.status(400).json({ error: 'أدخل عدد أيام بين 1 و3650.' })
    const updated = await mutate((state) => {
      const sub = (state.hostingSubscriptions || []).find((item) => item.id === id)
      if (!sub) return null
      const now = Date.now()
      sub.durationDays = Number(sub.durationDays || 0) + days
      if (sub.startedAt && sub.expiresAt) {
        const expiry = Date.parse(sub.expiresAt)
        const base = Number.isFinite(expiry) ? Math.max(now, expiry) : now
        sub.expiresAt = new Date(base + days * 86400000).toISOString()
      }
      // For a subscription that has never started, added days extend its purchased allowance;
      // the countdown still begins only after the runner confirms the first successful start.
      if (sub.status === 'expired') sub.status = sub.runtimeStatus === 'running' ? 'running' : (sub.latestVersion ? 'ready_to_run' : 'awaiting_upload')
      sub.updatedAt = new Date().toISOString()
      return sub
    })
    if (!updated) return res.status(404).json({ error: 'الاشتراك غير موجود.' })
    res.json({ success: true, subscription: publicHostingSubscription(updated) })
  } catch (error) { next(error) }
})

app.get('/api/admin/overview', async (req, res, next) => {
  try {
    const db = await snapshot()
    const byStatus = {}
    for (const status of CUSTOMER_STATUSES) byStatus[status] = db.orders.filter((order) => order.status === status).length
    const approvedOrders = db.orders.filter((order) => order.paymentStatus === 'APPROVED')
    const totalRevenue = approvedOrders.reduce((sum, order) => sum + numeric(order.priceUsd), 0)
    res.json({
      totalOrders: db.orders.length,
      pendingPayments: byStatus.PAYMENT_REVIEW,
      inProgress: byStatus.IN_PROGRESS,
      delivered: byStatus.DELIVERED,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      servicesCount: db.services.length,
      activeServices: db.services.filter((service) => service.active).length,
      projectsCount: db.projects.length,
      recentOrders: await Promise.all(db.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(async (order) => ({ ...order, statusLabel: STATUS_LABELS[order.status] || order.status, screenshotUrl: await proofUrl(order) }))),
    })
  } catch (error) { next(error) }
})

app.get('/api/admin/orders', async (req, res, next) => {
  try {
    const db = await snapshot()
    const wantedStatus = cleanText(req.query.status, 80)
    const query = cleanText(req.query.q, 160).toLowerCase()
    const orders = await Promise.all(db.orders
      .filter((order) => !wantedStatus || wantedStatus === 'ALL' || order.status === wantedStatus)
      .filter((order) => !query || [order.id, order.serviceName, order.projectTitle, order.customerName, order.contact, order.txid, order.telegramId].some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(async (order) => ({ ...order, statusLabel: STATUS_LABELS[order.status] || order.status, screenshotUrl: await proofUrl(order) })))
    res.json({ orders })
  } catch (error) { next(error) }
})

app.patch('/api/admin/orders/:id', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const status = cleanText(req.body?.status, 80)
    const adminNote = cleanText(req.body?.adminNote, 2500)
    if (!CUSTOMER_STATUSES.has(status)) return res.status(400).json({ error: 'حالة الطلب غير معروفة.' })
    const updated = await mutate((db) => {
      const order = db.orders.find((item) => item.id === id)
      if (!order) return null
      order.status = status
      order.adminNote = adminNote
      order.updatedAt = new Date().toISOString()
      if (status === 'PAID' || status === 'IN_PROGRESS' || status === 'NEED_INFO' || status === 'DELIVERED') {
        order.paymentStatus = 'APPROVED'
        if (!order.paymentApprovedAt) order.paymentApprovedAt = order.updatedAt
      } else if (status === 'PAYMENT_REVIEW') {
        order.paymentStatus = 'PENDING_REVIEW'
        delete order.paymentApprovedAt
      } else if (status === 'PAYMENT_REJECTED' || (status === 'REJECTED' && order.paymentStatus === 'PENDING_REVIEW')) {
        order.paymentStatus = 'REJECTED'
      } else if (status === 'CANCELLED' && order.paymentStatus === 'PENDING_REVIEW') {
        order.paymentStatus = 'CANCELLED'
      }
      if (order.category === 'hosting' && order.paymentStatus === 'APPROVED' && !(db.hostingSubscriptions || []).some((sub) => sub.orderId === order.id)) {
        const serialId = Math.max(0, ...(db.hostingSubscriptions || []).map((sub) => Number(sub.serialId) || 0)) + 1
        const plan = (db.hostingPlans || []).find((item) => item.id === order.hostingPlanId || item.id === order.serviceId)
        db.hostingSubscriptions.push({
          id: `hosting_${serialId}`, serialId, orderId: order.id,
          sessionId: order.sessionId, telegramId: order.telegramId,
          customerName: order.customerName || '', contact: order.contact || '', projectTitle: order.projectTitle || order.serviceName,
          planId: order.hostingPlanId || order.serviceId, planName: plan?.name || order.serviceName,
          priceUsd: Number(order.priceUsd || 0), durationDays: Number(order.planDurationDays || plan?.durationDays || 30),
          status: 'awaiting_upload', runtimeStatus: 'stopped', runtimeUrl: '', runtimeId: '',
          startedAt: null, expiresAt: null, latestVersion: 0, activeVersion: 0, updatePending: false,
          versions: [], createdAt: order.updatedAt, updatedAt: order.updatedAt,
        })
      }
      return order
    })
    if (!updated) return res.status(404).json({ error: 'الطلب غير موجود.' })
    const note = adminNote ? `\nملاحظة من STORM: ${adminNote}` : ''
    notifyCustomer(updated, `تحديث طلبك ${updated.id}: ${STATUS_LABELS[status] || status}.${note}`).catch(() => {})
    res.json({ success: true, order: { ...updated, screenshotUrl: await proofUrl(updated) } })
  } catch (error) { next(error) }
})

app.get('/api/admin/services', async (req, res, next) => {
  try { const db = await snapshot(); res.json({ services: db.services.slice().sort((a, b) => a.sortOrder - b.sortOrder) }) }
  catch (error) { next(error) }
})

function normalizeService(body, existing = {}) {
  const category = ['telegram_bot', 'mini_app', 'website'].includes(body.category) ? body.category : existing.category
  const name = cleanText(body.name ?? existing.name, 120)
  const description = cleanText(body.description ?? existing.description, 900)
  const price = Number(body.price ?? existing.price)
  if (!category || name.length < 2 || !Number.isFinite(price) || price < 0 || price > 100000) throw new Error('تحقق من الاسم والتصنيف والسعر.')
  const includes = Array.isArray(body.includes) ? body.includes.slice(0, 12).map((item) => cleanText(item, 100)).filter(Boolean) : (existing.includes || [])
  return {
    ...existing,
    category, name, description,
    price: Math.round(price * 100) / 100,
    icon: cleanText(body.icon ?? existing.icon ?? '✦', 12),
    featured: body.featured == null ? Boolean(existing.featured) : Boolean(body.featured),
    active: body.active == null ? (existing.active !== false) : Boolean(body.active),
    sortOrder: Math.max(0, Math.min(999, Math.floor(numeric(body.sortOrder, existing.sortOrder || 99)))),
    includes,
  }
}

app.post('/api/admin/services', async (req, res, next) => {
  try {
    const id = `service_${crypto.randomBytes(5).toString('hex')}`
    const service = normalizeService(req.body || {}, { id, sortOrder: 99, active: true, featured: false, icon: '✦', includes: [] })
    service.id = id
    const result = await mutate((db) => { db.services.push(service); return service })
    res.status(201).json({ success: true, service: result })
  } catch (error) { if (error.message?.startsWith('تحقق')) return res.status(400).json({ error: error.message }); next(error) }
})

app.patch('/api/admin/services/:id', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const result = await mutate((db) => {
      const index = db.services.findIndex((item) => item.id === id)
      if (index < 0) return null
      db.services[index] = normalizeService(req.body || {}, db.services[index])
      return db.services[index]
    })
    if (!result) return res.status(404).json({ error: 'الخدمة غير موجودة.' })
    res.json({ success: true, service: result })
  } catch (error) { if (error.message?.startsWith('تحقق')) return res.status(400).json({ error: error.message }); next(error) }
})

app.delete('/api/admin/services/:id', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const result = await mutate((db) => {
      const service = db.services.find((item) => item.id === id)
      if (!service) return null
      if (db.orders.some((order) => order.serviceId === id)) {
        service.active = false
        return { deleted: false, deactivated: true }
      }
      db.services = db.services.filter((item) => item.id !== id)
      return { deleted: true, deactivated: false }
    })
    if (!result) return res.status(404).json({ error: 'الخدمة غير موجودة.' })
    res.json({ success: true, ...result })
  } catch (error) { next(error) }
})

app.get('/api/admin/settings', async (req, res, next) => {
  try {
    const db = await snapshot()
    res.json({ settings: { ...publicSettings(db.settings), adminNotificationsConfigured: Boolean(BOT_TOKEN && ADMIN_TELEGRAM_ID), botConfigured: Boolean(BOT_TOKEN), webappUrlConfigured: Boolean(WEBAPP_URL) } })
  } catch (error) { next(error) }
})

app.put('/api/admin/settings', async (req, res, next) => {
  try {
    const body = req.body || {}
    const settings = await mutate((db) => {
      const nextSettings = db.settings
      for (const key of ['studioName', 'tagline', 'walletUsdtTon', 'walletGram', 'adsDisclosure', 'paymentNote']) {
        if (typeof body[key] === 'string') nextSettings[key] = cleanText(body[key], key === 'adsDisclosure' || key === 'paymentNote' ? 2500 : 180)
      }
      for (const key of ['gramUsdRate', 'hostingMonthlyPrice', 'privateOwnershipPrice']) {
        if (body[key] !== undefined) {
          if (body[key] === '' || body[key] === null) nextSettings[key] = key === 'gramUsdRate' ? 0 : nextSettings[key]
          else {
            const value = Number(body[key])
            if (!Number.isFinite(value) || value < 0 || value > 100000) throw new Error(`قيمة ${key} غير صالحة.`)
            nextSettings[key] = Math.round(value * 1000000) / 1000000
          }
        }
      }
      if (Array.isArray(body.brandColors)) nextSettings.brandColors = body.brandColors.slice(0, 3).map((v) => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toUpperCase() : null).filter(Boolean)
      return nextSettings
    })
    res.json({ success: true, settings: publicSettings(settings) })
  } catch (error) { if (error.message?.startsWith('قيمة ')) return res.status(400).json({ error: error.message }); next(error) }
})

app.get('/api/admin/projects', async (req, res, next) => {
  try { const db = await snapshot(); res.json({ projects: db.projects.slice().sort((a, b) => a.sortOrder - b.sortOrder) }) }
  catch (error) { next(error) }
})

function normalizeProject(body, existing = {}) {
  const title = cleanText(body.title ?? existing.title, 150)
  const url = cleanText(body.url ?? existing.url, 500)
  if (title.length < 2 || !/^https:\/\//i.test(url)) throw new Error('أدخل اسم المشروع ورابط HTTPS صالحًا.')
  return {
    ...existing, title, url,
    type: cleanText(body.type ?? existing.type, 100),
    description: cleanText(body.description ?? existing.description, 500),
    active: body.active == null ? (existing.active !== false) : Boolean(body.active),
    sortOrder: Math.max(0, Math.min(999, Math.floor(numeric(body.sortOrder, existing.sortOrder || 99)))),
  }
}

app.post('/api/admin/projects', async (req, res, next) => {
  try {
    const id = `project_${crypto.randomBytes(5).toString('hex')}`
    const project = normalizeProject(req.body || {}, { id, active: true, sortOrder: 99 })
    project.id = id
    const result = await mutate((db) => { db.projects.push(project); return project })
    res.status(201).json({ success: true, project: result })
  } catch (error) { if (error.message?.startsWith('أدخل')) return res.status(400).json({ error: error.message }); next(error) }
})

app.patch('/api/admin/projects/:id', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const result = await mutate((db) => {
      const index = db.projects.findIndex((item) => item.id === id)
      if (index < 0) return null
      db.projects[index] = normalizeProject(req.body || {}, db.projects[index])
      return db.projects[index]
    })
    if (!result) return res.status(404).json({ error: 'المشروع غير موجود.' })
    res.json({ success: true, project: result })
  } catch (error) { if (error.message?.startsWith('أدخل')) return res.status(400).json({ error: error.message }); next(error) }
})

app.delete('/api/admin/projects/:id', async (req, res, next) => {
  try {
    const id = cleanText(req.params.id, 100)
    const result = await mutate((db) => {
      const found = db.projects.some((item) => item.id === id)
      db.projects = db.projects.filter((item) => item.id !== id)
      return found
    })
    if (!result) return res.status(404).json({ error: 'المشروع غير موجود.' })
    res.json({ success: true })
  } catch (error) { next(error) }
})

const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, index: 'index.html' }))
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')))
app.get('/admin/', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')))
app.get('/{*wildcard}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'المسار غير موجود.' })
  res.sendFile(path.join(publicDir, 'index.html'))
})

app.use((error, req, res, next) => {
  console.error('[server]', error.message)
  if (res.headersSent) return next(error)
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'الطلب أكبر من الحد المسموح. ملف ZIP للاستضافة بحد أقصى 500KB.' })
  res.status(500).json({ error: 'حدث خطأ داخلي. حاول مرة أخرى.' })
})

async function startTelegramBot() {
  if (!bot) {
    console.log('[telegram] BOT_TOKEN not configured; browser mode is available, Mini App signatures and bot notifications are disabled.')
    return
  }
  bot.start(async (ctx) => {
    const welcome = 'أهلًا بك في STORM Studio ✦\nخدمات بوتات تيليجرام وMini Apps ومواقع مصممة حسب فكرتك.\n\nاضغط الزر لاستعراض الخدمات وتقديم طلبك.'
    if (WEBAPP_URL && /^https:\/\//i.test(WEBAPP_URL)) {
      await ctx.reply(welcome, Markup.inlineKeyboard([Markup.button.webApp('افتح STORM Studio', WEBAPP_URL)]))
    } else {
      await ctx.reply(`${welcome}\n\nالإدارة تحتاج ضبط WEBAPP_URL كرابط HTTPS لفتح التطبيق من هذا البوت.`)
    }
  })
  bot.command('services', async (ctx) => {
    if (WEBAPP_URL && /^https:\/\//i.test(WEBAPP_URL)) {
      await ctx.reply('استعرض الخدمات وقدّم طلبك من التطبيق:', Markup.inlineKeyboard([Markup.button.webApp('استعراض الخدمات', WEBAPP_URL)]))
    } else await ctx.reply('رابط التطبيق غير مضبوط بعد.')
  })
  bot.catch((error) => console.error('[telegram] bot error:', error.message))
  try {
    await bot.launch()
    if (WEBAPP_URL && /^https:\/\//i.test(WEBAPP_URL)) {
      bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'STORM Studio', web_app: { url: WEBAPP_URL } } }).catch((error) => console.error('[telegram] menu button setup failed:', error.message))
    }
    console.log('[telegram] bot polling started')
  } catch (error) {
    console.error('[telegram] bot could not start. Check BOT_TOKEN and avoid another polling instance:', error.message)
  }
}

async function start() {
  await initStore()
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`STORM Studio running on port ${PORT}; database: Supabase; proof storage: Supabase Storage`)
    if (!ADMIN_SECRET || ADMIN_SECRET.length < 16) console.warn('[security] Configure ADMIN_SECRET (16+ chars) to unlock /admin API.')
  })
  await startTelegramBot()
}

process.once('SIGINT', () => { if (bot) bot.stop('SIGINT'); process.exit(0) })
process.once('SIGTERM', () => { if (bot) bot.stop('SIGTERM'); process.exit(0) })
start().catch((error) => { console.error('[startup] fatal:', error); process.exit(1) })
