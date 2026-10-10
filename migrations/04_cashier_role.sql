-- Add the cashier role (POS-only access). Permissions per role live in src/config/permissions.js;
-- user_permissions holds extra grants on top of a user's role.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'accountant', 'user', 'cashier'));

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
