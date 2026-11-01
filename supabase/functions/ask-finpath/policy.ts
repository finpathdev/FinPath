// Pure rules for Ask FinPath. No network, no secrets, no user identity.

export const FREE_DAILY = 5
export const GOLD_DAILY = 50
export const BURST_PER_MINUTE = 5
export const MAX_QUESTION = 500
export const MAX_HISTORY = 6
export const MAX_HISTORY_CHARS = 800
export const MAX_LESSON = 120
export const MAX_TOKENS = 400
export const TEMPERATURE = 0.2
export const XAI_URL = 'https://api.x.ai/v1/chat/completions'

// Confirmed 2026-11-01 at https://docs.x.ai/docs/models — chat model is grok-4.7.
// Chat Completions is the legacy endpoint this function is required to call.
// Override with the XAI_MODEL secret if xAI renames the model.
export const DEFAULT_XAI_MODEL = 'grok-4.7'

export const SYSTEM_PROMPT = [
  'You are Ask FinPath, a short educational explainer for people learning about money and markets.',
  'You are powered by Grok (xAI). You are not a broker, not an adviser, and not a fiduciary.',
  'Answer in plain language, in at most three short paragraphs. Define jargon when you use it.',
  'If a lesson title is provided, use it only as the topic. You do not have the lesson body, a portfolio, or the person\'s identity.',
  'Refuse — and do not give a substitute ticker, number, or plan — when asked for any of these:',
  '- a buy, sell, or hold call, including "should I buy X"',
  '- a price target or a prediction of where a price will go',
  '- a personal allocation or what they should do with their money',
  '- tax or legal advice',
  '- anything that is not about learning personal finance or markets',
  'When you refuse, say FinPath cannot make that call, name the general concept to study, and say to talk with a licensed financial, tax, or legal professional before acting.',
  'Never claim to know who the person is, their email, their portfolio, or their location. Never ask for an account id.',
  'If you are unsure, say so. This is education, not financial advice.',
].join('\n')

const REFUSALS: Record<string, string> = {
  trade:
    'FinPath can’t tell you to buy, sell, or hold a security, and it won’t pick one for you. The idea to study is an investment thesis: what the business or fund does, how it earns money, and how one position fits a diversified plan. A licensed financial adviser can talk through a personal situation. This is education, not financial advice.',
  allocation:
    'FinPath won’t divide your money or design a personal allocation. The concept is asset allocation: mixing stocks, bonds, and cash so one bad stretch doesn’t decide the outcome. The right mix depends on a person’s life, which a licensed financial adviser can weigh. This is education, not financial advice.',
  tax:
    'FinPath can’t tell you what you owe or which tax move to make. The concept to study is the difference between a tax-advantaged account and a taxable one. A CPA or other licensed tax professional can apply that to a real return. This is not tax advice.',
  legal:
    'FinPath can’t give legal advice or say whether something is legal for you. A related idea in markets is the difference between information and a recommendation. A licensed attorney can answer the legal question. This is education, not legal advice.',
  'off-topic':
    'Ask FinPath is for learning about money and markets. Try a concept from the lessons, such as what an index fund is, how compound interest works, or why diversification matters. For a decision about your own money, tax, or legal situation, talk with a licensed professional.',
  model:
    'FinPath can’t turn that into a buy, sell, hold, price target, or personal plan. Study the concept in general terms, and talk with a licensed financial, tax, or legal professional before you act. This is education, not financial advice.',
}

export function refusalAnswer(category: string): string {
  return REFUSALS[category] || REFUSALS.model
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface Refusal {
  refused: true
  category: string
  answer: string
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  if (origin === 'https://finpathdev.github.io') return true
  try {
    const url = new URL(origin)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return local && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch {
    return false
  }
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin as string
  return headers
}

export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]')
  }
  return out
}

