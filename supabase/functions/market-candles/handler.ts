// Public price history for the portfolio chart.
// The browser cannot read Yahoo's chart API (no CORS). Finnhub candle routes
// are not on the free plan. This function fetches the chart server-side and
// returns closes only. It is not an open proxy: the URL is built here.

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/'
// 1d allows 400 calendar days so the portfolio risk check can load about a
// year of closes (~252 trading days) plus a short buffer. Intraday caps stay
// tight so this route is not an open history proxy.
const INTERVAL_MAX: Record<string, number> = { '5m': 10, '15m': 30, '30m': 60, '60m': 120, '1d': 400 }
const CRYPTO: Record<string, string> = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  SOL: 'SOL-USD',
  DOGE: 'DOGE-USD',
}
const TICKER = /^[A-Z][A-Z.\-]{0,9}$/
const MAX_SYMBOLS = 8
const UA = 'Mozilla/5.0 (compatible; FinPathEducation/1.0; +https://finpathdev.github.io/FinPath/)'

export class ChartUpstreamError extends Error {
  code: string
  constructor(code: string){
    super(code)
    this.code = code
  }
}

export function toYahooSymbol(ticker: string): string | null {
  const t = String(ticker || '').trim().toUpperCase()
  if(!TICKER.test(t)) return null
  if(CRYPTO[t]) return CRYPTO[t]
  return t.replace(/\./g, '-')
}

export function isAllowedChartOrigin(origin: string | null): boolean {
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

export function chartCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  }
  if(isAllowedChartOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin as string
  return headers
}

export function seriesFromYahoo(payload: unknown): { t: number[]; c: number[] } | null {
  if(!payload || typeof payload !== 'object') return null
  const chart = (payload as { chart?: { error?: unknown; result?: unknown[] } }).chart
  if(!chart || chart.error || !Array.isArray(chart.result) || !chart.result[0]) return null
  const result = chart.result[0] as {
    timestamp?: unknown[]
    indicators?: { quote?: Array<{ close?: unknown[] }> }
  }
  const times = Array.isArray(result.timestamp) ? result.timestamp : []
  const quote = result.indicators && Array.isArray(result.indicators.quote) ? result.indicators.quote[0] : null
  const closes = quote && Array.isArray(quote.close) ? quote.close : []
  const t: number[] = []
  const c: number[] = []
  const n = Math.min(times.length, closes.length)
  for(let i = 0; i < n; i++){
    const ts = Number(times[i])
    const px = Number(closes[i])
    if(!Number.isFinite(ts) || !Number.isFinite(px) || px <= 0) continue
    t.push(ts)
    c.push(px)
  }
  if(t.length < 2) return null
  return { t, c }
}

function yahooUrl(symbol: string, interval: string, days: number, nowSec: number): string {
  const period2 = nowSec
  const period1 = nowSec - days * 86400
  return YAHOO + encodeURIComponent(symbol) +
    '?interval=' + encodeURIComponent(interval) +
    '&period1=' + period1 +
    '&period2=' + period2 +
    '&includePrePost=false'
}

async function fetchYahoo(
  fetchImpl: typeof fetch,
  symbol: string,
  interval: string,
  days: number,
  nowSec: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ t: number[]; c: number[] }> {
  const url = yahooUrl(symbol, interval, days, nowSec)
  let attempt = 0
  while(attempt < 2){
    attempt++
    let res: Response
    try{
      res = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      })
    }catch{
      throw new ChartUpstreamError('upstream')
    }
    if(res.status === 404) throw new ChartUpstreamError('unknown')
    if(res.status === 429 && attempt < 2){
      await sleep(400)
      continue
    }
    if(res.status === 429) throw new ChartUpstreamError('busy')
    if(!res.ok) throw new ChartUpstreamError('upstream')
    let body: unknown
    try{ body = await res.json() }catch{ throw new ChartUpstreamError('upstream') }
    const series = seriesFromYahoo(body)
    if(!series) throw new ChartUpstreamError('empty')
    return series
  }
  throw new ChartUpstreamError('upstream')
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export interface CandleDeps {
  fetchImpl: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export async function handleMarketCandles(req: Request, deps: CandleDeps): Promise<Response> {
  const origin = req.headers.get('origin')
  const cors = chartCorsHeaders(origin)
  if(req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if(req.method !== 'GET') return json({ error: 'method' }, 405, cors)
  if(!isAllowedChartOrigin(origin)) return json({ error: 'origin' }, 403, cors)

  const url = new URL(req.url)
  const interval = url.searchParams.get('interval') || ''
  const days = Number(url.searchParams.get('days'))
  const max = INTERVAL_MAX[interval]
  if(!max || !Number.isInteger(days) || days < 1 || days > max){
    return json({ error: 'range' }, 400, cors)
  }

  const symbols: string[] = []
  const seen = new Set<string>()
  for(const part of (url.searchParams.get('symbols') || '').split(',')){
    const t = part.trim().toUpperCase()
    if(!t || seen.has(t)) continue
    seen.add(t)
    symbols.push(t)
  }
  if(!symbols.length || symbols.length > MAX_SYMBOLS) return json({ error: 'symbols' }, 400, cors)

  const now = deps.now ? deps.now() : Math.floor(Date.now() / 1000)
  const sleep = deps.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const series: Record<string, { t: number[]; c: number[] }> = {}
  const errors: Record<string, string> = {}
  let cursor = 0
  async function worker(){
    for(;;){
      const i = cursor++
      if(i >= symbols.length) return
      const ticker = symbols[i]
      const yahoo = toYahooSymbol(ticker)
      if(!yahoo){ errors[ticker] = 'symbol'; continue }
      try{
        series[ticker] = await fetchYahoo(deps.fetchImpl, yahoo, interval, days, now, sleep)
      }catch(err){
        errors[ticker] = err instanceof ChartUpstreamError ? err.code : 'upstream'
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  const headers = { ...cors }
  headers['Cache-Control'] = Object.keys(series).length
    ? 'public, max-age=60'
    : 'no-store'
  return json({ interval, days, series, errors }, 200, headers)
}
