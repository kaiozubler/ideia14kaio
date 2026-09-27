# Corrigir validade da sessão VIDaaS

## Alterações
- Persistir no vínculo interno a mesma validade solicitada ao Integra BRy, em vez do padrão incorreto de 15 minutos.
- Garantir que consultas e assinaturas aceitem a sessão VIDaaS durante todo o período contratado, mantendo a validação por médico e o token protegido.
- Corrigir a validade do vínculo VIDaaS recém-criado, que ainda está dentro dos 7 dias concedidos pela BRy.
- Melhorar a mensagem retornada quando um vínculo realmente expirar.

## Validação
- Confirmar que o certificado VIDaaS aparece como ativo para o médico que fez o vínculo.
- Repetir a assinatura pela rota usada pelo app e conferir os registros do servidor.
