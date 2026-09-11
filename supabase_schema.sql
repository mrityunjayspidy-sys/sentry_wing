-- =============================================================================
-- SENTRYWING WILDLIFE SURVEILLANCE & TARGET TRACKING
-- SUPABASE DATABASE SCHEMA: AUTH, PARAMETERS, NOTIFICATIONS & DETECTIONS
-- (100% Idempotent - Can be run repeatedly in Supabase SQL Editor safely)
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

DROP POLICY IF EXISTS "Public profiles are readable by authenticated users" ON public.profiles;
CREATE POLICY "Public profiles are readable by authenticated users"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
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

DROP POLICY IF EXISTS "Parameters are readable by all authenticated users" ON public.parameters;
CREATE POLICY "Parameters are readable by all authenticated users"
    ON public.parameters FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Parameters are modifiable by authenticated users" ON public.parameters;
CREATE POLICY "Parameters are modifiable by authenticated users"
    ON public.parameters FOR ALL
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Parameters anon read" ON public.parameters;
CREATE POLICY "Parameters anon read"
    ON public.parameters FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "Parameters anon upsert" ON public.parameters;
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

-- Ensure all columns exist if the table was created earlier with an alternate schema
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS recipient_role TEXT DEFAULT 'all';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS detection_id TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS species TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS thumbnail TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS location_name TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS timestamp TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'live';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS uploader TEXT DEFAULT 'Scout Ranger';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dosage JSONB;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS attributes JSONB;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW());

-- Index on created_at and recipient_role
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role ON public.notifications(recipient_role);

-- Enable RLS on notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notifications are accessible by authenticated users" ON public.notifications;
CREATE POLICY "Notifications are accessible by authenticated users"
    ON public.notifications FOR ALL
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Notifications anon read and write" ON public.notifications;
CREATE POLICY "Notifications anon read and write"
    ON public.notifications FOR ALL
    TO anon
    USING (true);



-- -----------------------------------------------------------------------------
-- 5. WILDLIFE DETECTIONS TABLE
-- Stores AI detection events with bounding boxes, biometrics, and dart dosages
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.detections (
    id TEXT PRIMARY KEY,
    uploader_id TEXT,
    uploader_name TEXT,
    source_type TEXT DEFAULT 'live',
    media_ref TEXT,
    species TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    bbox JSONB,
    attributes JSONB,
    dosage JSONB,
    drug_recommendation TEXT,
    dosage_mg DOUBLE PRECISION,
    dosage_per_kg DOUBLE PRECISION,
    dosage_confidence DOUBLE PRECISION,
    dosage_notes TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    location_name TEXT,
    status TEXT DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Ensure all columns exist if table existed prior
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS uploader_id TEXT;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS uploader_name TEXT;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'live';
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS media_ref TEXT;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS species TEXT;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS bbox JSONB;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS attributes JSONB;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS dosage JSONB;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS drug_recommendation TEXT;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS dosage_mg DOUBLE PRECISION;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS dosage_per_kg DOUBLE PRECISION;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS dosage_confidence DOUBLE PRECISION;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS dosage_notes TEXT;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS location_name TEXT;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new';
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW());

CREATE INDEX IF NOT EXISTS idx_detections_species ON public.detections(species);
CREATE INDEX IF NOT EXISTS idx_detections_created_at ON public.detections(created_at DESC);

ALTER TABLE public.detections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Detections are accessible by authenticated users" ON public.detections;
CREATE POLICY "Detections are accessible by authenticated users"
    ON public.detections FOR ALL
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Detections anon read and write" ON public.detections;
CREATE POLICY "Detections anon read and write"
    ON public.detections FOR ALL
    TO anon
    USING (true);
