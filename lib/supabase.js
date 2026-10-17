'use strict'

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const PROOFS_BUCKET = 'storm-payment-proofs'
const HOSTING_BUCKET = 'storm-hosting-files'

let client = null
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { 'X-Client-Info': 'storm-studio-server' } },
  })
}

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !client) {
    throw new Error('متغيرات Supabase ناقصة. أضف SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY إلى Environment Variables ثم أعد النشر.')
  }
  if (!/^https:\/\//i.test(SUPABASE_URL)) {
    throw new Error('قيمة SUPABASE_URL يجب أن تبدأ بـ https://')
  }
  return client
}

function cleanObjectName(name) {
  const filename = String(name || '')
  if (!filename || filename !== filename.split(/[\\/]/).pop() || filename.includes('..')) {
    throw new Error('اسم ملف إثبات الدفع غير صالح.')
  }
  return filename
}

async function uploadProof(name, buffer, contentType) {
  const filename = cleanObjectName(name)
  const { error } = await getSupabase().storage.from(PROOFS_BUCKET).upload(filename, buffer, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw new Error(`تعذر رفع إثبات الدفع إلى Supabase Storage: ${error.message}`)
  return filename
}

async function deleteProof(name) {
  if (!name) return
  const filename = cleanObjectName(name)
  const { error } = await getSupabase().storage.from(PROOFS_BUCKET).remove([filename])
  if (error) throw new Error(`تعذر حذف إثبات الدفع من Supabase Storage: ${error.message}`)
}

async function downloadProof(name) {
  const filename = cleanObjectName(name)
  const { data, error } = await getSupabase().storage.from(PROOFS_BUCKET).download(filename)
  if (error) throw new Error(`تعذر قراءة إثبات الدفع من Supabase Storage: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

async function signedProofUrl(name, expiresIn = 3600) {
  const filename = cleanObjectName(name)
  const { data, error } = await getSupabase().storage.from(PROOFS_BUCKET).createSignedUrl(filename, expiresIn)
  if (error) throw new Error(`تعذر إنشاء رابط مؤقت لإثبات الدفع: ${error.message}`)
  return data.signedUrl
}


function cleanHostingObjectKey(key) {
  const value = String(key || '')
  if (!value.startsWith('hosting/') || value.includes('..') || value.startsWith('/') || value.includes('\\')) {
    throw new Error('مفتاح ملف الاستضافة غير صالح.')
  }
  return value
}

async function uploadHostingFile(key, buffer, contentType) {
  const objectKey = cleanHostingObjectKey(key)
  const { error } = await getSupabase().storage.from(HOSTING_BUCKET).upload(objectKey, buffer, {
    contentType: contentType || 'application/octet-stream',
    cacheControl: 'private, no-store',
    upsert: true,
  })
  if (error) throw new Error(`تعذر حفظ ملف الاستضافة: ${error.message}`)
  return objectKey
}

async function downloadHostingFile(key) {
  const objectKey = cleanHostingObjectKey(key)
  const { data, error } = await getSupabase().storage.from(HOSTING_BUCKET).download(objectKey)
  if (error) throw new Error(`تعذر قراءة ملف الاستضافة: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

async function deleteHostingFile(key) {
  if (!key) return
  const objectKey = cleanHostingObjectKey(key)
  const { error } = await getSupabase().storage.from(HOSTING_BUCKET).remove([objectKey])
  if (error) throw new Error(`تعذر حذف ملف الاستضافة: ${error.message}`)
}

async function signedHostingUrl(key, expiresIn = 600) {
  const objectKey = cleanHostingObjectKey(key)
  const { data, error } = await getSupabase().storage.from(HOSTING_BUCKET).createSignedUrl(objectKey, expiresIn)
  if (error) throw new Error(`تعذر إنشاء رابط مؤقت لملف الاستضافة: ${error.message}`)
  return data.signedUrl
}

module.exports = {
  SUPABASE_URL,
  PROOFS_BUCKET,
  HOSTING_BUCKET,
  uploadHostingFile,
  downloadHostingFile,
  deleteHostingFile,
  signedHostingUrl,
  getSupabase,
  uploadProof,
  deleteProof,
  downloadProof,
  signedProofUrl,
}
