-- Add has_pos column to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS has_pos BOOLEAN DEFAULT false;
