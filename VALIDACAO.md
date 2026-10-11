# Validação da entrega

Os testes em `test/` executam o schema SQL e o servidor real da aplicação com um engine PostgreSQL embutido (PGlite), sem dados pessoais ou e-mails reais.

Verificações cobertas:

- Formato numérico de telefone e tamanho de senha em bytes.
- Cadastro, confirmação de e-mail de uso único e normalização do endereço.
- Conta vinculada a duas empresas, com papel diferente em cada uma.
- Convite restrito ao e-mail, de uso único; expiração e revogação.
- Colaborador impedido de criar convite ADM ou acessar outros leads.
- Administrador restrito à sua empresa; proteção do último ADM ativo.
- Leads, histórico, contato, contrato, recebimento inicial e ações com conclusão.
- Rejeição de contrato duplicado; cancelamento preserva receita histórica.
- Cálculo de taxas, inatividade e receitas somente de leads convertidos.
- Proteção CSRF, logout, cookie persistente e redefinição de senha com revogação de sessões.

`npm audit --omit=dev` não identificou vulnerabilidades conhecidas nas dependências de produção na auditoria desta entrega. Esse resultado é temporal e não garante ausência de falhas futuras.

O envio SMTP real, o servidor PostgreSQL externo, a publicação e o domínio não foram configurados neste ambiente. Execute o roteiro de PUBLICAR-AGORA.md e confira esses serviços no destino antes de disponibilizar a usuários reais.

A interface foi exercitada em Chromium headless em 1440 px e 390 px: cadastro, confirmação, criação de empresa, lead, contato, contrato, histórico e geração de convite ADM. Não houve erro JavaScript ou rolagem horizontal no fluxo móvel verificado.

Versão 2.1: testes adicionais verificam exigência de HTTPS, conta de proprietário com confirmação adicional vinculada ao navegador, rejeição de elevação de privilégio, criação de empresa restrita, cadastro por convite com e-mail Proton, suspensão/reativação de empresa, auditoria, cookie Secure, health check e compartilhamento dos limites persistidos. SMTP real, DNS e hospedagem continuam não verificados no destino.

A interface 2.1 também passou pelo fluxo de confirmação adicional do proprietário e painel da plataforma em Chromium. O render.yaml foi validado contra o schema oficial do Render.
