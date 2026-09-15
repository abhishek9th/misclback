import { getSupabaseAdmin } from './supabaseAdmin.js';

// Records a non-sensitive audit entry for access to highly-sensitive data
// (identity documents, bank accounts). NEVER pass the sensitive value itself —
// only metadata about who touched what and why (§16/§19 of the spec).
// Failures here are logged but never block the calling request.
export async function logSensitiveAccess({
  userId, accessedBy = null, tableName, recordId = null, action, purpose = null, req = null,
}) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('sensitive_data_access_log').insert({
      user_id: userId,
      accessed_by: accessedBy,
      table_name: tableName,
      record_id: recordId,
      action,
      purpose,
      ip_address: req?.ip || null,
      user_agent: req?.headers?.['user-agent'] || null,
    });
  } catch (err) {
    console.error('audit log write failed:', err.message);
  }
}
