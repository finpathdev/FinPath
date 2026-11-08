// Live quotes for every learner. Deployed with verify_jwt off.
// Signed-out students use the portfolio, and the payload is public prices.
// handleMarketQuotes allowlists Origin and the ticker list. A 30s memory
// cache on this isolate means visitors share one Yahoo call per symbol.

import { handleMarketQuotes } from './handler.ts'

const cache = new Map()

export default {
  fetch(req: Request): Promise<Response> {
    return handleMarketQuotes(req, {
      fetchImpl: globalThis.fetch.bind(globalThis),
      cache,
      now: () => Date.now(),
    })
  },
}
