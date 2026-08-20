REVOKE ALL ON FUNCTION public.sincronizar_user_id_pergunta() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.sincronizar_user_id_pergunta() TO service_role;
REVOKE EXECUTE ON FUNCTION public.formulario_publico(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.termo_publico(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.formulario_publico(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.termo_publico(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.formulario_publico(uuid) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.termo_publico(uuid) TO anon, service_role;