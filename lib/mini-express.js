const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { URL } = require('node:url')

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
}

function parseLimit(value, fallback = 1024 * 1024) {
  if (typeof value === 'number') return value
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(value || ''))
  if (!match) return fallback
  const scale = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[(match[2] || 'b').toLowerCase()]
  return Math.floor(Number(match[1]) * scale)
}

function parseCookiesAndQuery(req) {
  const fullUrl = new URL(req.url, 'http://localhost')
  req.path = decodeURI(fullUrl.pathname)
  req.query = Object.fromEntries(fullUrl.searchParams.entries())
  req.originalUrl = req.url
  req.secure = Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
  req.params = {}
}

function addResponseHelpers(res) {
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => {
    if (res.writableEnded) return res
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8')
    const output = JSON.stringify(body)
    res.setHeader('Content-Length', Buffer.byteLength(output))
    res.end(output)
    return res
  }
  res.append = (name, value) => {
    const current = res.getHeader(name)
    if (current === undefined) res.setHeader(name, value)
    else res.setHeader(name, Array.isArray(current) ? [...current, value] : [current, value])
    return res
  }
  res.send = (body) => {
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (!res.hasHeader('Content-Length')) res.setHeader('Content-Length', Buffer.byteLength(body))
      res.end(body)
    } else res.json(body)
    return res
  }
  res.sendFile = (filePath, callback) => {
    const absolute = path.resolve(filePath)
    fs.stat(absolute, (error, stat) => {
      if (error || !stat.isFile()) {
        if (callback) return callback(error || new Error('File not found'))
        if (!res.writableEnded) res.status(404).end('Not found')
        return
      }
      res.setHeader('Content-Type', contentTypes[path.extname(absolute).toLowerCase()] || 'application/octet-stream')
      res.setHeader('Content-Length', stat.size)
      const stream = fs.createReadStream(absolute)
      stream.on('error', (streamError) => {
        if (callback) callback(streamError)
        else if (!res.writableEnded) res.destroy(streamError)
      })
      stream.pipe(res)
      stream.on('end', () => { if (callback) callback(null) })
    })
    return res
  }
}

function createApp() {
  const layers = []
  const app = function appHandler(req, res) { void req; void res }
  app.set = () => app
  app.disable = () => app
  app.enable = () => app

  function normalizeUseArgs(pathOrFn, rest) {
    if (typeof pathOrFn === 'string') return { prefix: pathOrFn, handlers: rest }
    return { prefix: '/', handlers: [pathOrFn, ...rest] }
  }

  app.use = (pathOrFn, ...rest) => {
    const { prefix, handlers } = normalizeUseArgs(pathOrFn, rest)
    for (const handler of handlers) layers.push({ type: 'middleware', prefix, handler })
    return app
  }
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all', 'head', 'options']) {
    app[method] = (pattern, ...handlers) => {
      layers.push({ type: 'route', method: method.toUpperCase(), pattern, handlers })
      return app
    }
  }
  app.listen = (port, hostname, callback) => {
    if (typeof hostname === 'function') { callback = hostname; hostname = undefined }
    const server = http.createServer((req, res) => {
      addResponseHelpers(res)
      parseCookiesAndQuery(req)
      req.body = {}
      const method = req.method.toUpperCase()
      let index = 0
      let activeError = null
      const dispatch = (error) => {
        if (res.writableEnded || res.destroyed) return
        if (error) activeError = error
        while (index < layers.length) {
          const layer = layers[index++]
          const isErrorHandler = layer.type === 'middleware' && layer.handler.length === 4
          if (activeError && !isErrorHandler) continue
          if (!activeError && isErrorHandler) continue
          if (layer.type === 'route') {
            if (layer.method !== 'ALL' && layer.method !== method && !(method === 'HEAD' && layer.method === 'GET')) continue
            const params = matchRoute(layer.pattern, req.path)
            if (!params) continue
            req.params = params
            let handlerIndex = 0
            const nextRoute = (routeError) => {
              if (routeError) { activeError = routeError; return dispatch(routeError) }
              const handler = layer.handlers[handlerIndex++]
              if (!handler) return dispatch()
              invoke(handler, req, res, nextRoute)
            }
            nextRoute()
            return
          }
          const prefix = layer.prefix || '/'
          const matched = prefix === '/' || req.path === prefix || req.path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
          if (!matched) continue
          if (activeError && layer.handler.length !== 4) continue
          const priorPath = req.path
          if (prefix !== '/' && prefix !== '') req.path = req.path.slice(prefix.length) || '/'
          const handler = layer.handler
          const next = (nextError) => {
            req.path = priorPath
            if (nextError) activeError = nextError
            dispatch(nextError)
          }
          invoke(handler, req, res, next, activeError, () => { req.path = priorPath })
          return
        }
        if (res.writableEnded) return
        if (activeError) {
          const err = activeError
          res.statusCode = err.status || err.statusCode || 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: err.statusCode === 413 || err.type === 'entity.too.large' ? 'Payload too large' : 'Internal server error' }))
        } else {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Not found' }))
        }
      }
      dispatch()
    })
    server.listen(port, hostname, callback)
    return server
  }
  return app
}

