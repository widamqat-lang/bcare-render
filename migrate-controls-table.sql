-- Migration: Add redirect_to column to controls table if it doesn't exist
-- Run this if you already have a controls table without the redirect_to column

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'controls' AND column_name = 'redirect_to'
  ) THEN
    ALTER TABLE controls ADD COLUMN redirect_to TEXT;
    RAISE NOTICE 'Added redirect_to column to controls table';
  ELSE
    RAISE NOTICE 'redirect_to column already exists in controls table';
  END IF;
END $$;

-- Add index on action column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'controls' AND indexname = 'controls_action_idx'
  ) THEN
    CREATE INDEX controls_action_idx ON controls(action);
    RAISE NOTICE 'Created index on action column';
  ELSE
    RAISE NOTICE 'Index on action column already exists';
  END IF;
END $$;