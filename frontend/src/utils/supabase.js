import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL || '';
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Determine if user has provided real Supabase project credentials
export const isSupabaseConfigured = () => {
  return (
    Boolean(rawUrl) &&
    Boolean(rawKey) &&
    !rawUrl.includes('your-project.supabase.co') &&
    rawUrl.startsWith('https://')
  );
};

// Initialize Supabase client if configured, otherwise null
export const supabase = isSupabaseConfigured()
  ? createClient(rawUrl, rawKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

// =============================================================================
// AUTH HELPERS
// =============================================================================

export const supabaseSignIn = async (email, password) => {
  if (!supabase) throw new Error('Supabase is not configured with project credentials.');
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
};

export const supabaseSignUp = async (name, email, password, role = 'user') => {
  if (!supabase) throw new Error('Supabase is not configured with project credentials.');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        role
      }
    }
  });
  if (error) throw error;
  return data;
};

export const supabaseSignOut = async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) console.warn('Supabase sign out error:', error.message);
};

export const supabaseGetSession = async () => {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn('Supabase getSession error:', error.message);
    return null;
  }
  return data?.session || null;
};

export const supabaseGetUserProfile = async (userId) => {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) {
      console.warn('Could not fetch Supabase profile:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Profile fetch exception:', err);
    return null;
  }
};

// =============================================================================
// PARAMETER STORAGE HELPERS
// Stores and retrieves pipeline parameters, biometrics, tracking, and formulary values
// =============================================================================

export const supabaseSaveParameter = async (key, value, category = 'pipeline', updatedBy = 'system') => {
  if (!supabase) return { success: false, reason: 'unconfigured' };
  try {
    const payload = {
      key,
      value,
      category,
      updated_by: updatedBy,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('parameters')
      .upsert(payload, { onConflict: 'key' })
      .select();

    if (error) {
      console.warn(`Supabase error saving parameter '${key}':`, error.message);
      return { success: false, error: error.message };
    }
    return { success: true, data };
  } catch (err) {
    console.warn(`Exception saving parameter '${key}':`, err);
    return { success: false, error: err.message };
  }
};

export const supabaseGetParameters = async (category = null) => {
  if (!supabase) return [];
  try {
    let query = supabase.from('parameters').select('*');
    if (category) {
      query = query.eq('category', category);
    }
    const { data, error } = await query;
    if (error) {
      console.warn('Supabase getParameters error:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Exception getting parameters:', err);
    return [];
  }
};

// =============================================================================
// NOTIFICATION STORAGE HELPERS
// Stores, syncs, and deletes real-time notifications in Supabase
// =============================================================================

export const supabaseSaveNotification = async (notification) => {
  if (!supabase) return { success: false, reason: 'unconfigured' };
  try {
    const notifRow = {
      id: notification.id || `notif_${Date.now()}`,
      recipient_role: notification.recipient_role || 'all',
      detection_id: notification.detection_id || null,
      species: notification.species || 'wildlife',
      thumbnail: notification.thumbnail || null,
      location_name: notification.location_name || 'Reserve Sector',
      lat: typeof notification.lat === 'number' ? notification.lat : parseFloat(notification.lat || 29.5312),
      lng: typeof notification.lng === 'number' ? notification.lng : parseFloat(notification.lng || 78.7744),
      timestamp: notification.timestamp || new Date().toISOString(),
      source_type: notification.source_type || 'live',
      uploader: notification.uploader || 'Scout Ranger',
      dosage: notification.dosage || null,
      attributes: notification.attributes || null,
      read: Boolean(notification.read),
      created_at: notification.created_at || new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('notifications')
      .upsert(notifRow, { onConflict: 'id' })
      .select();

    if (error) {
      console.warn('Supabase error saving notification:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, data };
  } catch (err) {
    console.warn('Exception saving notification to Supabase:', err);
    return { success: false, error: err.message };
  }
};

export const supabaseGetNotifications = async (role = null, limit = 50) => {
  if (!supabase) return [];
  try {
    let query = supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (role && role !== 'all') {
      query = query.or(`recipient_role.eq.${role},recipient_role.eq.all`);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Supabase error fetching notifications:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Exception fetching notifications from Supabase:', err);
    return [];
  }
};

export const supabaseMarkNotificationRead = async (notificationId) => {
  if (!supabase || !notificationId) return false;
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);
    if (error) {
      console.warn('Supabase error marking notification read:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception marking notification read:', err);
    return false;
  }
};

export const supabaseDeleteNotification = async (notificationId) => {
  if (!supabase || !notificationId) return false;
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);
    if (error) {
      console.warn('Supabase error deleting notification:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception deleting notification in Supabase:', err);
    return false;
  }
};

export const supabaseClearNotifications = async () => {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .neq('id', 'placeholder_keep_none');
    if (error) {
      console.warn('Supabase error clearing notifications:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception clearing notifications in Supabase:', err);
    return false;
  }
};

export const supabaseSaveDetection = async (detection) => {
  if (!supabase) return { success: false, reason: 'unconfigured' };
  try {
    const { data, error } = await supabase
      .from('detections')
      .upsert(detection, { onConflict: 'id' })
      .select();
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