function invoke(handler, req, res, next, error, restorePath) {
  let called = false
  const safeNext = (nextError) => {
    if (called) return
    called = true
    if (restorePath) restorePath()
    next(nextError)
  }
  try {
    const result = handler.length === 4 ? handler(error, req, res, safeNext) : handler(req, res, safeNext)
    if (result && typeof result.then === 'function') result.catch(safeNext)
  } catch (caught) { safeNext(caught) }
}

function matchRoute(pattern, pathname) {
  if (pattern === '*wildcard' || pattern === '/{*wildcard}' || pattern === '/*wildcard') return { wildcard: pathname.slice(1).split('/') }
  const patternParts = String(pattern).split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null
  const params = {}
  for (let i = 0; i < patternParts.length; i++) {
    const wanted = patternParts[i]
    const found = pathParts[i]
    if (wanted.startsWith(':')) {
      try { params[wanted.slice(1)] = decodeURIComponent(found) } catch { params[wanted.slice(1)] = found }
    } else if (wanted !== found) return null
  }
  if (!patternParts.length && pathname === '/') return params
  return params
}

function json(options = {}) {
  const limit = parseLimit(options.limit, 100 * 1024)
  return async (req, res, next) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (req.method === 'GET' || req.method === 'HEAD' || !['application/json', 'application/*+json'].includes(type)) return next()
    if (req._bodyParsed) return next()
    req._bodyParsed = true
    try {
      const raw = await readRequestBody(req, limit)
      req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {}
      next()
    } catch (error) {
      if (error.type === 'entity.too.large') error.status = 413
      else { error.status = 400; error.message = 'Invalid JSON body' }
      next(error)
    }
  }
}

function urlencoded(options = {}) {
  const limit = parseLimit(options.limit, 100 * 1024)
  return async (req, res, next) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (req.method === 'GET' || req.method === 'HEAD' || type !== 'application/x-www-form-urlencoded') return next()
    if (req._bodyParsed) return next()
    req._bodyParsed = true
    try {
      const raw = await readRequestBody(req, limit)
      const params = new URLSearchParams(raw.toString('utf8'))
      req.body = Object.fromEntries(params.entries())
      next()
    } catch (error) { next(error) }
  }
}

function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let length = 0
    let tooLarge = Number(req.headers['content-length'] || 0) > limit
    req.on('data', (chunk) => {
      if (tooLarge) return
      length += chunk.length
      if (length > limit) {
        tooLarge = true
        chunks.length = 0
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('Payload too large')
        error.status = 413
        error.statusCode = 413
        error.type = 'entity.too.large'
        reject(error)
      } else resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
    req.on('aborted', () => reject(new Error('Request aborted')))
  })
}

function staticFiles(root, options = {}) {
  const absoluteRoot = path.resolve(root)
  const maxAge = options.maxAge ? parseDuration(options.maxAge) : 0
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let requestPath
    try { requestPath = decodeURIComponent(req.path) } catch { return next() }
    if (requestPath.includes('\0')) return next()
    let relative = requestPath.replace(/^\/+/, '')
    if (!relative) {
      if (options.index === false) return next()
      relative = typeof options.index === 'string' ? options.index : 'index.html'
    } else if (requestPath.endsWith('/')) {
      if (options.index === false) return next()
      relative = path.join(relative, typeof options.index === 'string' ? options.index : 'index.html')
    }
    const target = path.resolve(absoluteRoot, relative)
    if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${path.sep}`)) return next()
    try {
      const stat = await fsp.stat(target)
      if (!stat.isFile()) return next()
      res.setHeader('Content-Type', contentTypes[path.extname(target).toLowerCase()] || 'application/octet-stream')
      res.setHeader('Content-Length', stat.size)
      if (maxAge > 0) res.setHeader('Cache-Control', `public, max-age=${Math.floor(maxAge / 1000)}${options.immutable ? ', immutable' : ''}`)
      if (options.setHeaders) options.setHeaders(res, target, stat)
      if (options.dotfiles === 'deny' && path.basename(target).startsWith('.')) return res.status(404).end('Not found')
      if (req.method === 'HEAD') return res.end()
      const stream = fs.createReadStream(target)
      stream.on('error', (error) => { if (!res.writableEnded) next(error) })
      stream.pipe(res)
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        if (options.fallthrough === false) { error.status = 404; error.statusCode = 404; return next(error) }
        return next()
      }
      next(error)
    }
  }
}
function parseDuration(value) {
  if (typeof value === 'number') return value
  const match = /^(\d+)\s*(ms|s|m|h|d|w|y)?$/i.exec(String(value))
  if (!match) return 0
  const scale = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, y: 31536000000 }[(match[2] || 'ms').toLowerCase()]
  return Number(match[1]) * scale
}

module.exports = Object.assign(createApp, { json, urlencoded, static: staticFiles })
