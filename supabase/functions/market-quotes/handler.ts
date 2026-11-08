// Public live quotes. The browser cannot be the one calling Yahoo: the free
// Finnhub key in the page is shared by every visitor. This function batches
// symbols into one Yahoo spark request (20 per call) and remembers each
// symbol for a short TTL so the next visitor reuses it.
// It is not an open proxy: the URL is built here.

const SPARK = 'https://query1.finance.yahoo.com/v7/finance/spark'
const CRYPTO: Record<string, string> = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  SOL: 'SOL-USD',
  DOGE: 'DOGE-USD',
}
const TICKER = /^[A-Z][A-Z.\-]{0,9}$/
const MAX_SYMBOLS = 40
const MAX_RAW = 600
const SPARK_BATCH = 20
const QUOTE_TTL_MS = 30_000
const UA = 'Mozilla/5.0 (compatible; FinPathEducation/1.0; +https://finpathdev.github.io/FinPath/)'

export interface LiveQuote {
  c: number
  d: number | null
  dp: number | null
  pc: number | null
}

export interface CachedQuote {
  quote: LiveQuote
  storedAt: number
}

export interface QuoteDeps {
  fetchImpl: typeof fetch
  cache: Map<string, CachedQuote>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  ttlMs?: number
}

export function toYahooSymbol(ticker: string): string | null {
  const t = String(ticker || '').trim().toUpperCase()
  if(!TICKER.test(t)) return null
  if(CRYPTO[t]) return CRYPTO[t]
  return t.replace(/\./g, '-')
}

export function isAllowedQuoteOrigin(origin: string | null): boolean {
  if(!origin) return false
  if(origin === 'https://finpathdev.github.io') return true
  try{
    const url = new URL(origin)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return local && (url.protocol === 'http:' || url.protocol === 'https:')
  }catch{
    return false
  }
}

export function quoteCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  }
  if(isAllowedQuoteOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin as string
  return headers
}

export function quoteFromSparkMeta(meta: unknown): LiveQuote | null {
  if(!meta || typeof meta !== 'object') return null
  const row = meta as Record<string, unknown>
  const c = Number(row.regularMarketPrice)
  if(!Number.isFinite(c) || c <= 0) return null
  const prev = Number(row.chartPreviousClose)
  const pc = Number.isFinite(prev) && prev > 0 ? prev : null
  const pct = Number(row.regularMarketChangePercent)
  let dp = Number.isFinite(pct) ? pct : null
  const d = pc != null ? c - pc : null
  if(dp == null && d != null && pc) dp = (d / pc) * 100
  return { c, d, dp, pc }
}

export function quotesFromSpark(payload: unknown, yahooToTicker: Record<string, string>): Record<string, LiveQuote> {
  const quotes: Record<string, LiveQuote> = {}
  if(!payload || typeof payload !== 'object') return quotes
  const spark = (payload as { spark?: { result?: unknown } }).spark
  const result = spark && Array.isArray(spark.result) ? spark.result : []
  for(const row of result){
    if(!row || typeof row !== 'object') continue
    const item = row as { symbol?: unknown; response?: unknown }
    const response = Array.isArray(item.response) ? item.response[0] : null
    const meta = response && typeof response === 'object'
      ? (response as { meta?: unknown }).meta
      : null
    const metaSymbol = meta && typeof meta === 'object' ? (meta as { symbol?: unknown }).symbol : ''
    const yahoo = String(metaSymbol || item.symbol || '').toUpperCase()
    const ticker = yahooToTicker[yahoo]
    if(!ticker) continue
    const quote = quoteFromSparkMeta(meta)
    if(!quote) continue
    quotes[ticker] = quote
  }
  return quotes
}

function sparkUrl(yahooSymbols: string[]): string {
  const list = yahooSymbols.map((symbol) => encodeURIComponent(symbol)).join(',')
  return SPARK + '?symbols=' + list + '&range=1d&interval=1d'
}

async function fetchSpark(
  fetchImpl: typeof fetch,
  yahooSymbols: string[],
  sleep: (ms: number) => Promise<void>,
): Promise<unknown> {
  const url = sparkUrl(yahooSymbols)
  let attempt = 0
  while(attempt < 2){
    attempt++
    let res: Response
    try{
      res = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      })
    }catch{
      throw new Error('upstream')
    }
    if(res.status === 429 && attempt < 2){
      await sleep(400)
      continue
    }
    if(!res.ok) throw new Error(res.status === 429 ? 'busy' : 'upstream')
    try{
      return await res.json()
    }catch{
      throw new Error('upstream')
    }
  }
  throw new Error('upstream')
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function parseSymbols(raw: string): string[] | null {
  if(raw.length > MAX_RAW) return null
  const symbols: string[] = []
  const seen = new Set<string>()
  for(const part of raw.split(',')){
    const t = part.trim().toUpperCase()
    if(!t || seen.has(t)) continue
    seen.add(t)
    symbols.push(t)
  }
  if(!symbols.length || symbols.length > MAX_SYMBOLS) return null
  return symbols
}

export async function handleMarketQuotes(req: Request, deps: QuoteDeps): Promise<Response> {
  const origin = req.headers.get('origin')
  const cors = quoteCorsHeaders(origin)
  if(req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if(req.method !== 'GET') return json({ error: 'method' }, 405, cors)
  if(!isAllowedQuoteOrigin(origin)) return json({ error: 'origin' }, 403, cors)

  const url = new URL(req.url)
  const symbols = parseSymbols(url.searchParams.get('symbols') || '')
  if(!symbols) return json({ error: 'symbols' }, 400, cors)

  const now = deps.now ? deps.now() : Date.now()
  const ttl = deps.ttlMs != null ? deps.ttlMs : QUOTE_TTL_MS
  const sleep = deps.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const quotes: Record<string, LiveQuote> = {}
  const errors: Record<string, string> = {}
  const pending: string[] = []

  for(const ticker of symbols){
    const hit = deps.cache.get(ticker)
    if(hit && now >= hit.storedAt && now - hit.storedAt < ttl){
      quotes[ticker] = hit.quote
      continue
    }
    pending.push(ticker)
  }

  for(let i = 0; i < pending.length; i += SPARK_BATCH){
    const chunk = pending.slice(i, i + SPARK_BATCH)
    const yahooToTicker: Record<string, string> = {}
    const yahooSymbols: string[] = []
    for(const ticker of chunk){
      const yahoo = toYahooSymbol(ticker)
      if(!yahoo){
        errors[ticker] = 'symbol'
        continue
      }
      yahooToTicker[yahoo] = ticker
      yahooSymbols.push(yahoo)
    }
    if(!yahooSymbols.length) continue
    try{
      const payload = await fetchSpark(deps.fetchImpl, yahooSymbols, sleep)
      const got = quotesFromSpark(payload, yahooToTicker)
      for(const ticker of chunk){
        if(errors[ticker]) continue
        const quote = got[ticker]
        if(!quote){
          errors[ticker] = 'empty'
          continue
        }
        quotes[ticker] = quote
        deps.cache.set(ticker, { quote, storedAt: now })
      }
    }catch(err){
      const code = err instanceof Error && err.message === 'busy' ? 'busy' : 'upstream'
      for(const ticker of chunk){
        if(!errors[ticker] && !quotes[ticker]) errors[ticker] = code
      }
    }
  }

  const headers = { ...cors }
  headers['Cache-Control'] = Object.keys(quotes).length ? 'public, max-age=30' : 'no-store'
  return json({ quotes, errors }, 200, headers)
}
