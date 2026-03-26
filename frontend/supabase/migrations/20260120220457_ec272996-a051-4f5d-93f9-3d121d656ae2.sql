-- Atribuir role admin ao primeiro usuário (contato@illumiai.com)
INSERT INTO public.user_roles (user_id, role)
VALUES ('5e53c75a-397f-4240-923d-5aa6d396078c', 'admin');

-- Função que atribui role padrão ao novo usuário
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Atribuir 'analista' como role padrão para novos usuários
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'analista');
  
  RETURN new;
END;
$$;

-- Trigger executado após criar usuário no auth.users
CREATE TRIGGER on_auth_user_created_add_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();