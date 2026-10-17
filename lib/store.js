'use strict'

const { getSupabase } = require('./supabase')

const defaultServices = [
  {
    id: 'bot_earnings', category: 'telegram_bot', name: 'بوت ربح واشتراكات',
    description: 'بوت ربح مع إحالات واشتراك إجباري بالقنوات، بواجهة مرتبة وإعدادات واضحة.',
    price: 1, icon: '↗', featured: true, active: true, sortOrder: 1,
    includes: ['نظام إحالات', 'اشتراك إجباري بالقنوات', 'واجهة عربية مرتبة'],
  },
  {
    id: 'bot_custom', category: 'telegram_bot', name: 'بوت تيليجرام حسب فكرتك',
    description: 'متجر، شات، إدارة مجتمع، أدوات أو فكرة خاصة. اكتب المطلوب بالتفصيل.',
    price: 1, icon: '⌘', featured: false, active: true, sortOrder: 2,
    includes: ['تحديد المتطلبات', 'بناء حسب الفكرة', 'اختبار أساسي قبل التسليم'],
  },
  {
    id: 'miniapp_basic', category: 'mini_app', name: 'Mini App بدون إعلانات ربحية',
    description: 'تطبيق مصغر داخل تيليجرام بتصميم مخصص وفكرة واضحة، دون دمج إعلانات ربحية.',
    price: 2.5, icon: '▦', featured: true, active: true, sortOrder: 3,
    includes: ['اختيار حتى 3 ألوان', 'تصميم مناسب للموبايل', 'تجهيز التطبيق للتشغيل'],
  },
  {
    id: 'miniapp_adsgram', category: 'mini_app', name: 'Mini App مع Adsgram',
    description: 'تطبيق مصغر مع تجهيز تكامل Adsgram عند استيفاء شروط الشبكة وموافقتها.',
    price: 5, icon: '◈', featured: true, active: true, sortOrder: 4,
    includes: ['تصميم مخصص', 'إعداد التكامل الإعلاني', 'اختبار ظهور الإعلانات عند توفرها'],
  },
  {
    id: 'website_custom', category: 'website', name: 'Website مخصص',
    description: 'موقع هدية عيد ميلاد، ملف شخصي فخم، صفحة روابط أو موقع صغير حسب فكرتك.',
    price: 1.5, icon: '⌘', featured: false, active: true, sortOrder: 5,
    includes: ['متوافق مع الهاتف', 'ألوان ونصوص حسب الطلب', 'رابط معاينة قبل التسليم'],
  },
]

const defaultHostingPlans = [
  {
    id: 'hosting_basic', name: 'استضافة بوت أساسية', description: 'استضافة مشروع Node.js أو بوت تيليجرام مع متابعة حالة التشغيل.',
    price: 2.5, durationDays: 30, icon: '⌂', featured: true, active: true, sortOrder: 1,
    includes: ['30 يومًا من الاستضافة', 'رفع ZIP وملف ENV', 'متابعة حالة التشغيل'],
  },
  {
    id: 'hosting_plus', name: 'استضافة متقدمة', description: 'خطة أطول للمشاريع التي تحتاج مدة تشغيل ممتدة.',
    price: 6, durationDays: 90, icon: '✦', featured: false, active: true, sortOrder: 2,
    includes: ['90 يومًا من الاستضافة', 'رفع تحديثات جديدة', 'متابعة الحالة من الحساب'],
  },
]

const defaultProjects = [
  {
    id: 'sample-karim', title: 'Karim — Personal Website', type: 'موقع شخصي',
    description: 'مثال على صفحة شخصية بتصميم مستقل.', url: 'https://karimamass.netlify.app', active: true, sortOrder: 1,
  },
  {
    id: 'sample-storm', title: 'The Storm — Portfolio', type: 'ملف شخصي',
    description: 'مثال على صفحة تعريفية وهوية رقمية.', url: 'https://thestormvx.github.io/thestorm/', active: true, sortOrder: 2,
  },
]

const defaultSettings = {
  studioName: 'STORM Studio',
  tagline: 'نحوّل فكرتك إلى منتج جاهز',
  walletUsdtTon: 'UQASGLdviVNU07UL0zCF03reqoDi6YSUXMopnXsa3s81wd-q',
  walletGram: 'UQASGLdviVNU07UL0zCF03reqoDi6YSUXMopnXsa3s81wd-q',
  gramUsdRate: 0,
  hostingMonthlyPrice: 2.5,
  privateOwnershipPrice: 1,
  adsDisclosure: 'أرباح Adsgram غير مضمونة. قد تصل الأرباح إلى 100 دولار شهريًا في بعض الحالات، لكنها تعتمد على الزيارات، وتوفر الإعلانات، وبلد الجمهور، وموافقة الشبكة. STORM يجهز التكامل الفني؛ قبول التطبيق وتوفر الإعلانات ومقدار الأرباح لا يمكن ضمانها.',
  paymentNote: 'حوّل المبلغ المطلوب إلى المحفظة الصحيحة، ثم أدخل TXID وارفق لقطة واضحة للتحويل. تتم مراجعة الدفع يدويًا قبل بدء التنفيذ.',
  brandColors: ['#12304A', '#080B10', '#101923'],
}

