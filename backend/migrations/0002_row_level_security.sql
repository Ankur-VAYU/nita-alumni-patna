-- Supabase publishes tables in the "public" schema through its automatic Data API, which anyone
-- holding the project's public "anon" key can call. Turning on row-level security with no
-- policies blocks that API completely. This app connects as the database owner, which is not
-- affected. On a plain PostgreSQL server this changes nothing.
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
