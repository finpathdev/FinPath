# FinPath

FinPath is a personal-finance learning app: bite-sized lessons and quizzes, a portfolio tracker, a stock screener, and a look at the latest billionaire 13F filings. It runs as a single-page progressive web app (PWA).

## Plans
- **Free**: core lessons and tools.
- **FinPath Gold**: $4.99/month, billed monthly through Stripe. An annual plan is coming soon.

## Stack
- One static `index.html` (vanilla HTML/CSS/JS), plus `manifest.json` and a service worker (`sw.js`)
- Hosted on GitHub Pages (`_config.yml`)
- [Supabase](https://supabase.com) for auth and optional sync
- [Stripe](https://stripe.com) for Gold payments
- [Finnhub](https://finnhub.io) for market data (it may be delayed)

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Disclaimer
FinPath is for education only. It is not financial, investment, tax or legal advice. Market data may be delayed or inaccurate, and past performance does not guarantee future results. Do your own research or talk to a licensed professional before you make financial decisions.

## Contact
support@finpath.app

See `LICENSE` for licensing.