let state = null
let initPromise = null
let queue = Promise.resolve()

function freshState() {
  return {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    services: structuredClone(defaultServices),
    hostingPlans: structuredClone(defaultHostingPlans),
    hostingSubscriptions: [],
    projects: structuredClone(defaultProjects),
    settings: structuredClone(defaultSettings),
    orders: [],
  }
}

function throwDatabaseError(action, error) {
  if (!error) return
  throw new Error(`${action}: ${error.message || String(error)}. تأكد من تشغيل ملف supabase_schema.sql في Supabase SQL Editor.`)
}

async function readRows(client, table) {
  const { data, error } = await client.from(table).select('id,data').order('id')
  throwDatabaseError(`تعذرت قراءة جدول ${table}`, error)
  return data || []
}

async function saveStateToDatabase(nextState) {
  const client = getSupabase()
  const { error } = await client.rpc('storm_studio_save_state', { p_state: nextState })
  throwDatabaseError('تعذر حفظ بيانات STORM Studio في Supabase', error)
}

async function initStore() {
  if (state) return state
  if (initPromise) return initPromise

  initPromise = (async () => {
    const client = getSupabase()
    const { data: meta, error: metaError } = await client
      .from('storm_studio_meta')
      .select('id,schema_version,created_at')
      .eq('id', 'main')
      .maybeSingle()
    throwDatabaseError('تعذر الوصول إلى قاعدة بيانات STORM Studio', metaError)

    if (!meta) {
      // Seed defaults exactly once. The SQL RPC creates the initial metadata row too.
      const initialState = freshState()
      await saveStateToDatabase(initialState)
      state = initialState
      console.log('[supabase] Connected; initial STORM Studio data created.')
      return state
    }

    const [serviceRows, hostingPlanRows, hostingSubscriptionRows, projectRows, orderRows, settingsResult] = await Promise.all([
      readRows(client, 'storm_studio_services'),
      readRows(client, 'storm_studio_hosting_plans'),
      readRows(client, 'storm_studio_hosting_subscriptions'),
      readRows(client, 'storm_studio_projects'),
      readRows(client, 'storm_studio_orders'),
      client.from('storm_studio_settings').select('data').eq('id', 'main').maybeSingle(),
    ])
    throwDatabaseError('تعذرت قراءة إعدادات STORM Studio', settingsResult.error)

    const rawServices = serviceRows.map((row) => row.data).filter(Boolean)
    const legacyHosting = rawServices.filter((service) => service.category === 'hosting').map((service) => ({
      id: service.id, name: service.name, description: service.description || '', price: Number(service.price || 0),
      durationDays: 30, icon: service.icon || '⌂', featured: Boolean(service.featured), active: service.active !== false,
      sortOrder: Number(service.sortOrder || 99), includes: Array.isArray(service.includes) ? service.includes : [],
    }))
    let hostingPlans = hostingPlanRows.map((row) => row.data).filter(Boolean)
    const hostingSubscriptions = hostingSubscriptionRows.map((row) => row.data).filter(Boolean)
    const oldSchema = Number(meta.schema_version || 1) < 2
    if (!hostingPlans.length && legacyHosting.length) hostingPlans = legacyHosting
    else if (!hostingPlans.length && oldSchema) hostingPlans = structuredClone(defaultHostingPlans)

    state = {
      schemaVersion: 2,
      createdAt: meta.created_at || new Date().toISOString(),
      services: rawServices.filter((service) => service.category !== 'hosting'),
      hostingPlans,
      hostingSubscriptions,
      projects: projectRows.map((row) => row.data).filter(Boolean),
      settings: { ...structuredClone(defaultSettings), ...(settingsResult.data?.data || {}) },
      orders: orderRows.map((row) => row.data).filter(Boolean),
    }
    if (oldSchema || legacyHosting.length > 0) await saveStateToDatabase(state)
    console.log(`[supabase] Connected; loaded ${state.services.length} services, ${state.hostingPlans.length} hosting plans, ${state.hostingSubscriptions.length} hosting subscriptions, ${state.projects.length} projects and ${state.orders.length} orders.`)
    return state
  })()

  try {
    return await initPromise
  } catch (error) {
    state = null
    throw error
  } finally {
    initPromise = null
  }
}

async function snapshot() {
  await initStore()
  return structuredClone(state)
}

async function mutate(mutator) {
  const task = queue.then(async () => {
    await initStore()
    const before = structuredClone(state)
    try {
      const result = await mutator(state)
      await saveStateToDatabase(state)
      return structuredClone(result)
    } catch (error) {
      state = before
      throw error
    }
  })
  queue = task.catch(() => {})
  return task
}

module.exports = {
  defaultServices,
  defaultHostingPlans,
  defaultProjects,
  defaultSettings,
  initStore,
  snapshot,
  mutate,
}
