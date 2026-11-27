-- Preserve the lifecycle state of shops that existed before the onboarding split.
UPDATE daga_stores SET onboarding_status=status WHERE onboarding_status='pending' AND status IN ('approved','rejected','suspended');
