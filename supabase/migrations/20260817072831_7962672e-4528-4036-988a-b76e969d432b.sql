-- Trigger-only helpers: nobody should call these over the API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- has_role is used inside RLS policies evaluated as the signed-in user,
-- so authenticated must keep EXECUTE; anon never needs it.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Split pricing plan reads so the anon path never calls has_role
DROP POLICY "Active plans are public" ON public.pricing_plans;
CREATE POLICY "Anon reads active plans" ON public.pricing_plans
  FOR SELECT TO anon USING (active = true);
CREATE POLICY "Users read plans" ON public.pricing_plans
  FOR SELECT TO authenticated USING (active = true OR public.has_role(auth.uid(), 'admin'));