function isConceptQuestion(q: string): boolean {
  if (!/^(what(?:'s| is| are)|explain|define|describe|how does|how do|why does|why do|tell me about)\b/i.test(q)) {
    return false
  }
  if (/\b(should i|should we|for me|my portfolio|my holdings|my money|i buy|i sell)\b/i.test(q)) return false
  if (/\bprice target\s+(for|of|on)\b/i.test(q)) return false
  if (/\bhow much tax\b/i.test(q)) return false
  return true
}

function refuse(category: string): Refusal {
  return { refused: true, category, answer: refusalAnswer(category) }
}

export function classifyQuestion(question: string, lessonTitle: string | null): Refusal | null {
  const q = question.replace(/\s+/g, ' ').trim()
  const concept = isConceptQuestion(q)

  // Direct advice is refused even when the sentence starts with "explain" or "what is".
  if (/\b(should|shall)\s+i\b[\s\S]{0,80}\b(buy|sell|hold|short|invest in|put money|dump|exit)\b/i.test(q)) {
    return refuse('trade')
  }
  if (/\bi\s+should\b[\s\S]{0,40}\b(buy|sell|hold|short)\b/i.test(q)) return refuse('trade')
  if (/\b(is|are)\s+(this|it|that|[a-z]{1,5})\s+(a\s+)?(buy|sell|hold)\b/i.test(q)) return refuse('trade')
  if (/\b(buy|sell|hold)\s+or\s+(buy|sell|hold)\b/i.test(q)) return refuse('trade')
  if (/\b(do you recommend|would you recommend|your recommendation)\b/i.test(q)) return refuse('trade')
  if (/\b(which|what)\s+(stock|stocks|etf|fund)s?\s+(should|to)\s+(i\s+|we\s+)?(buy|sell|hold)\b/i.test(q)) {
    return refuse('trade')
  }
  if (/\bpick\s+(me\s+)?(a\s+|some\s+)?(stocks?|etfs?|funds?|winners?)\b/i.test(q)) return refuse('trade')
  if (!concept && /\b(price target|target price)\b/i.test(q)) return refuse('trade')
  if (/\bhow (high|low) will\b/i.test(q)) return refuse('trade')
  if (/\b(what|where)\s+(price\s+)?will\b[\s\S]{0,50}\b(hit|reach|go)\b/i.test(q)) return refuse('trade')
  if (/\b(will|gonna|going to)\s+\S+\s+(go up|go down|moon|crash)\b/i.test(q)) return refuse('trade')
  if (/\b(how should i|what percent|what %|how much of my)\b[\s\S]{0,80}\b(allocat|invest|split|put|portfolio)\b/i.test(q)) {
    return refuse('allocation')
  }
  if (/\b(my|personal)\s+(allocation|asset mix)\b/i.test(q)) return refuse('allocation')
  if (/\ballocate my\b/i.test(q)) return refuse('allocation')
  if (/\bwhat should i do with my\b/i.test(q)) return refuse('allocation')

  if (!concept || /\b(should i|how much tax|is this legal|is it legal)\b/i.test(q)) {
    if (/\b(how much tax|what tax (do|will|should) i|should i (deduct|itemize)|can i write off|tax loss harvest)\b/i.test(q)) {
      return refuse('tax')
    }
    if (/\bshould i\b[\s\S]{0,40}\b(roth|traditional ira)\b/i.test(q)) return refuse('tax')
    if (/\b(is this legal|is it legal|legal advice|should i sue)\b/i.test(q)) return refuse('legal')
  }

  if (/\b(password|seed phrase|private key|social security number|\bssn\b|weather forecast|recipe for|write (me )?a poem|song lyrics)\b/i.test(q)) {
    return refuse('off-topic')
  }

  const finance = /\b(stocks?|bonds?|etfs?|funds?|index|invest\w*|portfolios?|diversif\w*|interest|compound\w*|budgets?|sav(?:e|ing|ings)|inflation|dividends?|markets?|risks?|assets?|retir\w*|401\s?k|401\(k\)|roths?|iras?|brokers?|brokerage|shares?|equit(?:y|ies)|debts?|credits?|loans?|mortgages?|paychecks?|salary|wages?|income|expenses?|emergency|cryptos?|bitcoins?|ethereum|valuat\w*|yields?|sectors?|recessions?|volatil\w*|mutual|tickers?|finance|financial|money|banks?|banking|accounts?|tax(?:es|ation)?|fiduciary|apr\b|apy\b|wealth|econom(?:y|ic|ics)|nasdaq|insurance|earnings|revenue|profit|capital gains?|dollar[- ]cost|\bdca\b|liquidity|price targets?|buy and hold|p\/e|price[- ]to[- ]earnings)\b/i
  if (finance.test(q) || (lessonTitle && !/\b(password|recipe for|weather)\b/i.test(q))) {
    return null
  }
  return refuse('off-topic')
}

export function answerGivesAdvice(text: string): boolean {
  return /\byou should (?:definitely )?(?:buy|sell|hold|short)\b/i.test(text)
    || /\bi (?:would|recommend) (?:you )?(?:buy|sell|hold|short)\b/i.test(text)
    || /\b(?:my|our) (?:recommendation|price target) is\b/i.test(text)
    || /\bprice target (?:is|of)\s*\$?\d/i.test(text)
    || /\bput \d+\s*% of your (?:money|portfolio|savings)\b/i.test(text)
    || /\byou should (?:allocate|put) \d+/i.test(text)
}

export function sanitizeHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return []
  const turns: HistoryTurn[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const role = (item as { role?: unknown }).role
    const content = (item as { content?: unknown }).content
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string') continue
    const clean = content.replace(/\u0000/g, '').trim()
    if (!clean) continue
    turns.push({
      role,
      content: clean.length > MAX_HISTORY_CHARS ? clean.slice(0, MAX_HISTORY_CHARS) : clean,
    })
  }
  return turns.slice(-MAX_HISTORY)
}

export function sanitizeLessonContext(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let text = raw.replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim()
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
  text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '')
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length > MAX_LESSON) text = text.slice(0, MAX_LESSON).trim()
  return text || null
}

export function sanitizeQuestion(raw: unknown): { q: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Type a question.' }
  const q = raw.replace(/\u0000/g, '').trim()
  if (!q) return { error: 'Type a question.' }
  if (q.length > MAX_QUESTION) return { error: 'Keep the question under 500 characters.' }
  return { q }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function buildMessages(question: string, history: HistoryTurn[], lesson: string | null): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (lesson) {
    messages.push({
      role: 'system',
      content: 'Lesson title for topic context only: ' + lesson,
    })
  }
  for (const turn of history) messages.push({ role: turn.role, content: turn.content })
  messages.push({ role: 'user', content: question })
  return messages
}

export function xaiBody(model: string, messages: ChatMessage[]): Record<string, unknown> {
  return {
    model,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    stream: false,
    reasoning_effort: 'low',
  }
}
