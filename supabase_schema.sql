-- =============================================================================
-- SENTRYWING WILDLIFE SURVEILLANCE & TARGET TRACKING
-- SUPABASE DATABASE SCHEMA: AUTH, PARAMETERS, AND NOTIFICATIONS
-- =============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. USER PROFILES TABLE (Linked with Supabase auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'vet', 'admin')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are readable by authenticated users"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can insert their own profile"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id);

-- Trigger to automatically create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'user')
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        role = EXCLUDED.role;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- -----------------------------------------------------------------------------
-- 2. SYSTEM & PIPELINE PARAMETERS TABLE
-- Stores detection thresholds, tracker geometry, biometrics, and formulary values
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parameters (
    id BIGSERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL,
    category TEXT NOT NULL DEFAULT 'pipeline',
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_by TEXT
);

-- Index on parameter key and category
CREATE INDEX IF NOT EXISTS idx_parameters_key ON public.parameters(key);
CREATE INDEX IF NOT EXISTS idx_parameters_category ON public.parameters(category);

-- Enable RLS on parameters
ALTER TABLE public.parameters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parameters are readable by all authenticated users"
    ON public.parameters FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Parameters are modifiable by authenticated users"
    ON public.parameters FOR ALL
    TO authenticated
    USING (true);

-- Allow public read/write if anon key is used
CREATE POLICY "Parameters anon read"
    ON public.parameters FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Parameters anon upsert"
    ON public.parameters FOR ALL
    TO anon
    USING (true);


-- -----------------------------------------------------------------------------
-- 3. NOTIFICATIONS TABLE
-- Stores real-time field alerts, dart dosage advisories, and triage items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id TEXT PRIMARY KEY,
    recipient_role TEXT NOT NULL DEFAULT 'all',
    detection_id TEXT,
    species TEXT NOT NULL,
    thumbnail TEXT,
    location_name TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    timestamp TEXT,
    source_type TEXT DEFAULT 'live',
    uploader TEXT DEFAULT 'Scout Ranger',
    dosage JSONB,
    attributes JSONB,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Index on created_at and recipient_role
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role ON public.notifications(recipient_role);

-- Enable RLS on notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notifications are accessible by authenticated users"
    ON public.notifications FOR ALL
    TO authenticated
    USING (true);

CREATE POLICY "Notifications anon read and write"
    ON public.notifications FOR ALL
    TO anon
    USING (true);


-- -----------------------------------------------------------------------------
-- 4. SEED DEFAULT SYSTEM PARAMETERS
-- -----------------------------------------------------------------------------
INSERT INTO public.parameters (key, value, category, updated_by)
VALUES
    ('detection_config', '{"confidence_threshold": 0.25, "iou_threshold": 0.45, "input_size": 640}'::jsonb, 'pipeline', 'system_init'),
    ('tracking_config', '{"lock_lost_threshold": 10, "center_deadband": 0.08, "match_distance": 0.55}'::jsonb, 'tracking', 'system_init'),
    ('dosage_config', '{"primary_model": "dart_dose_model", "standard_concentration_mg_ml": 100.0, "disclaimer": "AI-estimated dosage — verify before administering"}'::jsonb, 'dosage', 'system_init'),
    ('species_weight_bands', '{"tiger": "40–250 kg", "elephant": "1500–6000+ kg", "leopard": "30–90 kg", "bear": "80–600 kg", "hyena": "45–80 kg", "lion": "120–250 kg"}'::jsonb, 'biometrics', 'system_init')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW();
