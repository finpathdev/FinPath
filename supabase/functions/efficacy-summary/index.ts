// Does FinPath work? Aggregates only.
//
// Deployed with verify_jwt OFF. The publishable key is not a user JWT, and
// signed-out students should still see the public aggregate. The handler
// allowlists Origin. A record is stored only after a real user JWT checks
// out, and the user id is not written. Withdraw needs the random study token.
// Individual rows are never returned. Below 10 distinct study ids the body
// is only "Not enough participants yet".
//
//   supabase functions deploy efficacy-summary --no-verify-jwt
// Do not deploy this one with the platform JWT check on, or the public
// aggregate page breaks for signed-out learners. ask-finpath stays the
// opposite: leave its verify_jwt check ON.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleEfficacy, listAllEvents, type EfficacyAdmin } from './handler.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function admin(): EfficacyAdmin {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || ''
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    listEvents(){
      return listAllEvents(async (from, to) => {
        const { data, error } = await db
          .from('efficacy_events')
          .select('study_id,kind,score,lesson_points,quiz_points,breadth_points,action,age_band,created_at')
          .order('created_at', { ascending: true })
          .range(from, to)
        return { data: data as Record<string, unknown>[] | null, error }
      })
    },
    async countStudy(studyId){
      const { count, error } = await db
        .from('efficacy_events')
        .select('study_id', { count: 'exact', head: true })
        .eq('study_id', studyId)
      if(error) throw new Error('count failed')
      return count || 0
    },
    async insertEvents(rows){
      const { error } = await db.from('efficacy_events').upsert(rows, {
        onConflict: 'study_id,event_id',
        ignoreDuplicates: true,
      })
      if(error) return { error: 'insert failed' }
      return {}
    },
    async deleteStudy(studyId, hash){
      const { data, error } = await db
        .from('efficacy_events')
        .delete()
        .eq('study_id', studyId)
        .eq('token_hash', hash)
        .select('event_id')
      if(error) throw new Error('delete failed')
      return (data || []).length
    },
    async userIdFromJwt(jwt){
      if(!jwt || jwt === anonKey || jwt === serviceKey) return null
      const client = createClient(url, anonKey || serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: 'Bearer ' + jwt } },
      })
      const { data, error } = await client.auth.getUser(jwt)
      if(error || !data?.user?.id || !UUID.test(data.user.id)) return null
      return data.user.id
    },
  }
}

export default {
  fetch(req: Request): Promise<Response> {
    return handleEfficacy(req, { admin: admin() })
  },
}
