
ALTER TABLE public.global_config ADD COLUMN org_id text NOT NULL DEFAULT '';

-- Drop existing unique constraint on key and add new one including org_id
ALTER TABLE public.global_config DROP CONSTRAINT IF EXISTS global_config_key_key;
ALTER TABLE public.global_config ADD CONSTRAINT global_config_org_key UNIQUE (org_id, key);
