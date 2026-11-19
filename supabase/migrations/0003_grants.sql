-- Tables created by a migration do not automatically pick up Supabase's default privileges
-- unless they are created by the role those defaults are attached to. Without this, every
-- query from the server fails with "permission denied for table designs" even though the
-- service role is supposed to bypass RLS — RLS is never reached, because the grant check
-- comes first.
--
-- Only service_role is granted. anon and authenticated deliberately get nothing: RLS already
-- blocks them, and withholding the grant as well means a leaked publishable key cannot read
-- a single row even if a policy is ever added by mistake.

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Anything added by a later migration, too.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- Make sure the public roles really do hold nothing.
revoke all on all tables in schema public from anon, authenticated;
