(() => {
  'use strict'
  const $ = (selector, root = document) => root.querySelector(selector)
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]
  const state = {
    secret: sessionStorage.getItem('storm_admin_secret') || '',
    overview: null,
    orders: [],
    services: [],
    projects: [],
    hostingPlans: [],
    hostingSubscriptions: [],
    hostingOrders: [],
    settings: null,
    currentView: 'overview',
    modalType: null,
    modalRecord: null,
    loadingOrders: false,
    searchTimer: null,
    toastTimer: null,
  }
  const statusLabels = {
    PAYMENT_REVIEW: 'بانتظار مراجعة الدفع', PAYMENT_REJECTED: 'إثبات الدفع مرفوض', PAID: 'تم تأكيد الدفع',
    IN_PROGRESS: 'قيد التنفيذ', NEED_INFO: 'بانتظار معلومات', DELIVERED: 'تم التسليم', REJECTED: 'مرفوض', CANCELLED: 'ملغي',
  }
  const categoryLabels = { telegram_bot: 'TELEGRAM BOT', mini_app: 'TELEGRAM MINI APP', website: 'WEBSITE', hosting: 'HOSTING / استضافة' }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  }
  function money(value) {
    return `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  async function api(url, options = {}) {
    const headers = { 'x-admin-secret': state.secret, ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (response.status === 401 || response.status === 503) {
        sessionStorage.removeItem('storm_admin_secret')
        state.secret = ''
      }
      throw new Error(data.error || `فشل الاتصال (${response.status})`)
    }
    return data
  }
  function toast(message) {
    const element = $('#adminToast')
    element.textContent = message
    element.classList.add('show')
    clearTimeout(state.toastTimer)
    state.toastTimer = setTimeout(() => element.classList.remove('show'), 2600)
  }
  function statusClass(status) {
    if (['PAID', 'DELIVERED'].includes(status)) return 'good'
    if (status === 'IN_PROGRESS') return 'progress'
    if (['PAYMENT_REVIEW', 'NEED_INFO'].includes(status)) return 'warn'
    if (['PAYMENT_REJECTED', 'REJECTED', 'CANCELLED'].includes(status)) return 'bad'
    return ''
  }
  function statusSelectHtml(value) {
    return Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`).join('')
  }
  function categorySymbol(category) { return ({ telegram_bot: '⌘', mini_app: '▦', website: '◈', hosting: '⌂' })[category] || '✦' }
  function showLogin(error = '') {
    $('#loginScreen').classList.remove('hidden')
    $('#adminApp').classList.add('hidden')
    $('#loginError').textContent = error
  }
  async function enterAdmin(secret) {
    state.secret = secret
    const overview = await api('/api/admin/overview')
    state.overview = overview
    sessionStorage.setItem('storm_admin_secret', secret)
    $('#loginScreen').classList.add('hidden')
    $('#adminApp').classList.remove('hidden')
    $('#loginError').textContent = ''
    await loadOverview()
    goView('overview')
  }
  function logout() {
    state.secret = ''
    sessionStorage.removeItem('storm_admin_secret')
    state.overview = null
    state.orders = []
    $('#adminSecretInput').value = ''
    showLogin('')
    $('#adminSecretInput').focus()
  }
  async function loadOverview() {
    const [overview, health] = await Promise.all([api('/api/admin/overview'), api('/api/health').catch(() => null)])
    state.overview = overview
    $('#metricTotalOrders').textContent = String(overview.totalOrders)
    $('#metricPending').textContent = String(overview.pendingPayments)
    $('#metricInProgress').textContent = String(overview.inProgress)
    $('#metricRevenue').textContent = money(overview.totalRevenue)
    $('#pendingNavCount').textContent = String(overview.pendingPayments)
    $('#healthDescription').textContent = health?.ok ? `يعمل منذ ${health.uptime} ثانية` : 'تعذر فحص الاتصال'
    renderRecentOrders(overview.recentOrders || [])
    const settings = state.settings || (await api('/api/admin/settings')).settings
    state.settings = settings
    renderSystemChecks(settings)
  }
  function renderSystemChecks(settings) {
    const checks = [
      { label: 'عنوان محفظة USDT · TON', ok: Boolean(settings.walletUsdtTon), detail: settings.walletUsdtTon ? 'العنوان مضبوط' : 'أدخل عنوان المحفظة من الإعدادات' },
      { label: 'إشعارات تيليجرام', ok: Boolean(settings.adminNotificationsConfigured), detail: settings.adminNotificationsConfigured ? 'البوت ومعرّف الأدمن مضبوطين' : 'أضف BOT_TOKEN و ADMIN_TELEGRAM_ID في Dokploy' },
      { label: 'دفع GRAM', ok: Boolean(settings.gramConfigured), detail: settings.gramConfigured ? `1 GRAM = $${Number(settings.gramUsdRate).toFixed(6)}` : 'موقوف إلى أن تضبط سعر GRAM' },
    ]
    $('#systemChecks').innerHTML = checks.map((item) => `<div class="system-check ${item.ok ? 'ok' : 'warn'}"><span>${item.ok ? '✓' : '!'}</span><div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></div></div>`).join('')
  }
  function renderRecentOrders(orders) {
    if (!orders.length) {
      $('#recentOrders').innerHTML = '<div class="empty-table">ما وصلت طلبات بعد. راح تظهر هنا أول ما يستقبل المتجر طلبًا جديدًا.</div>'
      return
    }
    $('#recentOrders').innerHTML = orders.map((order) => `<button class="recent-item" type="button" data-open-order="${escapeHtml(order.id)}"><span class="recent-avatar">${escapeHtml(categorySymbol(order.category))}</span><span class="recent-info"><b>${escapeHtml(order.projectTitle || order.serviceName)}</b><small>${escapeHtml(order.id)} · ${escapeHtml(new Date(order.createdAt).toLocaleDateString('ar'))}</small></span><span class="recent-price">${money(order.priceUsd)}</span><span class="status-chip ${statusClass(order.status)}">${escapeHtml(statusLabels[order.status] || order.status)}</span></button>`).join('')
  }
  function goView(view, filterStatus = '') {
    if (!['overview', 'orders', 'services', 'hosting', 'projects', 'settings'].includes(view)) view = 'overview'
    state.currentView = view
    $$('.admin-view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`))
    $$('.side-link[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view))
    $('#currentViewTitle').textContent = ({ overview: 'نظرة عامة', orders: 'الطلبات والمدفوعات', services: 'الخدمات والأسعار', hosting: 'الاستضافة والاشتراكات', projects: 'معرض الأعمال', settings: 'إعدادات المتجر' })[view]
    $('#sidebar').classList.remove('open')
    if (view === 'overview') loadOverview().catch(showApiError)
    if (view === 'orders') {
      if (filterStatus) $('#orderStatusFilter').value = filterStatus
      loadOrders().catch(showApiError)
    }
    if (view === 'services') loadServices().catch(showApiError)
    if (view === 'hosting') loadHosting().catch(showApiError)
    if (view === 'projects') loadProjects().catch(showApiError)
    if (view === 'settings') loadSettings().catch(showApiError)
  }
  function showApiError(error) { toast(error?.message || 'تعذر إكمال العملية.') }

  async function loadOrders() {
    if (state.loadingOrders) return
    state.loadingOrders = true
    $('#ordersTableWrap').innerHTML = '<div class="table-loading"></div>'
    try {
      const params = new URLSearchParams()
      params.set('status', $('#orderStatusFilter').value || 'ALL')
      params.set('q', $('#orderSearch').value.trim())
      const data = await api(`/api/admin/orders?${params.toString()}`)
      state.orders = data.orders || []
      renderOrders()
    } finally { state.loadingOrders = false }
  }
  function orderRow(order) {
    const amount = order.paymentCurrency === 'GRAM' ? `${Number(order.paymentAmount).toFixed(4)} GRAM` : `${money(order.priceUsd)} USDT`
    return `<tr><td><div class="table-main"><span class="table-icon">${escapeHtml(categorySymbol(order.category))}</span><div><b>${escapeHtml(order.projectTitle || order.serviceName)}</b><small>${escapeHtml(order.id)}</small></div></div></td><td>${escapeHtml(order.customerName || 'غير محدد')}<br /><small class="table-mono">${escapeHtml(order.contact || order.telegramId || '—')}</small></td><td><span class="table-mono">${escapeHtml(amount)}</span></td><td><span class="status-chip ${statusClass(order.status)}">${escapeHtml(statusLabels[order.status] || order.status)}</span></td><td><span class="table-mono">${escapeHtml(new Date(order.createdAt).toLocaleDateString('ar'))}</span></td><td><div class="table-actions"><button class="tiny-button important" data-open-order="${escapeHtml(order.id)}">التفاصيل</button>${order.screenshotUrl ? `<a class="tiny-button" href="${escapeHtml(order.screenshotUrl)}" target="_blank" rel="noopener">الإيصال ↗</a>` : ''}</div></td></tr>`
  }
  function mobileOrderCard(order) {
    const amount = order.paymentCurrency === 'GRAM' ? `${Number(order.paymentAmount).toFixed(4)} GRAM` : `${money(order.priceUsd)} USDT`
    return `<article class="mobile-order-card"><div class="mobile-order-top"><div><b>${escapeHtml(order.projectTitle || order.serviceName)}</b><small>${escapeHtml(order.id)} · ${escapeHtml(new Date(order.createdAt).toLocaleDateString('ar'))}</small></div><span class="status-chip ${statusClass(order.status)}">${escapeHtml(statusLabels[order.status] || order.status)}</span></div><div class="mobile-order-grid"><div><small>العميل</small><b>${escapeHtml(order.customerName || 'غير محدد')}</b></div><div><small>المبلغ</small><b>${escapeHtml(amount)}</b></div><div><small>وسيلة التواصل</small><b>${escapeHtml(order.contact || order.telegramId || '—')}</b></div><div><small>TXID</small><b>${escapeHtml(order.txid || '—')}</b></div></div><div class="mobile-order-actions"><button class="tiny-button important" data-open-order="${escapeHtml(order.id)}">فتح التفاصيل</button>${order.screenshotUrl ? `<a class="tiny-button" href="${escapeHtml(order.screenshotUrl)}" target="_blank" rel="noopener">عرض الإيصال ↗</a>` : ''}</div></article>`
  }
  function renderOrders() {
    $('#ordersResultsCount').textContent = `${state.orders.length} طلب`
    if (!state.orders.length) {
      $('#ordersTableWrap').innerHTML = '<div class="empty-table">لا توجد طلبات مطابقة للفلاتر الحالية.</div>'
      return
    }
    $('#ordersTableWrap').innerHTML = `<div class="table-scroll"><table class="admin-table"><thead><tr><th>المشروع / الخدمة</th><th>العميل</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th><th>الإجراء</th></tr></thead><tbody>${state.orders.map(orderRow).join('')}</tbody></table></div><div class="mobile-order-cards">${state.orders.map(mobileOrderCard).join('')}</div>`
  }
  function openAdminModal({ type, record = null, title, kicker = 'STORM / EDIT', content }) {
    state.modalType = type
    state.modalRecord = record
    $('#editModalKicker').textContent = kicker
    $('#editModalTitle').textContent = title
    $('#editModalContent').innerHTML = content
    $('#editModal').classList.add('open')
    $('#editModal').setAttribute('aria-hidden', 'false')
    document.body.style.overflow = 'hidden'
  }
  function closeAdminModal() {
    $('#editModal').classList.remove('open')
    $('#editModal').setAttribute('aria-hidden', 'true')
    document.body.style.overflow = ''
    state.modalType = null
    state.modalRecord = null
  }
  function closeButtonHandler(event) {
    if (event.target.closest('[data-close-admin-modal]')) closeAdminModal()
    if (event.target === $('#editModal')) closeAdminModal()
  }
  function orderDetailContent(order) {
    const amount = order.paymentCurrency === 'GRAM' ? `${Number(order.paymentAmount).toFixed(4)} GRAM (≈ ${money(order.priceUsd)})` : `${money(order.priceUsd)} USDT`
    const screenshot = order.screenshotUrl ? `<img class="receipt-preview" src="${escapeHtml(order.screenshotUrl)}" alt="إثبات دفع ${escapeHtml(order.id)}" /><div class="receipt-actions"><a class="tiny-button" href="${escapeHtml(order.screenshotUrl)}" target="_blank" rel="noopener">فتح الصورة الأصلية ↗</a><button type="button" class="tiny-button" data-copy-value="${escapeHtml(order.txid || '')}">نسخ TXID</button></div>` : '<div class="empty-table">لم يتم إرفاق صورة إيصال بهذا الطلب.</div>'
    const options = []
    if (order.options?.privateOwnership) options.push('بدون حقوق STORM')
    if (order.options?.hosting) options.push('استضافة شهرية')
    if (order.options?.botType) options.push(`نوع البوت: ${order.options.botType}`)
    if (order.options?.websiteType) options.push(`نوع الموقع: ${order.options.websiteType}`)
    if (order.options?.appPurpose) options.push(`فكرة التطبيق: ${order.options.appPurpose}`)
    const colors = (order.colors || []).map((color) => `<i title="${escapeHtml(color)}" style="background:${escapeHtml(color)}"></i>`).join('')
    return `<div class="order-detail"><div class="detail-topline"><div><h3>${escapeHtml(order.projectTitle || order.serviceName)}</h3><small>${escapeHtml(order.id)} · ${escapeHtml(new Date(order.createdAt).toLocaleString('ar'))}</small></div><span class="status-chip ${statusClass(order.status)}">${escapeHtml(statusLabels[order.status] || order.status)}</span></div>
      <div class="detail-grid"><div class="detail-field"><small>الخدمة</small><b>${escapeHtml(order.serviceName)}</b></div><div class="detail-field"><small>السعر</small><b>${escapeHtml(amount)}</b></div><div class="detail-field"><small>اسم العميل</small><b>${escapeHtml(order.customerName || 'غير محدد')}</b></div><div class="detail-field"><small>التواصل</small><b>${escapeHtml(order.contact || '—')}</b></div><div class="detail-field"><small>Telegram ID</small><code>${escapeHtml(order.telegramId || 'طلب متصفح')}</code></div><div class="detail-field"><small>طريقة الدفع</small><b>${escapeHtml(order.paymentMethodLabel || (order.paymentMethod === 'GRAM' ? 'GRAM' : 'USDT · TON'))}</b></div><div class="detail-field"><small>TXID</small><code>${escapeHtml(order.txid || '—')}</code></div><div class="detail-field"><small>عنوان المحفظة المستخدم</small><code>${escapeHtml(order.walletAddress || '—')}</code></div></div>
      <div class="detail-description"><h4>تفاصيل المشروع</h4><p>${escapeHtml(order.details || '—')}</p></div>${options.length ? `<div class="detail-options">${options.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}${colors ? `<div class="detail-colors"><span>ألوان التطبيق:</span>${colors}</div>` : ''}<div class="detail-description"><h4>TXID / إثبات الدفع</h4>${screenshot}</div>
      <form id="orderUpdateForm"><div class="order-admin-actions"><label><span>حالة الطلب</span><select name="status" class="admin-select">${statusSelectHtml(order.status)}</select></label><label><span>ملاحظة للعميل (اختياري)</span><textarea name="adminNote" class="admin-textarea" rows="2" maxlength="2500" placeholder="مثال: تم تأكيد الدفع، بدأ التنفيذ...">${escapeHtml(order.adminNote || '')}</textarea></label></div><div class="modal-form-actions"><span class="left-actions"><button type="button" class="tiny-button" data-close-admin-modal>إلغاء</button></span><button type="submit" class="primary-button">حفظ وتحديث الطلب <span>✓</span></button></div></form></div>`
  }
  function openOrderDetail(orderId) {
    let order = state.orders.find((item) => item.id === orderId)
    if (!order) order = state.overview?.recentOrders?.find((item) => item.id === orderId)
    if (!order) {
      api('/api/admin/orders?status=ALL&q=' + encodeURIComponent(orderId)).then((data) => {
        const found = data.orders.find((item) => item.id === orderId)
        if (!found) return toast('الطلب غير موجود.')
        state.orders = [found, ...state.orders.filter((item) => item.id !== found.id)]
        openOrderDetail(orderId)
      }).catch(showApiError)
      return
    }
    openAdminModal({ type: 'order', record: order, title: 'تفاصيل الطلب', kicker: 'ORDER / PAYMENT REVIEW', content: orderDetailContent(order) })
  }
  async function saveOrderUpdate(event) {
    event.preventDefault()
    const form = event.target
    if (form.id !== 'orderUpdateForm') return
    const order = state.modalRecord
    const button = $('button[type="submit"]', form)
    button.disabled = true
    try {
      const result = await api(`/api/admin/orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: form.elements.status.value, adminNote: form.elements.adminNote.value.trim() }),
      })
      const updated = result.order
      state.orders = state.orders.map((item) => item.id === updated.id ? { ...item, ...updated, statusLabel: statusLabels[updated.status] } : item)
      if (state.overview?.recentOrders) state.overview.recentOrders = state.overview.recentOrders.map((item) => item.id === updated.id ? { ...item, ...updated, statusLabel: statusLabels[updated.status] } : item)
      closeAdminModal()
      toast('تم تحديث حالة الطلب وإرسال التنبيه إن كان متاحًا.')
      await Promise.all([loadOrders(), loadOverview(), loadHosting().catch(() => null)])
    } catch (error) { toast(error.message) }
    finally { button.disabled = false }
  }

  async function loadServices() {
    const data = await api('/api/admin/services')
    state.services = data.services || []
    renderAdminServices()
  }
  function renderAdminServices() {
    if (!state.services.length) {
      $('#adminServicesGrid').innerHTML = '<div class="empty-table">ماكو خدمات مضافة. أضف أول خدمة من الزر أعلاه.</div>'
      return
    }
    $('#adminServicesGrid').innerHTML = state.services.map((service) => `<article class="admin-service-card"><div class="admin-service-top"><span class="admin-service-icon">${escapeHtml(service.icon || categorySymbol(service.category))}</span><div class="admin-service-title"><h3>${escapeHtml(service.name)}</h3><small>${escapeHtml(categoryLabels[service.category] || service.category)} · ${escapeHtml(service.id)}</small></div><span class="active-tag ${service.active ? '' : 'off'}">${service.active ? 'ظاهر' : 'مخفي'}</span></div><p class="admin-service-description">${escapeHtml(service.description || '')}</p><div class="admin-service-meta"><div class="admin-service-price"><small>السعر الأساسي</small><b>${money(service.price)}</b></div><div class="admin-service-actions"><button class="tiny-button" data-edit-service="${escapeHtml(service.id)}">تعديل</button><button class="tiny-button ${service.active ? 'danger' : 'important'}" data-toggle-service="${escapeHtml(service.id)}">${service.active ? 'تعطيل' : 'تفعيل'}</button><button class="tiny-button danger" data-delete-service="${escapeHtml(service.id)}">حذف</button></div></div>${service.includes?.length ? `<div class="admin-service-includes">${service.includes.slice(0,6).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}</article>`).join('')
  }
  function serviceFormHtml(service = {}) {
    const isNew = !service.id
    const category = service.category || 'telegram_bot'
    return `<form id="serviceEditForm" class="modal-form"><div class="modal-form-grid"><label class="admin-field full"><span>اسم الخدمة</span><input name="name" maxlength="120" value="${escapeHtml(service.name || '')}" required placeholder="مثال: بوت متجر تيليجرام" /></label><label class="admin-field"><span>التصنيف</span><select name="category" required><option value="telegram_bot" ${category === 'telegram_bot' ? 'selected' : ''}>بوت تيليجرام</option><option value="mini_app" ${category === 'mini_app' ? 'selected' : ''}>Mini App</option><option value="website" ${category === 'website' ? 'selected' : ''}>Website</option></select></label><label class="admin-field"><span>السعر الأساسي بالدولار</span><input name="price" type="number" min="0" max="100000" step="0.01" value="${escapeHtml(service.price ?? '1.00')}" required /></label><label class="admin-field"><span>رمز الخدمة (اختياري)</span><input name="icon" maxlength="12" value="${escapeHtml(service.icon || '✦')}" placeholder="✦" /></label><label class="admin-field"><span>ترتيب العرض</span><input name="sortOrder" type="number" min="0" max="999" value="${escapeHtml(service.sortOrder ?? 99)}" /></label><label class="admin-field full"><span>الوصف الظاهر للعميل</span><textarea name="description" rows="3" maxlength="900" required>${escapeHtml(service.description || '')}</textarea></label><label class="admin-field full"><span>مزايا مختصرة (افصل بينها بفاصلة)</span><input name="includes" value="${escapeHtml((service.includes || []).join(', '))}" placeholder="تصميم مخصص، اختبار، تسليم" /></label><label class="admin-check-row"><input type="checkbox" name="featured" ${service.featured ? 'checked' : ''} /> إبراز الخدمة بالصفحة الرئيسية</label><label class="admin-check-row"><input type="checkbox" name="active" ${isNew || service.active !== false ? 'checked' : ''} /> إظهار الخدمة في المتجر</label></div><div class="modal-form-actions"><button type="button" class="tiny-button" data-close-admin-modal>إلغاء</button><button type="submit" class="primary-button">${isNew ? 'إضافة الخدمة' : 'حفظ التعديلات'} <span>✓</span></button></div></form>`
  }
  function openServiceForm(id = '') {
    const service = id ? state.services.find((item) => item.id === id) : null
    if (id && !service) return toast('الخدمة غير موجودة.')
    openAdminModal({ type: 'service', record: service, title: service ? 'تعديل الخدمة' : 'إضافة خدمة جديدة', kicker: 'SERVICE CATALOG', content: serviceFormHtml(service || {}) })
  }
  async function saveServiceForm(event) {
    event.preventDefault()
    const form = event.target
    if (form.id !== 'serviceEditForm') return
    const data = new FormData(form)
    const payload = {
      name: data.get('name'), category: data.get('category'), price: Number(data.get('price')),
      icon: data.get('icon') || '✦', sortOrder: Number(data.get('sortOrder') || 99),
      description: data.get('description'), includes: String(data.get('includes') || '').split(',').map((x) => x.trim()).filter(Boolean),
      featured: data.get('featured') === 'on', active: data.get('active') === 'on',
    }
    const id = state.modalRecord?.id
    const button = $('button[type="submit"]', form)
    button.disabled = true
    try {
      await api(id ? `/api/admin/services/${encodeURIComponent(id)}` : '/api/admin/services', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      closeAdminModal()
      toast(id ? 'تم حفظ الخدمة.' : 'تمت إضافة الخدمة.')
      await Promise.all([loadServices(), loadOverview()])
    } catch (error) { toast(error.message) }
    finally { button.disabled = false }
  }
  async function toggleService(id) {
    const service = state.services.find((item) => item.id === id)
    if (!service) return
    try {
      await api(`/api/admin/services/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: !service.active }) })
      toast(service.active ? 'تم إخفاء الخدمة من المتجر.' : 'تم إظهار الخدمة للعميل.')
      await Promise.all([loadServices(), loadOverview()])
    } catch (error) { toast(error.message) }
  }
  async function deleteService(id) {
    const service = state.services.find((item) => item.id === id)
    if (!service || !confirm(`حذف/تعطيل خدمة «${service.name}»؟ إذا لديها طلبات سابقة ستُخفى فقط للحفاظ على سجل الطلبات.`)) return
    try {
      const result = await api(`/api/admin/services/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast(result.deactivated ? 'الخدمة لها طلبات سابقة؛ تم تعطيلها بدل حذفها.' : 'تم حذف الخدمة.')
      await Promise.all([loadServices(), loadOverview()])
    } catch (error) { toast(error.message) }
  }

  async function loadProjects() {
    const data = await api('/api/admin/projects')
    state.projects = data.projects || []
    renderAdminProjects()
  }
  function renderAdminProjects() {
    if (!state.projects.length) {
      $('#adminProjectsGrid').innerHTML = '<div class="empty-table">ماكو مشاريع بالمعرض. أضف رابط معاينة جديدًا.</div>'
      return
    }
    $('#adminProjectsGrid').innerHTML = state.projects.map((project) => `<article class="admin-project-card"><div class="project-admin-top"><div><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.type || 'مشروع')} · ${escapeHtml(project.description || '')}</p></div><span class="active-tag ${project.active ? '' : 'off'}">${project.active ? 'ظاهر' : 'مخفي'}</span></div><div class="project-admin-url">${escapeHtml(project.url)}</div><div class="project-admin-actions"><a class="tiny-button" href="${escapeHtml(project.url)}" target="_blank" rel="noopener">فتح المعاينة ↗</a><button class="tiny-button" data-edit-project="${escapeHtml(project.id)}">تعديل</button><button class="tiny-button ${project.active ? 'danger' : 'important'}" data-toggle-project="${escapeHtml(project.id)}">${project.active ? 'إخفاء' : 'إظهار'}</button><button class="tiny-button danger" data-delete-project="${escapeHtml(project.id)}">حذف</button></div></article>`).join('')
  }
  function projectFormHtml(project = {}) {
    const isNew = !project.id
    return `<form id="projectEditForm" class="modal-form"><div class="modal-form-grid"><label class="admin-field full"><span>اسم المشروع</span><input name="title" maxlength="150" value="${escapeHtml(project.title || '')}" required /></label><label class="admin-field"><span>نوع المشروع</span><input name="type" maxlength="100" value="${escapeHtml(project.type || 'موقع شخصي')}" /></label><label class="admin-field"><span>ترتيب العرض</span><input name="sortOrder" type="number" min="0" max="999" value="${escapeHtml(project.sortOrder ?? 99)}" /></label><label class="admin-field full"><span>رابط المعاينة (HTTPS)</span><input name="url" type="url" dir="ltr" value="${escapeHtml(project.url || '')}" required placeholder="https://example.com" /></label><label class="admin-field full"><span>وصف مختصر</span><textarea name="description" rows="2" maxlength="500">${escapeHtml(project.description || '')}</textarea></label><label class="admin-check-row"><input type="checkbox" name="active" ${isNew || project.active !== false ? 'checked' : ''} /> إظهار هذا المثال في المتجر</label></div><div class="modal-form-actions"><button type="button" class="tiny-button" data-close-admin-modal>إلغاء</button><button type="submit" class="primary-button">${isNew ? 'إضافة المشروع' : 'حفظ المشروع'} <span>✓</span></button></div></form>`
  }
  function openProjectForm(id = '') {
    const project = id ? state.projects.find((item) => item.id === id) : null
    if (id && !project) return toast('المشروع غير موجود.')
    openAdminModal({ type: 'project', record: project, title: project ? 'تعديل المشروع' : 'إضافة مشروع', kicker: 'PORTFOLIO / PREVIEW', content: projectFormHtml(project || {}) })
  }
  async function saveProjectForm(event) {
    event.preventDefault()
    const form = event.target
    if (form.id !== 'projectEditForm') return
    const data = new FormData(form)
    const payload = { title: data.get('title'), type: data.get('type'), sortOrder: Number(data.get('sortOrder') || 99), url: data.get('url'), description: data.get('description'), active: data.get('active') === 'on' }
    const id = state.modalRecord?.id
    const button = $('button[type="submit"]', form)
    button.disabled = true
    try {
      await api(id ? `/api/admin/projects/${encodeURIComponent(id)}` : '/api/admin/projects', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      closeAdminModal()
      toast(id ? 'تم تحديث المشروع.' : 'تمت إضافة المشروع.')
      await Promise.all([loadProjects(), loadOverview()])
    } catch (error) { toast(error.message) }
    finally { button.disabled = false }
  }
  async function toggleProject(id) {
    const project = state.projects.find((item) => item.id === id)
    if (!project) return
    try {
      await api(`/api/admin/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: !project.active }) })
      toast(project.active ? 'تم إخفاء المشروع.' : 'تم إظهار المشروع.')
      await loadProjects()
    } catch (error) { toast(error.message) }
  }
  async function deleteProject(id) {
    const project = state.projects.find((item) => item.id === id)
    if (!project || !confirm(`حذف المثال «${project.title}» من معرض الأعمال؟`)) return
    try {
      await api(`/api/admin/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast('تم حذف المثال.')
      await Promise.all([loadProjects(), loadOverview()])
    } catch (error) { toast(error.message) }
  }

  async function loadHosting() {
    const plansGrid = $('#adminHostingPlansGrid')
    const ordersBox = $('#adminHostingOrders')
    const subsBox = $('#adminHostingSubscriptions')
    if (plansGrid) plansGrid.innerHTML = '<div class="table-loading"></div>'
    if (ordersBox) ordersBox.innerHTML = '<div class="table-loading"></div>'
    if (subsBox) subsBox.innerHTML = '<div class="table-loading"></div>'
    const data = await api('/api/admin/hosting')
    state.hostingPlans = data.plans || []
    state.hostingSubscriptions = data.subscriptions || []
    state.hostingOrders = (data.orders || []).filter((order) => order.paymentStatus !== 'APPROVED')
    const warning = $('#hostingRunnerWarning')
    if (warning) {
      warning.classList.add('is-ready')
      warning.innerHTML = '<b>إدارة يدوية للاستضافة</b><p>نزّل ZIP وراجع نص ENV، ثم ارفع المشروع وشغّله على استضافتك بنفسك. بعد التأكد أنه يعمل اضغط «تأكيد التشغيل وتفعيل الاشتراك». لا يحتاج هذا المسار إلى HOSTING_RUNNER_URL.</p>'
    }
    const navCount = $('#hostingNavCount')
    if (navCount) navCount.textContent = String(state.hostingSubscriptions.filter((sub) => !['expired', 'stopped'].includes(sub.status)).length)
    renderHostingPlans()
    renderHostingOrders()
    renderHostingSubscriptions()
  }

  function renderHostingPlans() {
    const container = $('#adminHostingPlansGrid')
    if (!container) return
    if (!state.hostingPlans.length) {
      container.innerHTML = '<div class="empty-table">لا توجد خطط استضافة بعد. أضف أول خطة من الزر أعلاه.</div>'
      return
    }
    container.innerHTML = state.hostingPlans.map((plan) => `<article class="admin-hosting-plan-card">
      <div class="admin-hosting-plan-head"><span class="admin-hosting-plan-icon">${escapeHtml(plan.icon || '⌂')}</span><div><h3>${escapeHtml(plan.name)}</h3><small>${Number(plan.durationDays || 30)} يوم · ${escapeHtml(plan.id)}</small></div><span class="active-tag ${plan.active ? '' : 'off'}">${plan.active ? 'متاحة' : 'مخفية'}</span></div>
      <p>${escapeHtml(plan.description || '')}</p><div class="admin-hosting-plan-price"><b>${money(plan.price)}</b><small>${(plan.includes || []).length} مزايا</small></div>
      <div class="admin-hosting-actions"><button class="tiny-button" data-edit-hosting-plan="${escapeHtml(plan.id)}">تعديل</button><button class="tiny-button ${plan.active ? 'danger' : 'important'}" data-toggle-hosting-plan="${escapeHtml(plan.id)}">${plan.active ? 'إخفاء' : 'تفعيل'}</button><button class="tiny-button danger" data-delete-hosting-plan="${escapeHtml(plan.id)}">حذف</button></div>
    </article>`).join('')
  }

  function hostingAdminStatus(sub) {
    if (sub.daysRemaining === 0 && sub.expiresAt) return 'منتهي'
    if (sub.updatePending || sub.status === 'update_pending') return 'تحديث بانتظار اعتمادك'
    if (sub.runtimeStatus === 'running' && sub.activeVersion) return 'يعمل الآن'
    return ({ awaiting_upload: 'بانتظار الملفات', ready_to_run: 'الملفات جاهزة للمراجعة', update_pending: 'تحديث بانتظار اعتمادك', starting: 'قيد التشغيل', stopped: 'متوقف', expired: 'منتهي' })[sub.status] || 'قيد المراجعة'
  }

  function renderHostingOrders() {
    const container = $('#adminHostingOrders')
    if (!container) return
    if (!state.hostingOrders.length) {
      container.innerHTML = '<div class="empty-table">لا توجد طلبات استضافة بانتظار تأكيد الدفع.</div>'
      return
    }
    container.innerHTML = state.hostingOrders.map((order) => `<article class="admin-hosting-order"><span class="admin-hosting-plan-icon">⌂</span><div class="admin-hosting-order-main"><b>${escapeHtml(order.projectTitle || order.serviceName || 'طلب استضافة')}</b><small>${escapeHtml(order.orderId || order.id)} · ${escapeHtml(order.customerName || 'عميل غير محدد')} · ${escapeHtml(order.statusLabel || order.status)}</small><small>${escapeHtml(order.contact || order.telegramId || 'لا توجد وسيلة تواصل')}</small></div><strong>${money(order.priceUsd)}</strong><button class="tiny-button important" data-open-order="${escapeHtml(order.id)}">مراجعة الطلب</button></article>`).join('')
  }

  function renderHostingSubscriptions() {
    const container = $('#adminHostingSubscriptions')
    if (!container) return
    if (!state.hostingSubscriptions.length) {
      container.innerHTML = '<div class="empty-table">لا توجد اشتراكات مؤكدة بعد. عند اعتماد دفع خطة استضافة، يظهر الاشتراك هنا.</div>'
      return
    }
    container.innerHTML = state.hostingSubscriptions.map((sub) => {
      const latest = Number(sub.latestVersion || 0)
      const active = Number(sub.activeVersion || 0)
      const expiry = sub.expiresAt ? new Date(sub.expiresAt).toLocaleString('ar') : 'لم يبدأ احتساب المدة بعد'
      const versions = (sub.versions || []).map((version) => `<span>v${Number(version.version)} · ${escapeHtml(version.fileName || 'project.zip')} · ${escapeHtml(new Date(version.uploadedAt).toLocaleDateString('ar'))}</span>`).join('')
      const isRunning = sub.runtimeStatus === 'running'
      const isStarting = sub.runtimeStatus === 'starting'
      return `<article class="admin-hosting-instance">
        <div class="admin-hosting-instance-top"><span class="admin-hosting-number">اشتراك #${escapeHtml(sub.serialId)}</span><span class="status-chip ${isRunning ? 'good' : sub.status === 'expired' ? 'bad' : 'warn'}">${escapeHtml(hostingAdminStatus(sub))}</span><span class="admin-hosting-when">أُنشئ ${escapeHtml(new Date(sub.createdAt).toLocaleDateString('ar'))}</span></div>
        <div class="admin-hosting-instance-title"><div><h3>${escapeHtml(sub.projectTitle || 'مشروع بدون اسم')}</h3><p>${escapeHtml(sub.planName || 'خطة الاستضافة')} · ${money(sub.priceUsd)} · ${Number(sub.durationDays || 30)} يوم</p><small>العميل: ${escapeHtml(sub.customerName || 'غير محدد')} · ${escapeHtml(sub.contact || sub.telegramId || 'لا يوجد تواصل')}</small><small>ينتهي: ${escapeHtml(expiry)} · الإصدارات: ${latest} · المشغّلة: ${active || 'لا يوجد'}</small></div><span class="admin-hosting-instance-symbol">⌂</span></div>
        <div class="admin-hosting-version-bar"><b>سجل النسخ</b>${versions || '<span class="hosting-no-files">لم يرفع العميل الملفات بعد</span>'}</div>
        <div class="admin-hosting-instance-actions"><button class="tiny-button" data-download-hosting="${escapeHtml(sub.id)}" ${latest ? '' : 'disabled'}>تنزيل ZIP</button><button class="tiny-button" data-edit-hosting-env="${escapeHtml(sub.id)}" ${latest ? '' : 'disabled'}>عرض / تعديل ENV</button><button class="tiny-button" data-extend-hosting="${escapeHtml(sub.id)}">إضافة أيام</button>${latest && (!isRunning || sub.updatePending || Number(sub.activeVersion || 0) !== latest) ? `<button class="tiny-button important" data-run-hosting="${escapeHtml(sub.id)}">${isRunning ? 'تأكيد تشغيل التحديث' : 'تأكيد التشغيل وتفعيل الاشتراك'}</button>` : ''}${isRunning ? `<button class="tiny-button danger" data-stop-hosting="${escapeHtml(sub.id)}">تسجيل الإيقاف</button>` : ''}</div>
      </article>`
    }).join('')
  }

  function hostingPlanFormHtml(plan = {}) {
    const isNew = !plan.id
    return `<form id="hostingPlanForm" class="modal-form"><div class="modal-form-grid">
      <label class="admin-field full"><span>اسم الخطة</span><input name="name" maxlength="120" required value="${escapeHtml(plan.name || '')}" placeholder="مثال: استضافة بوت أساسية" /></label>
      <label class="admin-field full"><span>الوصف</span><textarea name="description" maxlength="1000" rows="3">${escapeHtml(plan.description || '')}</textarea></label>
      <label class="admin-field"><span>السعر بالدولار</span><input name="price" type="number" min="0" max="100000" step="0.01" required value="${escapeHtml(plan.price ?? '2.50')}" /></label>
      <label class="admin-field"><span>مدة الاشتراك بالأيام</span><input name="durationDays" type="number" min="1" max="3650" required value="${escapeHtml(plan.durationDays ?? 30)}" /></label>
      <label class="admin-field"><span>الأيقونة</span><input name="icon" maxlength="12" value="${escapeHtml(plan.icon || '⌂')}" /></label>
      <label class="admin-field"><span>ترتيب العرض</span><input name="sortOrder" type="number" min="0" max="999" value="${escapeHtml(plan.sortOrder ?? 99)}" /></label>
      <label class="admin-field full"><span>المزايا (افصل بينها بفاصلة)</span><input name="includes" value="${escapeHtml((plan.includes || []).join(', '))}" placeholder="30 يومًا، رفع التحديثات، متابعة الحالة" /></label>
      <label class="admin-check-row"><input name="featured" type="checkbox" ${plan.featured ? 'checked' : ''} /> إبراز الخطة</label>
      <label class="admin-check-row"><input name="active" type="checkbox" ${isNew || plan.active !== false ? 'checked' : ''} /> إظهارها للعملاء</label>
    </div><div class="modal-form-actions"><button type="button" class="tiny-button" data-close-admin-modal>إلغاء</button><button type="submit" class="primary-button">${isNew ? 'إنشاء الخطة' : 'حفظ الخطة'} <span>✓</span></button></div></form>`
  }

  function openHostingPlanForm(id = '') {
    const plan = id ? state.hostingPlans.find((item) => item.id === id) : null
    if (id && !plan) return toast('خطة الاستضافة غير موجودة.')
    openAdminModal({ type: 'hosting-plan', record: plan, title: plan ? 'تعديل خطة الاستضافة' : 'إضافة خطة استضافة', kicker: 'HOSTING / PLAN', content: hostingPlanFormHtml(plan || {}) })
  }

  async function saveHostingPlanForm(event) {
    event.preventDefault()
    const form = event.target
    if (form.id !== 'hostingPlanForm') return
    const data = new FormData(form)
    const payload = { name: data.get('name'), description: data.get('description'), price: Number(data.get('price')), durationDays: Number(data.get('durationDays')), icon: data.get('icon'), sortOrder: Number(data.get('sortOrder') || 99), includes: String(data.get('includes') || '').split(',').map((item) => item.trim()).filter(Boolean), featured: data.get('featured') === 'on', active: data.get('active') === 'on' }
    const id = state.modalRecord?.id
    const button = $('button[type="submit"]', form)
    button.disabled = true
    try {
      await api(id ? `/api/admin/hosting/plans/${encodeURIComponent(id)}` : '/api/admin/hosting/plans', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      closeAdminModal(); toast(id ? 'تم تحديث خطة الاستضافة.' : 'تمت إضافة خطة استضافة.')
      await loadHosting()
    } catch (error) { toast(error.message) }
    finally { button.disabled = false }
  }

  async function toggleHostingPlan(id) {
    const plan = state.hostingPlans.find((item) => item.id === id)
    if (!plan) return
    try { await api(`/api/admin/hosting/plans/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: !plan.active }) }); toast(plan.active ? 'تم إخفاء الخطة.' : 'تم تفعيل الخطة.'); await loadHosting() }
    catch (error) { toast(error.message) }
  }

  async function deleteHostingPlan(id) {
    const plan = state.hostingPlans.find((item) => item.id === id)
    if (!plan || !confirm(`حذف خطة «${plan.name}»؟ إذا استُخدمت سابقًا سيتم إخفاؤها فقط.`)) return
    try { await api(`/api/admin/hosting/plans/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('تمت معالجة الخطة.'); await loadHosting() }
    catch (error) { toast(error.message) }
  }

  async function showHostingEnv(id) {
    try {
      const result = await api(`/api/admin/hosting/${encodeURIComponent(id)}/env`)
      const sub = state.hostingSubscriptions.find((item) => item.id === id)
      openAdminModal({ type: 'hosting-env', record: sub, title: `ENV — اشتراك #${sub?.serialId || ''}`, kicker: 'PRIVATE ENVIRONMENT', content: `<form id="hostingEnvForm" class="modal-form"><div class="hosting-env-warning">هذه القيم سرّية. لا تشاركها مع أحد. بعد حفظها، اضغط تشغيل / تحديث النسخة لتطبيقها.</div><label class="admin-field"><span>محتوى ملف ENV · النسخة ${Number(result.version)}</span><textarea name="envText" id="hostingEnvText" rows="14" dir="ltr" spellcheck="false" autocomplete="off" required>${escapeHtml(result.envText || '')}</textarea></label><div class="modal-form-actions"><button type="button" class="tiny-button" data-close-admin-modal>إلغاء</button><button type="submit" class="primary-button">حفظ ENV <span>✓</span></button></div></form>` })
    } catch (error) { toast(error.message) }
  }

  async function saveHostingEnvForm(event) {
    event.preventDefault()
    const form = event.target
    if (form.id !== 'hostingEnvForm') return
    const sub = state.modalRecord
    if (!sub?.id) return toast('الاشتراك غير محدد.')
    const button = $('button[type="submit"]', form)
    button.disabled = true
    try {
      await api(`/api/admin/hosting/${encodeURIComponent(sub.id)}/env`, { method: 'PATCH', body: JSON.stringify({ envText: form.elements.envText.value }) })
      closeAdminModal(); toast('تم حفظ ENV. أعد التشغيل لتطبيق القيم الجديدة.')
    } catch (error) { toast(error.message) }
    finally { button.disabled = false }
  }

  async function downloadHostingZip(id) {
    try {
      const response = await fetch(`/api/admin/hosting/${encodeURIComponent(id)}/download?version=latest`, { credentials: 'same-origin', headers: { 'x-admin-secret': state.secret }, cache: 'no-store' })
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `فشل التنزيل (${response.status})`) }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `hosting-${id}.zip`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
    } catch (error) { toast(error.message) }
  }

  async function runHosting(id) {
    const sub = state.hostingSubscriptions.find((item) => item.id === id)
    if (!sub) return toast('لم يتم العثور على الاشتراك.')
    if (!confirm('هل رفعت المشروع على استضافتك وشغّلته وتأكدت أنه يعمل؟ عند المتابعة سيتم تفعيل الاشتراك وتبدأ المدة إذا كان هذا أول تشغيل.')) return
    const currentUrl = sub.runtimeUrl || ''
    const runtimeUrl = prompt('رابط المشروع HTTPS (اختياري)، أو اتركه فارغًا:', currentUrl)
    if (runtimeUrl === null) return
    const button = $(`[data-run-hosting="${id}"]`)
    if (button) { button.disabled = true; button.textContent = 'جارٍ التفعيل…' }
    try {
      const result = await api(`/api/admin/hosting/${encodeURIComponent(id)}/activate`, { method: 'POST', body: JSON.stringify({ runtimeUrl: runtimeUrl.trim() }) })
      toast(result.message || 'تم تفعيل الاشتراك يدويًا.')
      await loadHosting()
    } catch (error) { toast(error.message) }
    finally { if (button?.isConnected) { button.disabled = false; button.textContent = 'تأكيد التشغيل وتفعيل الاشتراك' } }
  }

  async function stopHosting(id) {
    if (!confirm('هل أوقفت المشروع فعلًا من لوحة استضافتك؟ سيتم تسجيل الاشتراك كمتوقف في STORM.')) return
    try { const result = await api(`/api/admin/hosting/${encodeURIComponent(id)}/stop`, { method: 'POST', body: JSON.stringify({}) }); toast(result.message || 'تم تسجيل الإيقاف.'); await loadHosting() }
    catch (error) { toast(error.message) }
  }

  async function extendHosting(id) {
    const days = Number(prompt('كم يومًا تريد إضافته للاشتراك؟', '30'))
    if (!Number.isInteger(days) || days < 1 || days > 3650) return toast('أدخل عدد أيام صحيحًا بين 1 و3650.')
    try { await api(`/api/admin/hosting/${encodeURIComponent(id)}/extend`, { method: 'PATCH', body: JSON.stringify({ days }) }); toast(`تم تمديد الاشتراك ${days} يومًا.`); await loadHosting() }
    catch (error) { toast(error.message) }
  }

  async function loadSettings() {
    const data = await api('/api/admin/settings')
    state.settings = data.settings
    const s = data.settings
    $('#settingWalletUsdtTon').value = s.walletUsdtTon || ''
    $('#settingWalletGram').value = s.walletGram || ''
    $('#settingGramUsdRate').value = Number(s.gramUsdRate || 0)
    $('#settingPrivatePrice').value = Number(s.privateOwnershipPrice || 0)
    $('#settingStudioName').value = s.studioName || ''
    $('#settingTagline').value = s.tagline || ''
    $('#settingPaymentNote').value = s.paymentNote || ''
    $('#settingAdsDisclosure').value = s.adsDisclosure || ''
    $('#settingsEnvStatus').innerHTML = [
      ['BOT_TOKEN', s.botConfigured], ['WEBAPP_URL', s.webappUrlConfigured], ['ADMIN_TELEGRAM_ID + إشعارات', s.adminNotificationsConfigured],
    ].map(([label, okay]) => `<span class="env-pill ${okay ? 'ok' : 'warn'}">${okay ? '✓' : '!'} ${escapeHtml(label)}: ${okay ? 'مضبوط' : 'يحتاج ضبط في Dokploy'}</span>`).join('')
    renderSystemChecks(s)
  }
  async function saveSettings(event) {
    event.preventDefault()
    const button = $('#saveSettingsButton')
    const status = $('#settingsSaveStatus')
    status.textContent = ''
    button.disabled = true
    const payload = {
      walletUsdtTon: $('#settingWalletUsdtTon').value.trim(),
      walletGram: $('#settingWalletGram').value.trim(),
      gramUsdRate: $('#settingGramUsdRate').value,
      privateOwnershipPrice: $('#settingPrivatePrice').value,
      studioName: $('#settingStudioName').value.trim(),
      tagline: $('#settingTagline').value.trim(),
      paymentNote: $('#settingPaymentNote').value,
      adsDisclosure: $('#settingAdsDisclosure').value,
    }
    try {
      const result = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) })
      state.settings = result.settings
      status.textContent = 'تم الحفظ ✓'
      toast('تم حفظ إعدادات المتجر.')
      await loadOverview()
    } catch (error) { status.textContent = error.message; toast(error.message) }
    finally { button.disabled = false }
  }
  async function copyValue(value) {
    if (!value) return toast('ماكو قيمة لنسخها.')
    try { await navigator.clipboard.writeText(value); toast('تم النسخ.') }
    catch { toast('تعذر النسخ التلقائي؛ انسخ النص من التفاصيل.') }
  }

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = $('#loginButton')
    const secret = $('#adminSecretInput').value
    $('#loginError').textContent = ''
    button.disabled = true
    button.textContent = 'جارٍ التحقق…'
    try { await enterAdmin(secret) }
    catch (error) { showLogin(error.message) }
    finally { button.disabled = false; button.innerHTML = 'دخول آمن <span>←</span>' }
  })
  $('#logoutButton').addEventListener('click', logout)
  $('#newServiceButton').addEventListener('click', () => openServiceForm())
  $('#newProjectButton').addEventListener('click', () => openProjectForm())
  $('#newHostingPlanButton').addEventListener('click', () => openHostingPlanForm())
  $('#refreshHostingAdminButton').addEventListener('click', () => loadHosting().then(() => toast('تم تحديث الاستضافة.')).catch(showApiError))
  $('#refreshOrdersButton').addEventListener('click', () => loadOrders().then(() => toast('تم تحديث الطلبات.')).catch(showApiError))
  $('#refreshCurrentButton').addEventListener('click', () => {
    const action = { overview: loadOverview, orders: loadOrders, services: loadServices, hosting: loadHosting, projects: loadProjects, settings: loadSettings }[state.currentView]
    action?.().then(() => toast('تم التحديث.')).catch(showApiError)
  })
  $('#mobileMenuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'))
  $('#orderStatusFilter').addEventListener('change', () => loadOrders().catch(showApiError))
  $('#orderSearch').addEventListener('input', () => {
    clearTimeout(state.searchTimer)
    state.searchTimer = setTimeout(() => loadOrders().catch(showApiError), 300)
  })
  $('#settingsForm').addEventListener('submit', saveSettings)
  document.addEventListener('submit', (event) => {
    if (event.target.id === 'orderUpdateForm') saveOrderUpdate(event)
    if (event.target.id === 'serviceEditForm') saveServiceForm(event)
    if (event.target.id === 'projectEditForm') saveProjectForm(event)
    if (event.target.id === 'hostingPlanForm') saveHostingPlanForm(event)
    if (event.target.id === 'hostingEnvForm') saveHostingEnvForm(event)
  })
  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]')
    if (viewButton) {
      event.preventDefault()
      goView(viewButton.dataset.view, viewButton.dataset.status || '')
      return
    }
    const editHostingPlan = event.target.closest('[data-edit-hosting-plan]')
    if (editHostingPlan) return openHostingPlanForm(editHostingPlan.dataset.editHostingPlan)
    const toggleHosting = event.target.closest('[data-toggle-hosting-plan]')
    if (toggleHosting) return toggleHostingPlan(toggleHosting.dataset.toggleHostingPlan)
    const deleteHosting = event.target.closest('[data-delete-hosting-plan]')
    if (deleteHosting) return deleteHostingPlan(deleteHosting.dataset.deleteHostingPlan)
    const envButton = event.target.closest('[data-edit-hosting-env]')
    if (envButton) return showHostingEnv(envButton.dataset.editHostingEnv)
    const downloadHosting = event.target.closest('[data-download-hosting]')
    if (downloadHosting) return downloadHostingZip(downloadHosting.dataset.downloadHosting)
    const runHostingButton = event.target.closest('[data-run-hosting]')
    if (runHostingButton) return runHosting(runHostingButton.dataset.runHosting)
    const stopHostingButton = event.target.closest('[data-stop-hosting]')
    if (stopHostingButton) return stopHosting(stopHostingButton.dataset.stopHosting)
    const extendHostingButton = event.target.closest('[data-extend-hosting]')
    if (extendHostingButton) return extendHosting(extendHostingButton.dataset.extendHosting)
    const openOrder = event.target.closest('[data-open-order]')
    if (openOrder) return openOrderDetail(openOrder.dataset.openOrder)
    const editService = event.target.closest('[data-edit-service]')
    if (editService) return openServiceForm(editService.dataset.editService)
    const toggleServiceButton = event.target.closest('[data-toggle-service]')
    if (toggleServiceButton) return toggleService(toggleServiceButton.dataset.toggleService)
    const deleteServiceButton = event.target.closest('[data-delete-service]')
    if (deleteServiceButton) return deleteService(deleteServiceButton.dataset.deleteService)
    const editProject = event.target.closest('[data-edit-project]')
    if (editProject) return openProjectForm(editProject.dataset.editProject)
    const toggleProjectButton = event.target.closest('[data-toggle-project]')
    if (toggleProjectButton) return toggleProject(toggleProjectButton.dataset.toggleProject)
    const deleteProjectButton = event.target.closest('[data-delete-project]')
    if (deleteProjectButton) return deleteProject(deleteProjectButton.dataset.deleteProject)
    const copyButton = event.target.closest('[data-copy-value]')
    if (copyButton) return copyValue(copyButton.dataset.copyValue)
    if (event.target.closest('[data-close-admin-modal]')) closeAdminModal()
  })
  $('#editModal').addEventListener('click', closeButtonHandler)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#editModal').classList.contains('open')) closeAdminModal()
  })

  async function init() {
    if (!state.secret) return showLogin('')
    $('#adminSecretInput').value = state.secret
    try { await enterAdmin(state.secret) }
    catch (error) { showLogin(error.message) }
  }
  init()
})()
