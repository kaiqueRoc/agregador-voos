# Instruções do projeto

Antes de criar ou alterar código, siga a arquitetura e os padrões descritos em:

@ARCHITECTURE.md

Resumo das regras que não podem ser quebradas:
- Regra de negócio fica só em `src/core`. Controllers apenas recebem, delegam ao use case e respondem.
- `core` nunca importa nada de `infra` (banco, HTTP, APIs externas, telemetria).
- Código sempre em inglês. Funções pequenas, com uma responsabilidade.
- Integrações externas (incluindo o mock da API de voos) ficam em `src/infra/gateways`.