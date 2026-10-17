(() => {
  'use strict'

  const tg = window.Telegram?.WebApp || null
  const state = {
    config: null,
    session: null,
    currentPage: 'home',
    serviceFilter: 'all',
    selectedService: null,
    draft: null,
    screenshotDataUrl: '',
    selectedPaymentMethod: 'USDT_TON',
    toastTimer: null,
    hostingSubscriptions: [],
    hostingOrders: [],
  }
  const $ = (selector, root = document) => root.querySelector(selector)
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  }
  function money(value) {
    const number = Number(value || 0)
    return `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  function apiHeaders(json = true) {
    const headers = {}
    if (json) headers['Content-Type'] = 'application/json'
    if (tg?.initData) headers.Authorization = `tga ${tg.initData}`
    return headers
  }
  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      cache: 'no-store',
      headers: { ...apiHeaders(options.body !== undefined), ...(options.headers || {}) },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `تعذر إكمال الطلب (${response.status})`)
    return data
  }
  function toast(message) {
    const element = $('#toast')
    element.textContent = message
    element.classList.add('show')
    clearTimeout(state.toastTimer)
    state.toastTimer = setTimeout(() => element.classList.remove('show'), 2600)
  }
  function categoryLabel(category) {
    return ({ telegram_bot: 'TELEGRAM BOT', mini_app: 'TELEGRAM MINI APP', website: 'WEBSITE', hosting: 'HOSTING / استضافة' })[category] || 'DIGITAL SERVICE'
  }
  function categorySymbol(category) {
    return ({ telegram_bot: '⌘', mini_app: '▦', website: '◈', hosting: '⌂' })[category] || '✦'
  }
  function computePrice(service = state.selectedService) {
    if (!service || !state.config) return 0
    const settings = state.config.settings
    let price = Number(service.price || 0)
    if (service.category === 'telegram_bot' && $('#privateOwnership')?.checked) price += Number(settings.privateOwnershipPrice || 0)
    return Math.round(price * 100) / 100
  }
  function serviceCard(service, index = 0) {
    const includes = (service.includes || []).slice(0, 3).map((item) => `<span class="include-pill">${escapeHtml(item)}</span>`).join('')
    return `<article class="service-card ${service.featured ? 'featured' : ''}">
      <div class="service-card-top"><span class="service-icon">${escapeHtml(service.icon || categorySymbol(service.category))}</span><span class="service-category">${escapeHtml(categoryLabel(service.category))}</span></div>
      <h3>${escapeHtml(service.name)}</h3><p>${escapeHtml(service.description)}</p><div class="service-includes">${includes}</div>
      <div class="service-card-bottom"><div class="price-label"><small>${Number(service.price) === 1 || Number(service.price) === 1.5 || Number(service.price) === 2.5 || Number(service.price) === 5 ? 'سعر الخدمة' : 'يبدأ من'}</small><strong>${money(service.price)} <span>USD</span></strong></div><button type="button" class="service-choose" data-order-service="${escapeHtml(service.id)}" aria-label="اطلب ${escapeHtml(service.name)}">↙</button></div>
    </article>`
  }
  function renderServices() {
    if (!state.config) return
    const settings = state.config.settings || {}
    const services = state.config.services || []
    const filtered = state.serviceFilter === 'all'
      ? services
      : services.filter((item) => item.category === state.serviceFilter)

    const grid = $('#serviceGrid')
    if (grid) {
      grid.innerHTML = filtered.length
        ? filtered.map(serviceCard).join('')
        : '<div class="empty-state"><h3>ماكو خدمات بهذا التصنيف</h3><p>جرّب تصنيف ثاني.</p></div>'
    }

    const count = $('#countAll')
    if (count) count.textContent = String(services.length)

    const ownership = $('#privateOwnershipPrice')
    if (ownership) ownership.textContent = `+${money(settings.privateOwnershipPrice)}`

    const ads = $('#adsDisclosureMini')
    if (ads) ads.textContent = settings.adsDisclosure || ''
  }
  function projectArt(project, index) {
    const art = project.id === 'sample-karim' ? 'karim' : project.id === 'sample-storm' ? 'storm' : index % 2 ? 'storm' : 'default-art'
    let mock = ''
    if (art === 'karim') {
      mock = '<div class="mock-bar"><i></i><i></i><i></i></div><div class="mock-content"><div class="mock-label">PERSONAL / PORTFOLIO</div><div class="mock-title">KARIM<br /><em>AMASS.</em></div><div class="mock-line"></div><div class="mock-small-line"></div><div class="mock-cta"></div></div>'
    } else {
      mock = `<div class="mock-bar"><i></i><i></i><i></i></div><div class="mock-content"><div class="mock-label">${art === 'storm' ? 'STORM / DIGITAL IDENTITY' : 'CUSTOM DIGITAL PRODUCT'}</div><div class="mock-title">${art === 'storm' ? 'THE <em>STORM.</em>' : 'YOUR <em>IDEA.</em>'}</div><div class="mock-line"></div><div class="mock-small-line"></div><div class="mock-cta"></div></div>`
    }
    return `<button type="button" class="project-card" data-project-id="${escapeHtml(project.id)}" aria-label="معاينة ${escapeHtml(project.title)}">
      <div class="project-art ${art}"><div class="project-mock">${mock}</div><span class="project-arrow">↗</span></div>
      <div class="project-card-meta"><div><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.description || 'معاينة من أعمال STORM Studio')}</p></div><span class="project-type">${escapeHtml(project.type || 'عرض')}</span></div>
    </button>`
  }
  function renderProjects() {
    if (!state.config) return
    const projects = state.config.projects || []
    const build = projects.length
      ? projects.map(projectArt).join('')
      : '<div class="empty-state"><h3>المعرض قيد التحديث</h3><p>راح تظهر الأمثلة هنا قريبًا.</p></div>'

    const homeGrid = $('#homeProjectGrid')
    if (homeGrid) homeGrid.innerHTML = build

    const projectGrid = $('#projectGrid')
    if (projectGrid) projectGrid.innerHTML = build
  }
  function renderHostingPlans() {
    const grid = $('#hostingPlansGrid')
    if (!grid || !state.config) return
    const plans = state.config.hostingPlans || []
    grid.innerHTML = plans.length ? plans.map((plan) => {
      const includes = (plan.includes || []).map((item) => `<li><span>✓</span>${escapeHtml(item)}</li>`).join('')
      return `<article class="hosting-plan-card ${plan.featured ? 'featured' : ''}">
        <div class="hosting-plan-top"><span class="hosting-plan-icon">${escapeHtml(plan.icon || '⌂')}</span>${plan.featured ? '<span class="hosting-featured">اختيار مميز</span>' : '<span class="hosting-plan-tag">خطة مستقلة</span>'}</div>
        <h3>${escapeHtml(plan.name)}</h3><p>${escapeHtml(plan.description || '')}</p>
        <div class="hosting-plan-price"><strong>${money(plan.price)}</strong><span>USD</span><small>/ ${Number(plan.durationDays || 30)} يوم</small></div>
        <ul>${includes}</ul><button type="button" class="button button-primary hosting-plan-cta" data-hosting-plan="${escapeHtml(plan.id)}">اختيار الخطة <span>←</span></button>
      </article>`
    }).join('') : '<div class="empty-state"><h3>لا توجد خطط متاحة حاليًا</h3><p>ارجع لاحقًا أو تواصل مع الإدارة.</p></div>'
  }

  const HOSTING_ZIP_MAX_BYTES = 500 * 1024

  function hostingStatusText(sub) {
    if (sub.daysRemaining === 0 && sub.expiresAt) return 'انتهى الاشتراك'
    if (sub.updatePending) return 'تحديث جديد بانتظار التشغيل'
    if (sub.runtimeStatus === 'running' && sub.activeVersion) return 'يعمل الآن'
    return ({ awaiting_upload: 'بانتظار ملفات المشروع', ready_to_run: 'الملفات وصلت — بانتظار الإدارة', update_pending: 'التحديث بانتظار اعتماد الإدارة', starting: 'قيد التشغيل', stopped: 'متوقّف', expired: 'انتهت المدة' })[sub.status] || 'بانتظار مراجعة الإدارة'
  }

  function hostingSubscriptionCard(sub) {
    const isRunning = sub.runtimeStatus === 'running' && Boolean(sub.activeVersion)
    const daysText = sub.daysRemaining == null ? 'لم يبدأ العدّ بعد' : `${sub.daysRemaining} يوم متبقٍ`
    const url = /^https:\/\//i.test(sub.runtimeUrl || '') ? `<a class="hosting-live-link" href="${escapeHtml(sub.runtimeUrl)}" target="_blank" rel="noopener noreferrer">فتح المشروع ↗</a>` : ''
    const versionText = sub.latestVersion ? `النسخة ${sub.latestVersion}${sub.activeVersion ? ` · المشغلة ${sub.activeVersion}` : ''}` : 'لم يتم رفع نسخة'
    return `<article class="hosting-instance-card">
      <div class="hosting-instance-head"><span class="hosting-instance-id">#${escapeHtml(sub.serialId)}</span><span class="hosting-runtime-pill ${isRunning ? 'is-running' : ''}"><i></i>${escapeHtml(hostingStatusText(sub))}</span></div>
      <form class="hosting-upload-form" data-hosting-upload="${escapeHtml(sub.id)}">
        <div class="hosting-upload-title"><b>${isRunning ? 'رفع تحديث جديد' : 'ارفع مشروعك'}</b><small>${isRunning ? 'النسخة الحالية تستمر بالعمل حتى اعتماد التحديث.' : 'ارفع ملف ZIP واكتب متغيرات ENV؛ كل شيء يبقى خاصًا.'}</small></div>
        <label class="hosting-file-pick"><span>ملف المشروع ZIP</span><input type="file" name="zip" accept=".zip,application/zip,application/x-zip-compressed" required /><small data-file-label="zip">لم يتم اختيار ملف · الحد الأقصى 500KB</small></label>
        <label class="hosting-env-field"><span>متغيرات ENV (كتابة)</span><textarea name="envText" rows="6" maxlength="65536" dir="ltr" spellcheck="false" autocomplete="off" placeholder="BOT_TOKEN=123456:ABC&#10;ADMIN_ID=123456789" required></textarea></label>
        <button class="button button-primary" type="submit">${isRunning ? 'إرسال التحديث' : 'رفع للمراجعة'} <span>↑</span></button>
        <p class="hosting-upload-hint">ZIP بحد أقصى 500KB · ENV تكتبه هنا مباشرة بصيغة KEY=VALUE (لا ترفع ملف .env). لا تضمّن مفاتيح لا يحتاجها مشروعك.</p>
      </form>
      <div class="hosting-instance-title"><div><h3>${escapeHtml(sub.projectTitle || 'مشروع بدون اسم')}</h3><p>${escapeHtml(sub.planName || 'خطة استضافة')} · ${money(sub.priceUsd)}</p></div><span class="hosting-instance-mark">⌂</span></div>
      <div class="hosting-instance-stats"><div><small>المدة</small><b>${Number(sub.durationDays || 30)} يوم</b></div><div><small>المتبقي</small><b>${escapeHtml(daysText)}</b></div><div><small>الإصدارات</small><b>${Number(sub.latestVersion || 0)}</b></div></div>
      <div class="hosting-instance-bottom"><span>${escapeHtml(versionText)}</span>${url}</div>
    </article>`
  }

  async function loadHostingSubscriptions() {
    const container = $('#hostingSubscriptions')
    if (!container || !state.config) return
    container.innerHTML = '<div class="hosting-loading"><i></i><span>جارٍ تحميل اشتراكاتك…</span></div>'
    try {
      const [hostingData, orderData] = await Promise.all([api('/api/hosting/subscriptions'), api('/api/orders')])
      state.hostingSubscriptions = hostingData.subscriptions || []
      const existingOrderIds = new Set(state.hostingSubscriptions.map((sub) => sub.orderId))
      state.hostingOrders = (orderData.orders || []).filter((order) => order.category === 'hosting' && !existingOrderIds.has(order.id))
      const ordersHtml = state.hostingOrders.map((order) => `<article class="hosting-pending-order"><span class="hosting-pending-mark">◷</span><div><b>${escapeHtml(order.projectTitle || order.serviceName)}</b><small>الطلب ${escapeHtml(order.id)} · ${money(order.priceUsd)}</small></div><span class="hosting-pending-status">${escapeHtml(order.statusLabel || 'بانتظار الدفع')}</span></article>`).join('')
      const subsHtml = state.hostingSubscriptions.map(hostingSubscriptionCard).join('')
      container.innerHTML = `${ordersHtml}${subsHtml || ''}${!ordersHtml && !subsHtml ? '<div class="empty-state"><span class="empty-illustration">⌂</span><h3>مساحتك بانتظار أول اشتراك</h3><p>اشترِ خطة استضافة، وبعد تأكيد الدفع سيظهر اشتراكك هنا.</p></div>' : ''}`
    } catch (error) {
      container.innerHTML = `<div class="empty-state"><h3>تعذر تحميل الاشتراكات</h3><p>${escapeHtml(error.message)}</p><button class="button button-outline" id="retryHosting">إعادة المحاولة ↻</button></div>`
    }
  }

  function showPage(page) {
    if (!['home', 'services', 'hosting', 'portfolio', 'orders'].includes(page)) page = 'home'
    state.currentPage = page
    $$('.page').forEach((element) => element.classList.toggle('active-page', element.id === `page-${page}`))
    $$('[data-page]').forEach((element) => element.classList.toggle('active', element.dataset.page === page && element.classList.contains('nav-link')))
    $$('.mobile-nav-item').forEach((element) => element.classList.toggle('active', element.dataset.page === page))
    if (page === 'orders') loadOrders()
    if (page === 'services' && state.config) renderServices()
    if (page === 'hosting' && state.config) { renderHostingPlans(); loadHostingSubscriptions() }
    if (tg?.BackButton) {
      if (page !== 'home') tg.BackButton.show()
      else tg.BackButton.hide()
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function openModal(id) {
    const el = $(`#${id}`)
    if (!el) return
    el.classList.add('open')
    el.setAttribute('aria-hidden', 'false')
    document.body.style.overflow = 'hidden'
    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light')
  }
  function closeModal(id) {
    const el = $(`#${id}`)
    if (!el) return
    el.classList.remove('open')
    el.setAttribute('aria-hidden', 'true')
    if (!$('.modal-backdrop.open')) document.body.style.overflow = ''
    if (id === 'orderModal') resetOrderModal()
    if (id === 'previewModal') {
      $('#projectPreviewFrame').src = 'about:blank'
    }
  }
  function resetOrderModal() {
    $('#detailsForm').reset()
    $('#paymentForm').reset()
    $('#detailsForm').classList.remove('hidden')
    $('#paymentForm').classList.add('hidden')
    $('#orderSuccess').classList.add('hidden')
    $('#orderStepper').classList.remove('hidden')
    $$('#orderStepper .step').forEach((step, index) => step.classList.toggle('active', index === 0))
    $$('#orderStepper .step').forEach((step) => step.classList.remove('complete'))
    $('#detailsError').textContent = ''
    $('#paymentError').textContent = ''
    $('#screenshotPreview').classList.add('hidden')
    $('#screenshotFilename').textContent = ''
    $('#screenshotInput').value = ''
    state.screenshotDataUrl = ''
    state.draft = null
    state.selectedPaymentMethod = 'USDT_TON'
    $$('.payment-method').forEach((item) => item.classList.toggle('selected', $('input', item)?.value === 'USDT_TON'))
  }
  function openOrder(serviceId) {
    let service = state.config?.services?.find((item) => item.id === serviceId)
    if (!service && String(serviceId).startsWith('hosting-plan:')) {
      const planId = String(serviceId).slice('hosting-plan:'.length)
      const plan = (state.config?.hostingPlans || []).find((item) => item.id === planId)
      if (plan) service = { ...plan, id: `hosting:${plan.id}`, hostingPlanId: plan.id, category: 'hosting' }
    }
    if (!service) return toast('الخدمة غير متوفرة حاليًا.')
    state.selectedService = service
    resetOrderModal()
    const options = state.config.settings
    const isHosting = service.category === 'hosting'
    $('#orderModalTitle').textContent = isHosting ? 'طلب استضافة مستقلة' : 'خلّينا نبني فكرتك'
    const projectTitleLabel = $('#projectTitle').closest('label')?.querySelector('span')
    if (projectTitleLabel) projectTitleLabel.innerHTML = isHosting ? 'اسم البوت / الموقع المراد استضافته <b>*</b>' : 'اسم المشروع أو التطبيق <b>*</b>'
    const projectDetailsLabel = $('#projectDetails').closest('label')?.querySelector('span')
    if (projectDetailsLabel) projectDetailsLabel.innerHTML = isHosting ? 'تفاصيل الاستضافة المطلوبة <b>*</b>' : 'اشرح فكرتك بالتفصيل <b>*</b>'
    $('#projectTitle').placeholder = isHosting ? 'مثال: بوت Storm أو موقعي الشخصي' : 'مثال: Storm Rewards'
    $('#projectDetails').placeholder = isHosting ? 'اذكر نوع البوت أو المشروع وأي تفاصيل مهمة لفهم متطلبات الاستضافة...' : 'شنو تريد يصير بالمشروع؟ اذكر الأقسام والخصائص والأشياء المهمة إلك...'
    $('#selectedServiceBanner').innerHTML = `<span class="service-icon">${escapeHtml(service.icon || categorySymbol(service.category))}</span><div><h3>${escapeHtml(service.name)}</h3><p>${escapeHtml(service.description)}</p></div><strong>${money(service.price)}</strong>`
    $('#botTypeWrap').classList.toggle('hidden', service.category !== 'telegram_bot')
    $('#appPurposeWrap').classList.toggle('hidden', service.category !== 'mini_app')
    $('#websiteTypeWrap').classList.toggle('hidden', service.category !== 'website')
    $('#colorsWrap').classList.toggle('hidden', service.category !== 'mini_app')
    $('#botOptions').classList.toggle('hidden', service.category !== 'telegram_bot')
    $('#appOptions').classList.toggle('hidden', service.category !== 'mini_app')
    $('#adsDisclosureMini').classList.toggle('hidden', !(service.id.toLowerCase().includes('adsgram') || service.name.toLowerCase().includes('adsgram')))
    $('#privateOwnershipPrice').textContent = `+${money(options.privateOwnershipPrice)}`
    $('#detailsTotal').textContent = money(computePrice(service))
    if (state.session?.customer?.firstName) $('#customerName').value = state.session.customer.firstName
    if (state.session?.customer?.username) $('#customerContact').value = `@${state.session.customer.username}`
    const isAds = service.id.toLowerCase().includes('adsgram') || service.name.toLowerCase().includes('adsgram')
    $('#adsDisclosureMini').textContent = isAds ? options.adsDisclosure : ''
    updateGramChoice()
    openModal('orderModal')
  }
  function updatePrice() {
    if (state.selectedService) $('#detailsTotal').textContent = money(computePrice(state.selectedService))
  }
  function selectedPaymentMethod() {
    return $('input[name="paymentMethod"]:checked')?.value || 'USDT_TON'
  }
  function updateGramChoice() {
    if (!state.config) return
    const configured = Boolean(state.config.settings.gramConfigured)
    const label = $('#gramPaymentLabel')
    const input = $('input', label)
    input.disabled = !configured
    label.classList.toggle('disabled', !configured)
    $('#gramPaymentHint').textContent = configured ? `سعر التحويل: 1 GRAM = $${Number(state.config.settings.gramUsdRate).toFixed(6)}` : 'يتطلب ضبط سعر GRAM من الإدارة'
    if (!configured && input.checked) {
      $('input[value="USDT_TON"]', $('#paymentForm')).checked = true
      state.selectedPaymentMethod = 'USDT_TON'
    }
  }
  function showPaymentSelection() {
    state.selectedPaymentMethod = selectedPaymentMethod()
    const isGram = state.selectedPaymentMethod === 'GRAM'
    const config = state.config.settings
    const price = computePrice(state.selectedService)
    const amount = isGram ? `${(Math.ceil((price / Number(config.gramUsdRate)) * 10000) / 10000).toFixed(4)} <small>GRAM</small>` : `${money(price)} <small>USDT</small>`
    const wallet = isGram ? config.walletGram : config.walletUsdtTon
    $('#checkoutSummary').innerHTML = `<div><b>${escapeHtml(state.selectedService.name)}</b><small>السعر النهائي حسب الخيارات المختارة</small></div><strong>${money(price)}</strong>`
    $('#walletNetworkLabel').textContent = isGram ? 'عنوان محفظة GRAM' : 'عنوان محفظة USDT · TON'
    $('#walletAddressValue').textContent = wallet || 'عنوان المحفظة غير مضبوط'
    $('#paymentAmountDue').innerHTML = amount
    $('#paymentNoteText').textContent = config.paymentNote || ''
    $$('.payment-method').forEach((item) => item.classList.toggle('selected', $('input', item).value === state.selectedPaymentMethod))
  }
  async function loadOrders() {
    const container = $('#ordersContainer')
    if (!container) return
    container.innerHTML = '<div class="loading-card"></div>'
    try {
      const data = await api('/api/orders')
      if (!data.orders?.length) {
        container.innerHTML = '<div class="empty-state"><span class="empty-illustration">◷</span><h3>نرتّب لك المساحة هنا</h3><p>لما ترسل أول طلب، راح تقدر تتابع حالته من هذه الصفحة.</p><button class="button button-primary" data-page="services">تصفّح الخدمات <span>←</span></button></div>'
        return
      }
      container.innerHTML = data.orders.map(orderCard).join('')
    } catch (error) {
      container.innerHTML = `<div class="empty-state"><span class="empty-illustration">!</span><h3>تعذر تحميل الطلبات</h3><p>${escapeHtml(error.message)}</p><button class="button button-glass" id="retryOrders">إعادة المحاولة ↻</button></div>`
    }
  }
  function statusClass(status) {
    if (['PAID', 'DELIVERED'].includes(status)) return 'status-good'
    if (['IN_PROGRESS'].includes(status)) return 'status-progress'
    if (['PAYMENT_REVIEW', 'NEED_INFO'].includes(status)) return 'status-warn'
    if (['PAYMENT_REJECTED', 'REJECTED', 'CANCELLED'].includes(status)) return 'status-bad'
    return ''
  }
  function orderCard(order) {
    const created = new Date(order.createdAt).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' })
    const pay = order.paymentCurrency === 'GRAM' ? `${Number(order.paymentAmount).toFixed(4)} GRAM` : `${money(order.priceUsd)} USDT`
    const receiptButton = order.screenshotUrl ? `<a class="button button-glass button-small" href="${escapeHtml(order.screenshotUrl)}" target="_blank" rel="noopener">عرض إيصال الدفع ↗</a>` : ''
    const note = order.adminNote ? `<div class="order-note"><b>ملاحظة STORM:</b> ${escapeHtml(order.adminNote)}</div>` : ''
    return `<article class="order-card"><div class="order-card-header"><div><h3>${escapeHtml(order.projectTitle || order.serviceName)}</h3><div class="order-id">${escapeHtml(order.id)} · ${escapeHtml(created)}</div></div><span class="status-pill ${statusClass(order.status)}">${escapeHtml(order.statusLabel || order.status)}</span></div>
      <div class="order-card-body"><div class="order-meta"><small>الخدمة</small><strong>${escapeHtml(order.serviceName)}</strong></div><div class="order-meta"><small>المبلغ المرسل</small><strong>${escapeHtml(pay)}</strong></div><div class="order-meta"><small>رقم التحويل</small><strong>${escapeHtml(order.txid || '—')}</strong></div></div>${note}<div class="order-card-actions"><p>${order.status === 'PAYMENT_REVIEW' ? 'إثبات الدفع قيد المراجعة اليدوية.' : order.status === 'IN_PROGRESS' ? 'بدأ تنفيذ مشروعك.' : order.status === 'DELIVERED' ? 'تم تحديث الطلب إلى حالة التسليم.' : order.status === 'NEED_INFO' ? 'راجع ملاحظة STORM للمتابعة.' : 'آخر تحديث: ' + escapeHtml(new Date(order.updatedAt || order.createdAt).toLocaleDateString('ar'))}</p>${receiptButton}</div></article>`
  }
  function openProject(projectId) {
    const project = state.config?.projects?.find((item) => item.id === projectId)
    if (!project) return
    if (!/^https:\/\//i.test(project.url)) return toast('رابط المعاينة غير صالح.')
    $('#previewTitle').textContent = project.title
    $('#projectPreviewFrame').title = `معاينة ${project.title}`
    $('#projectPreviewFrame').src = project.url
    $('#openExternalPreview').href = project.url
    openModal('previewModal')
  }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('تعذرت قراءة الصورة. جرّب صورة ثانية.'))
      reader.onload = () => resolve(String(reader.result || ''))
      reader.readAsDataURL(file)
    })
  }
  function currentDetails() {
    const category = state.selectedService.category
    return {
      projectTitle: $('#projectTitle').value.trim(),
      details: $('#projectDetails').value.trim(),
      customerName: $('#customerName').value.trim(),
      contact: $('#customerContact').value.trim(),
      options: {
        privateOwnership: category === 'telegram_bot' && $('#privateOwnership').checked,
        hosting: false,
        botType: category === 'telegram_bot' ? $('#botType').value : '',
        appPurpose: category === 'mini_app' ? $('#appPurpose').value.trim() : '',
        websiteType: category === 'website' ? $('#websiteType').value : '',
      },
      colors: category === 'mini_app' ? [$('#colorOne').value, $('#colorTwo').value, $('#colorThree').value] : [],
    }
  }

  document.addEventListener('click', (event) => {
    const pageButton = event.target.closest('[data-page]')
    if (pageButton) {
      event.preventDefault()
      showPage(pageButton.dataset.page)
      return
    }
    const hostingPlanButton = event.target.closest('[data-hosting-plan]')
    if (hostingPlanButton) {
      openOrder(`hosting-plan:${hostingPlanButton.dataset.hostingPlan}`)
      return
    }
    const serviceButton = event.target.closest('[data-order-service]')
    if (serviceButton) {
      openOrder(serviceButton.dataset.orderService)
      return
    }
    if (event.target.closest('#retryHosting')) loadHostingSubscriptions()
    const projectButton = event.target.closest('[data-project-id]')
    if (projectButton) {
      openProject(projectButton.dataset.projectId)
      return
    }
    const closeButton = event.target.closest('[data-close-modal]')
    if (closeButton) closeModal(closeButton.dataset.closeModal)
    if (event.target.classList.contains('modal-backdrop') && event.target.classList.contains('open')) closeModal(event.target.id)
    if (event.target.closest('#retryOrders')) loadOrders()
  })
  $('#refreshHosting').addEventListener('click', loadHostingSubscriptions)
  $('#hostingSubscriptions').addEventListener('change', (event) => {
    const input = event.target.closest('input[type="file"]')
    if (!input) return
    const label = input.closest('label')?.querySelector('small')
    if (label) label.textContent = input.files?.[0]?.name || 'لم يتم اختيار ملف · الحد الأقصى 500KB'
  })
  $('#hostingSubscriptions').addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-hosting-upload]')
    if (!form) return
    event.preventDefault()
    const zipFile = form.querySelector('input[name="zip"]')?.files?.[0]
    const envText = (form.querySelector('textarea[name="envText"]')?.value || '').trim()
    const button = form.querySelector('button[type="submit"]')
    if (!zipFile || !envText) return toast('اختَر ملف ZIP واكتب متغيرات ENV قبل الرفع.')
    if (!zipFile.name.toLowerCase().endsWith('.zip') || zipFile.size > HOSTING_ZIP_MAX_BYTES) return toast('ملف ZIP يجب أن يكون صالحًا وأقل من 500KB.')
    if (new Blob([envText]).size > 64 * 1024) return toast('نص ENV يجب أن يكون أقل من 64KB.')
    button.disabled = true
    button.textContent = 'جارٍ رفع الملفات…'
    try {
      const zipDataUrl = await readFileAsDataUrl(zipFile)
      await api(`/api/hosting/subscriptions/${encodeURIComponent(form.dataset.hostingUpload)}/upload`, {
        method: 'POST', body: JSON.stringify({ zipDataUrl, envText, fileName: zipFile.name }),
      })
      toast('تم رفع الملفات بأمان وبانتظار مراجعة الإدارة.')
      await loadHostingSubscriptions()
    } catch (error) { toast(error.message) }
    finally { if (button.isConnected) { button.disabled = false; button.innerHTML = 'رفع الملفات للمراجعة <span>↑</span>' } }
  })

  $('#serviceFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]')
    if (!button) return
    state.serviceFilter = button.dataset.filter
    $$('#serviceFilters [data-filter]').forEach((item) => item.classList.toggle('active', item === button))
    renderServices()
  })
  $('#privateOwnership').addEventListener('change', updatePrice)
  $('#detailsForm').addEventListener('submit', (event) => {
    event.preventDefault()
    if (!state.selectedService) return
    const draft = currentDetails()
    if (draft.projectTitle.length < 2 || draft.details.length < 12) {
      $('#detailsError').textContent = 'اكتب اسم المشروع واشرح الفكرة بتفاصيل أكثر.'
      return
    }
    state.draft = draft
    $('#detailsError').textContent = ''
    $('#detailsForm').classList.add('hidden')
    $('#paymentForm').classList.remove('hidden')
    $$('#orderStepper .step').forEach((step, index) => {
      step.classList.toggle('active', index === 1)
      step.classList.toggle('complete', index === 0)
    })
    showPaymentSelection()
    $('#orderModal .modal-panel').scrollTop = 0
  })
  $('#paymentForm').addEventListener('change', (event) => {
    if (event.target.name === 'paymentMethod') {
      state.selectedPaymentMethod = selectedPaymentMethod()
      showPaymentSelection()
    }
  })
  $('#backToDetails').addEventListener('click', () => {
    $('#paymentForm').classList.add('hidden')
    $('#detailsForm').classList.remove('hidden')
    $$('#orderStepper .step').forEach((step, index) => { step.classList.toggle('active', index === 0); step.classList.toggle('complete', false) })
    $('#orderModal .modal-panel').scrollTop = 0
  })
  $('#screenshotInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    state.screenshotDataUrl = ''
    $('#screenshotPreview').classList.add('hidden')
    $('#screenshotFilename').textContent = ''
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      event.target.value = ''
      return toast('اختَر صورة PNG أو JPG أو WebP.')
    }
    if (file.size > 6 * 1024 * 1024) {
      event.target.value = ''
      return toast('حجم الصورة أكبر من 6MB.')
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      state.screenshotDataUrl = dataUrl
      $('#screenshotPreview').src = dataUrl
      $('#screenshotPreview').classList.remove('hidden')
      $('#screenshotFilename').textContent = file.name
    } catch (error) { toast(error.message) }
  })
  $('#copyWalletButton').addEventListener('click', async () => {
    const address = $('#walletAddressValue').textContent
    try {
      await navigator.clipboard.writeText(address)
      toast('تم نسخ عنوان المحفظة.')
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = address
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      textArea.remove()
      toast('تم نسخ عنوان المحفظة.')
    }
  })
  $('#paymentForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    const errorBox = $('#paymentError')
    const submitButton = $('#submitOrderButton')
    errorBox.textContent = ''
    const txid = $('#txidInput').value.trim()
    if (txid.length < 4) { errorBox.textContent = 'أدخل رقم التحويل TXID.'; return }
    if (!state.screenshotDataUrl) { errorBox.textContent = 'ارفق لقطة شاشة واضحة للتحويل.'; return }
    const method = selectedPaymentMethod()
    if (method === 'GRAM' && !state.config.settings.gramConfigured) { errorBox.textContent = 'الدفع بـ GRAM غير متاح حتى يضبط الأدمن سعر التحويل.'; return }
    submitButton.disabled = true
    submitButton.innerHTML = 'جارٍ إرسال الطلب… <span>↻</span>'
    try {
      const result = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: state.selectedService.id,
          hostingPlanId: state.selectedService.hostingPlanId || '',
          ...state.draft,
          paymentMethod: method,
          txid,
          screenshotDataUrl: state.screenshotDataUrl,
        }),
      })
      $('#detailsForm').classList.add('hidden')
      $('#paymentForm').classList.add('hidden')
      $('#orderStepper').classList.add('hidden')
      $('#orderSuccess').classList.remove('hidden')
      $('#successOrderNumber').textContent = result.order.id
      $('#orderModal .modal-panel').scrollTop = 0
      if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success')
    } catch (error) {
      errorBox.textContent = error.message
    } finally {
      submitButton.disabled = false
      submitButton.innerHTML = 'إرسال الطلب والإيصال <span>↗</span>'
    }
  })
  $('#goToOrders').addEventListener('click', () => {
    const hostingPurchase = state.selectedService?.category === 'hosting'
    closeModal('orderModal')
    showPage(hostingPurchase ? 'hosting' : 'orders')
  })
  $('#refreshOrders').addEventListener('click', loadOrders)
  $('#profileButton').addEventListener('click', () => {
    const person = state.session?.customer
    toast(person ? `أهلًا ${person.firstName || person.username || ''} — طلباتك تظهر في صفحة طلباتي.` : 'طلبات المتصفح مرتبطة بهذا الجهاز. افتح التطبيق من تيليجرام لتفعيل هوية حسابك.')
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const open = $('.modal-backdrop.open')
      if (open) closeModal(open.id)
    }
  })
  if (tg) {
    try {
      tg.ready()
      tg.expand()
      tg.setHeaderColor?.('#0a1120')
      tg.setBackgroundColor?.('#0a1120')
            tg.setBottomBarColor?.('#0a1120')
tg.BackButton?.onClick(() => showPage('home'))
    } catch {}
  }

  // STORM_TELEGRAM_SPLASH_BOOT: wait for Telegram verification and store data.
  async function init() {
    const boot = window.StormBoot
    $('#yearNow').textContent = String(new Date().getFullYear())
    if (!tg || typeof tg.initData !== 'string' || !tg.initData.trim()) {
      boot?.deny('افتح STORM Studio من داخل تيليجرام', 'هذا المتجر يعمل كتطبيق Telegram Mini App فقط. ارجع إلى محادثة بوت STORM واضغط زر فتح التطبيق؛ فتح الرابط من Chrome أو أي متصفح خارجي غير مدعوم.')
      return
    }
    try {
      boot?.progress(16, 'التحقق من جلسة تيليجرام')
      state.session = await api('/api/session')
      if (!state.session?.authenticatedInTelegram) {
        if (state.session && !state.session.botConfigured) boot?.fail('إعداد البوت غير مكتمل', 'لم يستطع الخادم التحقق من جلسة تيليجرام. تأكد من ضبط BOT_TOKEN الصحيح في متغيرات البيئة ثم أعد النشر.')
        else boot?.deny('تعذر التحقق من جلسة تيليجرام', 'ارجع إلى محادثة بوت STORM وافتح التطبيق من زر Mini App داخل تيليجرام، ثم حاول مجددًا.')
        return
      }
      if (state.session.customer?.firstName) $('#profileInitial').textContent = state.session.customer.firstName.slice(0, 1).toUpperCase()
      boot?.progress(42, 'تحميل الخدمات والإعدادات')
      state.config = await api('/api/config')
      document.title = `${state.config.studio.name || 'STORM Studio'} — فكرتك تصير منتج`
      boot?.progress(70, 'تجهيز كتالوج الخدمات')
      renderServices()
      renderProjects()
      renderHostingPlans()
      updateGramChoice()
      boot?.progress(92, 'ترتيب واجهة المتجر')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      boot?.complete()
    } catch (error) {
      boot?.fail('تعذر تحميل STORM Studio', `${error.message || 'حدث خطأ غير متوقع.'} تأكد من اتصال الإنترنت وإعدادات البوت ثم أعد المحاولة.`)
    }
  }
  init()
})()
