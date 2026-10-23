-- Large atomic note families can exceed the default authenticated RPC timeout.
-- PostgREST hoists this function setting before executing the transaction.
-- Keep the exception bounded and specific to the validated content-sync RPC.
ALTER FUNCTION public.sync_workspace_content(jsonb, jsonb)
  SET statement_timeout = '60s';

NOTIFY pgrst, 'reload schema';
