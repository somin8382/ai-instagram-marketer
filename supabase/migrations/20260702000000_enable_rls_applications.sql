-- Enable RLS on applications.
-- No existing migration touches this table's RLS.
-- Deploy this AFTER the corresponding code changes are live (link route,
-- anon→auth swap in fetchMyPageSnapshot / fetchSavedGeneratedPosts,
-- re-poisoning prevention in submit functions).

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- SELECT: own rows by user_id; OR unlinked rows (user_id IS NULL) whose email
-- matches the session — needed so fetchMyPageSnapshot / fetchSavedGeneratedPosts
-- can find pre-login submissions before the link route has run.
CREATE POLICY applications_select_own ON applications
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR (user_id IS NULL AND lower(email) = lower(auth.email()))
  );

-- INSERT: user_id check only. No email = auth.email() clause — the re-poisoning
-- guard in code stores user_id = NULL on email mismatch; that row must still
-- pass this check so the graceful link-later flow is not broken.
CREATE POLICY applications_insert_own ON applications
  FOR INSERT
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- UPDATE: also allow updating own still-unlinked rows (persistGrantedApplicationSubmission
-- updates rows that may have user_id IS NULL, matched via email).
CREATE POLICY applications_update_own ON applications
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (user_id IS NULL AND lower(email) = lower(auth.email()))
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (user_id IS NULL AND lower(email) = lower(auth.email()))
  );

-- service_role bypasses RLS by default.
-- No policy needed for admin overview or the link route.
