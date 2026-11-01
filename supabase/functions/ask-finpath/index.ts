// Ask FinPath — educational Q&A via xAI Grok.
//
// The browser never sees XAI_API_KEY. After merge, Siddharth still has to:
//   supabase secrets set XAI_API_KEY=...
//   supabase secrets set XAI_MODEL=grok-4.7
//   supabase db push          (applies *_ai_usage.sql)
//   supabase functions deploy ask-finpath
// Leave the platform verify_jwt check ON (the default). Do not pass
// --no-verify-jwt. This handler checks the user JWT again and ignores any
// Gold flag in the body. Gold comes from gold_users.active via the service role.
//
// Model id grok-4.7 confirmed 2026-11-01 at https://docs.x.ai/docs/models.
// Endpoint is the legacy Chat Completions API, not the Responses API.

import { createSupabaseContext } from 'npm:@supabase/server@1'
import { handleAsk, type AskAdmin } from './handler.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default {
  fetch(req: Request): Promise<Response> {
    return handleAsk(req, {
      env: (name) => Deno.env.get(name) ?? undefined,
      fetchImpl: globalThis.fetch.bind(globalThis),
      authorize: async (request) => {
        const { data, error } = await createSupabaseContext(request, { auth: 'user' })
        if (error || !data?.userClaims) {
          // Code only. error.message can describe the platform setup and must not reach the client.
          if (error) console.error('ask-finpath auth rejected', error.code || 'unauthorized')
          return null
        }
        const claims = data.userClaims as { id?: string; sub?: string }
        const userId = claims.id || claims.sub || ''
        if (!UUID.test(userId)) return null
        return { userId, admin: data.supabaseAdmin as unknown as AskAdmin }
      },
    })
  },
}
