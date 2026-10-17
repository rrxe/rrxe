const fs = require('node:fs/promises')
const path = require('node:path')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class TelegramBot {
  constructor(token) {
    this.token = token
    this.baseUrl = `https://api.telegram.org/bot${token}`
    this.handlers = new Map()
    this.errorHandler = (error) => console.error('[telegram] bot error:', error.message)
    this.running = false
    this.offset = 0
    this.abortController = null
    this.telegram = {
      sendMessage: (chatId, text, extra = {}) => this.call('sendMessage', { chat_id: chatId, text, ...extra }),
      sendPhoto: (chatId, photo, extra = {}) => this.sendPhoto(chatId, photo, extra),
      setChatMenuButton: (payload) => this.call('setChatMenuButton', { menu_button: payload.menuButton || payload.menu_button }),
    }
  }

  start(handler) { this.handlers.set('start', handler); return this }
  command(command, handler) { this.handlers.set(String(command).replace(/^\//, ''), handler); return this }
  catch(handler) { this.errorHandler = handler; return this }

  async call(method, payload = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(35000),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API ${method} failed (${response.status})`)
    return data.result
  }

  async sendPhoto(chatId, photo, extra = {}) {
    const sourcePath = photo && typeof photo === 'object' ? photo.source : photo
    const buffer = Buffer.isBuffer(sourcePath) ? sourcePath : await fs.readFile(path.resolve(String(sourcePath)))
    const requestedFilename = photo && typeof photo === 'object' && typeof photo.filename === 'string' ? photo.filename : ''
    const filename = requestedFilename ? path.basename(requestedFilename) : (typeof sourcePath === 'string' ? path.basename(sourcePath) : 'receipt.jpg')
    const extension = path.extname(filename).toLowerCase()
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('photo', new Blob([buffer], { type: mime }), filename)
    for (const [key, value] of Object.entries(extra || {})) {
      if (value === undefined || value === null) continue
      form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    const response = await fetch(`${this.baseUrl}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(35000) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram sendPhoto failed (${response.status})`)
    return data.result
  }

  async launch() {
    if (this.running) return
    this.running = true
    this.pollTask = this.pollLoop().catch((error) => {
      if (this.running) this.errorHandler(error)
    })
  }

  async pollLoop() {
    while (this.running) {
      this.abortController = new AbortController()
      try {
        const response = await fetch(`${this.baseUrl}/getUpdates?offset=${this.offset}&timeout=20&allowed_updates=%5B%22message%22%5D`, {
          signal: this.abortController.signal,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.ok) throw new Error(data.description || `Telegram getUpdates failed (${response.status})`)
        for (const update of data.result || []) {
          this.offset = Math.max(this.offset, Number(update.update_id) + 1)
          if (!this.running) break
          try { await this.handleUpdate(update) }
          catch (error) { this.errorHandler(error) }
        }
      } catch (error) {
        if (!this.running) break
        if (error.name !== 'AbortError') this.errorHandler(error)
        await sleep(1800)
      }
    }
  }

  async handleUpdate(update) {
    const message = update.message
    if (!message || !message.chat || !message.from) return
    const text = String(message.text || '').trim()
    if (!text.startsWith('/')) return
    const command = text.split(/\s+/)[0].split('@')[0].slice(1).toLowerCase()
    const handler = this.handlers.get(command)
    if (!handler) return
    const ctx = {
      update,
      message,
      from: message.from,
      chat: message.chat,
      reply: (replyText, extra = {}) => this.telegram.sendMessage(message.chat.id, replyText, extra),
    }
    await handler(ctx)
  }

  stop() {
    this.running = false
    this.abortController?.abort()
  }
}

const Markup = {
  button: {
    webApp: (text, url) => ({ text, web_app: { url } }),
  },
  inlineKeyboard: (buttons) => ({ reply_markup: { inline_keyboard: [buttons] } }),
}

module.exports = { TelegramBot, Markup }
