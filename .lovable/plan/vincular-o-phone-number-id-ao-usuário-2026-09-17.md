# Vincular o Phone Number ID ao usuário

## Alterações
- Adicionar em **Configurações > Minha clínica > Meu usuário** um campo específico para o Phone Number ID da Meta, separado do telefone público da clínica.
- Ao abrir a tela, carregar a configuração do usuário conectado.
- Ao salvar, aceitar somente dígitos e criar ou atualizar `medico_whatsapp_config` pelo usuário conectado, com `agendamento_ativo` ativado por padrão.
- Manter os demais dados da clínica no comportamento atual.
- Criar agora a configuração de Kaio Zubler com `1456440990878494`.

## Validação
- Confirmar que o campo rejeita formatação ou caracteres não numéricos.
- Confirmar no banco que Kaio está vinculado ao identificador informado.
