import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleMarketCandles, seriesFromYahoo, toYahooSymbol } from './handler.ts'

const ORIGIN = 'https://finpathdev.github.io'

function yahooBody(symbol: string, times: number[], closes: Array<number | null>){
  return {
    chart: {
      result: [{
        meta: { symbol },
        timestamp: times,
        indicators: { quote: [{ close: closes }] },
      }],
    },
  }
}

function deps(fetchImpl: typeof fetch){
  return { fetchImpl, now: () => 1_700_000_000, sleep: async () => {} }
}

test('yahoo symbols cover class shares and the crypto the portfolio already tracks', function(){
  assert.equal(toYahooSymbol('aapl'), 'AAPL')
  assert.equal(toYahooSymbol('BRK.B'), 'BRK-B')
  assert.equal(toYahooSymbol('btc'), 'BTC-USD')
  assert.equal(toYahooSymbol('ETH'), 'ETH-USD')
  assert.equal(toYahooSymbol('../etc/passwd'), null)
  assert.equal(toYahooSymbol('AAPL USD'), null)
  assert.equal(toYahooSymbol(''), null)
})

test('series parser skips null closes and a not-found chart', function(){
  const series = seriesFromYahoo(yahooBody('AAPL', [10, 20, 30], [1, null, 3]))
  assert.deepEqual(series, { t: [10, 30], c: [1, 3] })
  assert.equal(seriesFromYahoo({ chart: { result: null, error: { code: 'Not Found' } } }), null)
  assert.equal(seriesFromYahoo({ chart: { result: [{ timestamp: [1], indicators: { quote: [{ close: [1] }] } }] } }), null)
})

test('batch returns closes for allowed symbols and records an unknown ticker', async function(){
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if(url.includes('/BRK-B?')){
      return new Response(JSON.stringify({ chart: { result: null, error: { code: 'Not Found' } } }), { status: 200 })
    }
    if(url.includes('/BTC-USD?')){
      return new Response('nope', { status: 404 })
    }
    assert.match(url, /\/AAPL\?interval=5m&period1=1699568000&period2=1700000000&includePrePost=false/)
    return new Response(JSON.stringify(yahooBody('AAPL', [100, 200], [10, 11])), { status: 200 })
  }
  const res = await handleMarketCandles(
    new Request('https://example.test/market-candles?symbols=AAPL,BRK.B,btc&interval=5m&days=5', {
      headers: { Origin: ORIGIN },
    }),
    deps(fetchImpl),
  )
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN)
  assert.match(res.headers.get('cache-control') || '', /max-age=60/)
  const body = await res.json()
  assert.deepEqual(body.series.AAPL, { t: [100, 200], c: [10, 11] })
  assert.equal(body.series['BRK.B'], undefined)
  assert.equal(body.errors['BRK.B'], 'empty')
  assert.equal(body.errors.BTC, 'unknown')
  assert.equal(calls.length, 3)
})

test('rejects other origins, wide intraday windows, and too many symbols', async function(){
  const fetchImpl: typeof fetch = async () => {
    throw new Error('should not fetch')
  }
  const blocked = await handleMarketCandles(
    new Request('https://example.test/market-candles?symbols=AAPL&interval=1d&days=30', {
      headers: { Origin: 'https://evil.example' },
    }),
    deps(fetchImpl),
  )
  assert.equal(blocked.status, 403)

  const wide = await handleMarketCandles(
    new Request('https://example.test/market-candles?symbols=AAPL&interval=5m&days=11', {
      headers: { Origin: 'http://localhost:8000' },
    }),
    deps(fetchImpl),
  )
  assert.equal(wide.status, 400)

  const many = await handleMarketCandles(
    new Request('https://example.test/market-candles?symbols=A,B,C,D,E,F,G,H,I&interval=1d&days=30', {
      headers: { Origin: ORIGIN },
    }),
    deps(fetchImpl),
  )
  assert.equal(many.status, 400)

  const preflight = await handleMarketCandles(
    new Request('https://example.test/market-candles', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
    deps(fetchImpl),
  )
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN)
})

test('a busy upstream is retried once', async function(){
  let n = 0
  const fetchImpl: typeof fetch = async () => {
    n++
    if(n === 1) return new Response('slow', { status: 429 })
    return new Response(JSON.stringify(yahooBody('VOO', [1, 2], [100, 101])), { status: 200 })
  }
  const res = await handleMarketCandles(
    new Request('https://example.test/market-candles?symbols=VOO&interval=1d&days=40', {
      headers: { Origin: ORIGIN },
    }),
    deps(fetchImpl),
  )
  assert.equal(res.status, 200)
  assert.equal(n, 2)
  const body = await res.json()
  assert.deepEqual(body.series.VOO.c, [100, 101])
})
