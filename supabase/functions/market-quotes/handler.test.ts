import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleMarketQuotes, quoteFromSparkMeta, toYahooSymbol } from './handler.ts'

const ORIGIN = 'https://finpathdev.github.io'

function sparkBody(rows){
  return {
    spark: {
      result: rows.map((row) => ({
        symbol: row.symbol,
        response: [{
          meta: {
            symbol: row.symbol,
            regularMarketPrice: row.price,
            chartPreviousClose: row.prev,
            regularMarketChangePercent: row.dp,
          },
        }],
      })),
      error: null,
    },
  }
}

function deps(fetchImpl, now){
  return {
    fetchImpl,
    cache: new Map(),
    now: () => now.value,
    sleep: async () => {},
  }
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

test('spark meta matches a Finnhub-style day change from the previous close', function(){
  const quote = quoteFromSparkMeta({
    regularMarketPrice: 342.37,
    chartPreviousClose: 344.17,
    regularMarketChangePercent: -0.523,
  })
  assert.ok(quote)
  assert.equal(quote.c, 342.37)
  assert.ok(Math.abs(quote.d - (342.37 - 344.17)) < 1e-9)
  assert.equal(quote.dp, -0.523)
  assert.equal(quote.pc, 344.17)
  assert.equal(quoteFromSparkMeta({ regularMarketPrice: 0, chartPreviousClose: 1 }), null)
  assert.equal(quoteFromSparkMeta(null), null)
})

test('one spark call prices a batch and the next call inside the TTL does not refetch', async function(){
  const calls = []
  const now = { value: 1_700_000_000_000 }
  const fetchImpl = async (input) => {
    calls.push(String(input))
    assert.match(String(input), /symbols=AAPL,BTC-USD,BRK-B&/)
    return new Response(JSON.stringify(sparkBody([
      { symbol: 'AAPL', price: 100, prev: 99, dp: 1.01 },
      { symbol: 'BTC-USD', price: 50, prev: 40, dp: 25 },
      { symbol: 'BRK-B', price: 10, prev: 8, dp: 25 },
    ])), { status: 200 })
  }
  const bag = deps(fetchImpl, now)
  const first = await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=aapl,btc,BRK.B', {
      headers: { Origin: ORIGIN },
    }),
    bag,
  )
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('access-control-allow-origin'), ORIGIN)
  assert.match(first.headers.get('cache-control') || '', /max-age=30/)
  const body = await first.json()
  assert.equal(body.quotes.AAPL.c, 100)
  assert.equal(body.quotes.BTC.c, 50)
  assert.equal(body.quotes['BRK.B'].c, 10)
  assert.equal(calls.length, 1)

  now.value += 10_000
  const second = await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=AAPL,BTC', {
      headers: { Origin: ORIGIN },
    }),
    bag,
  )
  assert.equal(second.status, 200)
  const again = await second.json()
  assert.equal(again.quotes.AAPL.c, 100)
  assert.equal(again.quotes.BTC.c, 50)
  assert.equal(calls.length, 1)

  now.value += 21_000
  await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=AAPL', {
      headers: { Origin: ORIGIN },
    }),
    bag,
  )
  assert.equal(calls.length, 2)
})

test('a warm symbol is not asked upstream again when a neighbor misses', async function(){
  const calls = []
  const now = { value: 1_700_000_000_000 }
  const fetchImpl = async (input) => {
    const url = String(input)
    calls.push(url)
    const symbol = decodeURIComponent(url.split('symbols=')[1].split('&')[0])
    return new Response(JSON.stringify(sparkBody([
      { symbol, price: symbol === 'MSFT' ? 20 : 10, prev: 10, dp: 0 },
    ])), { status: 200 })
  }
  const bag = deps(fetchImpl, now)
  await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=AAPL', { headers: { Origin: ORIGIN } }),
    bag,
  )
  now.value += 5_000
  const res = await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=AAPL,MSFT', { headers: { Origin: ORIGIN } }),
    bag,
  )
  const body = await res.json()
  assert.equal(body.quotes.AAPL.c, 10)
  assert.equal(body.quotes.MSFT.c, 20)
  assert.equal(calls.length, 2)
  assert.match(calls[1], /symbols=MSFT&/)
  assert.doesNotMatch(calls[1], /AAPL/)
})

test('twenty-one symbols become two spark calls and an unknown ticker is recorded', async function(){
  const calls = []
  const names = []
  for(let i = 0; i < 21; i++) names.push('T' + String.fromCharCode(65 + i))
  const fetchImpl = async (input) => {
    const url = String(input)
    calls.push(url)
    const list = decodeURIComponent(url.split('symbols=')[1].split('&')[0]).split(',')
    const rows = list.filter((symbol) => symbol !== 'NOTREAL').map((symbol) => ({
      symbol, price: 5, prev: 4, dp: 25,
    }))
    return new Response(JSON.stringify(sparkBody(rows)), { status: 200 })
  }
  const bag = deps(fetchImpl, { value: 1_700_000_000_000 })
  const symbols = names.concat('NOTREAL', '../nope')
  const res = await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=' + symbols.join(','), {
      headers: { Origin: 'http://localhost:8000' },
    }),
    bag,
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(calls.length, 2)
  assert.equal(body.quotes.TA.c, 5)
  assert.equal(body.quotes.TU.c, 5)
  assert.equal(body.errors.NOTREAL, 'empty')
  assert.equal(body.errors['../NOPE'], 'symbol')
})

test('rejects other origins, too many symbols, and a huge query without calling upstream', async function(){
  const fetchImpl = async () => {
    throw new Error('should not fetch')
  }
  const bag = deps(fetchImpl, { value: 0 })
  const blocked = await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=AAPL', {
      headers: { Origin: 'https://evil.example' },
    }),
    bag,
  )
  assert.equal(blocked.status, 403)

  const many = []
  for(let i = 0; i < 41; i++) many.push('S' + i)
  const wide = await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=' + many.join(','), {
      headers: { Origin: ORIGIN },
    }),
    bag,
  )
  assert.equal(wide.status, 400)

  const preflight = await handleMarketQuotes(
    new Request('https://example.test/market-quotes', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
    bag,
  )
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN)
})

test('a busy upstream is retried once', async function(){
  let n = 0
  const fetchImpl = async () => {
    n++
    if(n === 1) return new Response('slow', { status: 429 })
    return new Response(JSON.stringify(sparkBody([
      { symbol: 'VOO', price: 100, prev: 99, dp: 1 },
    ])), { status: 200 })
  }
  const res = await handleMarketQuotes(
    new Request('https://example.test/market-quotes?symbols=VOO', { headers: { Origin: ORIGIN } }),
    deps(fetchImpl, { value: 1_700_000_000_000 }),
  )
  assert.equal(res.status, 200)
  assert.equal(n, 2)
  const body = await res.json()
  assert.equal(body.quotes.VOO.c, 100)
})
