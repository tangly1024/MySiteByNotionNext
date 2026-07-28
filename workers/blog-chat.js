const DEFAULT_MODEL = 'gemini-2.5-flash-lite'
const MAX_REQUEST_BYTES = 20000
const MAX_MESSAGES = 6
const MAX_CONTEXT_CHARS = 6000

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers
    }
  })

const corsHeaders = (request, env) => {
  const origin = request.headers.get('origin')
  const allowed = (env.BLOG_CHAT_CORS_ORIGINS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  if (!origin || !allowed.length) return {}
  if (!allowed.includes('*') && !allowed.includes(origin)) return {}

  return {
    'access-control-allow-origin': allowed.includes('*') ? '*' : origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  }
}

const textFromMessage = message =>
  message?.parts
    ?.map(part => (part.type === 'text' ? part.text : ''))
    .join('') || ''

const cleanHtml = html =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const siteContext = async env => {
  if (!env.BLOG_CHAT_SITE_URL) return ''

  const home = await fetch(env.BLOG_CHAT_SITE_URL).then(res => res.text())
  const text = cleanHtml(home).slice(0, MAX_CONTEXT_CHARS)

  return `站点首页内容摘要：\n${text}`
}

const prompt = (env, context) => `${env.BLOG_CHAT_SYSTEM_PROMPT || `你是 ${env.BLOG_CHAT_SITE_NAME || '这个博客'} 的 AI 助手。

必须使用简体中文回答。只回答与这个站点、个人创业、AI 学习、内容系统、博客文章相关的问题。
如果用户问无关内容，简短说明你只能回答站点内容相关问题。
回答要直接、具体，不要编造文章、链接或作者观点。`}${context ? `\n\n${context}` : ''}`

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, { status: 405, headers })
    }

    if (Number(request.headers.get('content-length') || 0) > MAX_REQUEST_BYTES) {
      return json({ error: 'Request is too large.' }, { status: 413, headers })
    }

    if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return json({ error: 'Missing GOOGLE_GENERATIVE_AI_API_KEY.' }, { status: 500, headers })
    }

    const body = await request.json()
    const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : []
    const contents = messages.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: textFromMessage(message).slice(0, 1000) }]
    }))

    const model = env.BLOG_CHAT_MODEL || DEFAULT_MODEL
    const context = await siteContext(env).catch(() => '')
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_GENERATIVE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt(env, context) }] },
          contents,
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
        })
      }
    )

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!response.ok || !text) {
      return json({ error: data.error?.message || 'AI assistant request failed.' }, { status: 502, headers })
    }

    return json({ text }, { headers })
  }
}
