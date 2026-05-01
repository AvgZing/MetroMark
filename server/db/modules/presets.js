const { normalizeText, nowIso, toEpochSeconds } = require('./helpers');
const { requireSupabaseClients } = require('../../supabase');

function normalizePresetRow(row) {
  if (!row) return null;
  return {
    id: normalizeText(row.id),
    name: normalizeText(row.name),
    citySlug: normalizeText(row.city_slug),
    snapshot: row.snapshot || {},
    createdAt: toEpochSeconds(row.created_at) || 0,
    updatedAt: toEpochSeconds(row.updated_at) || 0
  };
}

async function listFilterPresets(userId, citySlug = '') {
  const { serviceClient } = requireSupabaseClients();
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return [];

  let query = serviceClient
    .from('user_filter_presets')
    .select('id,name,city_slug,snapshot,created_at,updated_at')
    .eq('user_id', safeUserId)
    .order('name', { ascending: true });

  const normalizedCitySlug = normalizeText(citySlug);
  if (normalizedCitySlug) query = query.eq('city_slug', normalizedCitySlug);

  const { data, error } = await query;
  if (error) throw new Error(`Unable to load presets: ${error.message}`);
  return (data || []).map((row) => normalizePresetRow(row)).filter(Boolean);
}

async function upsertFilterPreset(userId, payload) {
  const { serviceClient } = requireSupabaseClients();
  const safeUserId = normalizeText(userId);
  const name = normalizeText(payload?.name);
  const citySlug = normalizeText(payload?.citySlug);
  const snapshot = payload?.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : null;

  if (!safeUserId || !name || !citySlug || !snapshot) {
    throw new Error('Invalid preset payload.');
  }

  const record = {
    user_id: safeUserId,
    name,
    city_slug: citySlug,
    snapshot,
    updated_at: nowIso()
  };

  const { data, error } = await serviceClient
    .from('user_filter_presets')
    .upsert(record, { onConflict: 'user_id,city_slug,name' })
    .select('id,name,city_slug,snapshot,created_at,updated_at')
    .maybeSingle();

  if (error) throw new Error(`Unable to save preset: ${error.message}`);
  return normalizePresetRow(data);
}

async function deleteFilterPreset(userId, presetId) {
  const { serviceClient } = requireSupabaseClients();
  const safeUserId = normalizeText(userId);
  const normalizedPresetId = normalizeText(presetId);
  if (!safeUserId || !normalizedPresetId) throw new Error('presetId is required.');

  const { error } = await serviceClient
    .from('user_filter_presets')
    .delete()
    .eq('id', normalizedPresetId)
    .eq('user_id', safeUserId);

  if (error) throw new Error(`Unable to delete preset: ${error.message}`);
}

module.exports = {
  listFilterPresets,
  upsertFilterPreset,
  deleteFilterPreset,
  normalizePresetRow
};
