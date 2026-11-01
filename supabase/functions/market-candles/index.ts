// Portfolio chart history. Deployed with verify_jwt off.
// Signed-out students use the portfolio, and the payload is public prices.
// handleMarketCandles allowlists Origin, the interval, the window, and the ticker.

import { handleMarketCandles } from './handler.ts'

export default {
  fetch(req: Request): Promise<Response> {
    return handleMarketCandles(req, { fetchImpl: globalThis.fetch.bind(globalThis) })
  },
}
