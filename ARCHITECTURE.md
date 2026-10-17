# Arquitetura e Padrões do Projeto

Princípio central: **código simples, responsabilidades bem definidas e regras de negócio isoladas de framework e infraestrutura.**

## Índice

1. [Estrutura de pastas](#1-estrutura-de-pastas)
2. [Regra de dependência](#2-regra-de-dependência)
3. [Onde cada coisa fica](#3-onde-cada-coisa-fica)
4. [Padrões de código](#4-padrões-de-código)
5. [Testes e mocks](#5-testes-e-mocks)
6. [Proibido](#6-proibido)
7. [Checklist antes de escrever código](#7-checklist-antes-de-escrever-código)

---

## 1. Estrutura de pastas

```text
.github/
└── workflows/               # CI/CD: build, testes, lint, deploy

docker/
├── Dockerfile               # Imagem da aplicação
├── Dockerfile.dev           # Imagem de desenvolvimento
└── docker-compose.yml       # Ambiente local

src/
├── config/
│   └── env/                 # Variáveis e validação de ambiente
│
├── core/                    # Regras de negócio (sem dependência de infra)
│   ├── entities/            # Entidades e objetos de domínio
│   ├── use-cases/           # Casos de uso
│   ├── repositories/        # Interfaces de persistência
│   ├── gateways/            # Interfaces de integrações externas
│   └── errors/              # Erros de domínio
│
├── infra/                   # Implementações técnicas
│   ├── database/
│   │   ├── repositories/    # Implementam as interfaces de core/repositories
│   │   └── migrations/
│   ├── http/
│   │   ├── controllers/
│   │   ├── routes/
│   │   └── middlewares/
│   ├── gateways/            # Implementam as interfaces de core/gateways
│   │   ├── hotelbeds/
│   │   ├── ratehawk/
│   │   ├── oracle/
│   │   ├── flights/         # Integração real com a API externa de voos
│   │   └── mocks/           # Simulam APIs externas (ex.: API de voos)
│   │       └── flights/
│   └── telemetry/
│       ├── logger/
│       ├── metrics/
│       └── tracing/
│
└── shared/
    ├── types/
    ├── utils/
    └── constants/

tests/
├── unit/                    # Espelha a estrutura de src/core
├── integration/
├── e2e/
└── mocks/
    ├── repositories/
    ├── gateways/
    └── factories/
```

---

## 2. Regra de dependência

`infra` depende de `core`. `core` nunca depende de `infra`.

```text
┌─────────────────────────────────────┐
│               INFRA                 │
│  HTTP · Database · Gateways · Telemetry
└──────────────────┬──────────────────┘
                   │ implementa / chama
                   ▼
┌─────────────────────────────────────┐
│               CORE                  │
│  Entities · Use Cases · Interfaces  │
└─────────────────────────────────────┘
```

O `core` define **o que** a aplicação faz. A `infra` define **como** a tecnologia executa. O `core` conhece apenas a abstração, e a `infra` fornece a implementação:

```text
core/repositories/property-repository.ts                       ← interface
infra/database/repositories/postgres-property-repository.ts    ← implementação
```

O `core` não pode importar:

- framework HTTP
- ORM ou driver de banco
- SDKs e APIs externas
- ferramenta de observabilidade
- sistema de arquivos

---

## 3. Onde cada coisa fica

| Camada | Responsabilidade | Não faz |
|---|---|---|
| `core/entities` | Objetos e regras do domínio | Acessar banco ou rede |
| `core/use-cases` | Orquestrar regras de negócio | Conhecer HTTP, ORM ou SDK externo |
| `core/repositories`, `core/gateways` | Contratos (interfaces) | Ter implementação |
| `infra/http/controllers` | Receber requisição, chamar use case, devolver resposta | Regra de negócio, consulta ao banco, chamada externa |
| `infra/database/repositories` | Persistência | Decidir regras ("se o hotel estiver cancelado...") |
| `infra/gateways` | Integração com serviços externos (hotéis, voos) e seus mocks | Vazar detalhes da API externa para fora |
| `infra/telemetry` | Logs, métricas, tracing, correlation ID | Conter regra de negócio |
| `shared` | Tipos, utilitários e constantes genéricos | Conter regra de negócio |

### Controllers

Fluxo: `Request → Controller → Use Case → Repository/Gateway → Response`

O controller faz quatro coisas:

1. Recebe a requisição.
2. Valida e normaliza a entrada, quando necessário.
3. Chama o use case.
4. Converte o resultado em resposta HTTP.

```ts
async create(request, response) {
  const result = await this.createProperty.execute(request.body);

  return response.status(201).json(result);
}
```

### Gateways

Cada integração esconde os detalhes da API externa. O resto da aplicação não deve conhecer URLs, headers, autenticação, formato proprietário nem tratamento de erro específico do fornecedor.

### Telemetria

Toda observabilidade fica em `src/infra/telemetry/`. Se o `core` precisar registrar algo, ele usa uma interface:

```text
core → interface → infra/telemetry → OpenTelemetry / Logger / Metrics
```

---

## 4. Padrões de código

### Idioma

Todo o código em **inglês**: arquivos, variáveis, funções, classes e nomes de domínio.

### Nomenclatura

| Item | Convenção | Exemplo |
|---|---|---|
| Arquivos | `kebab-case` | `create-property.ts`, `property-repository.ts` |
| Variáveis e funções | `camelCase` | `propertyId`, `createProperty()` |
| Classes | `PascalCase` | `CreatePropertyUseCase`, `PostgresPropertyRepository` |
| Constantes globais | `UPPER_SNAKE_CASE` | `MAX_RETRY_ATTEMPTS` |

### Tamanho das funções

Cada função tem uma única responsabilidade. Referência: **até 20 linhas**. É uma orientação, não um dogma: ao passar do limite, avalie se há uma responsabilidade a extrair, mas não crie abstração artificial só para caber no número.

```text
processProperty()
├── validateProperty()
├── normalizeProperty()
├── createProperty()
└── persistProperty()
```

### Tipagem

Prefira `unknown` ou tipos explícitos. `any` só com justificativa registrada em comentário.

### Erros

Todo erro deve ser tratado, transformado, propagado ou registrado. Nunca engolido:

```ts
// Errado
try {
  await execute();
} catch {}
```

---

## 5. Testes e mocks

### Níveis de teste

| Nível | O que testa | Exemplos |
|---|---|---|
| `unit` | Uma unidade isolada | Entities, use cases (`tests/unit/core/...`) |
| `integration` | Componentes reais conversando | Use case + repository, repository + banco, gateway + mock server |
| `e2e` | Fluxo completo via HTTP, com a API de voos simulada pelo mock | `tests/e2e/property/`, `tests/e2e/flight/`, `tests/e2e/booking/` |

### Mocks

- Mocks compartilhados dos testes ficam em `tests/mocks/` (`repositories/`, `gateways/`, `factories/`).
- Mocks que **simulam uma API externa** (como a de voos) ficam em `src/infra/gateways/mocks/`, separados por integração (`mocks/flights/`).
- Não espalhe mocks fora desses dois lugares.

### Mock da API externa de voos

O projeto usa mocks para simular a API externa de voos (busca, disponibilidade, reserva, cancelamento). Regras:

- O mock implementa a **mesma interface** do `core/gateways` (ex.: `FlightGateway`) que a integração real em `infra/gateways/flights/`. O `core` não sabe qual das duas está em uso.
- A escolha entre mock e API real é feita na composição da aplicação, por variável de ambiente validada em `config/env` (ex.: `FLIGHTS_GATEWAY=mock|real`). Nenhum `if (mock)` dentro de use case ou controller.
- O mock reproduz o contrato da API real: formato de resposta, códigos de erro, timeouts e casos de falha (voo sem disponibilidade, tarifa expirada, erro 5xx). Dados e cenários de teste ficam no próprio mock, não espalhados pelos testes.
- Respostas do mock são determinísticas para os mesmos parâmetros, para que testes e demos sejam reproduzíveis.
- Para testes de integração do gateway real, use um mock server HTTP (ex.: serviço no `docker-compose.yml`) em vez de chamar a API de verdade.
- Quando a API real passar a ser usada, o mock continua como fixture de testes. Se o contrato da API mudar, atualize o mock junto com o gateway.

---

## 6. Proibido

| Não fazer | Fazer em vez disso |
|---|---|
| Regra de negócio em controller | Mover para use case ou entity no `core` |
| Acessar banco direto no use case (`prisma.property.findUnique(...)`) | Usar a abstração: `propertyRepository.findById(propertyId)` |
| Chamar API externa no `core` (`axios.get(...)`) | Criar gateway em `infra/gateways` com interface no `core` |
| Regra de negócio em repository | Repository só persiste; a decisão fica no domínio/use case |
| Função que valida, aplica regra, persiste, integra e responde | Separar cada responsabilidade |
| Código em português (`criarHotel()`, `buscarReserva()`) | `createHotel()`, `findBooking()` |
| Interface ou classe criada só "para seguir o padrão" | Abstrair apenas com necessidade real (desacoplar, trocar implementação, testar, reutilizar) |
| Mesma regra implementada em mais de um lugar | Uma única fonte de verdade |
| Funções com dezenas ou centenas de linhas | Quebrar em funções menores |
| `any` sem justificativa | `unknown` ou tipo explícito |
| `catch {}` vazio | Tratar, transformar, propagar ou registrar |

---

## 7. Checklist antes de escrever código

Pergunte onde o código pertence:

1. É regra de negócio? → `core`
2. É entrada HTTP? → `infra/http`
3. É persistência? → `infra/database`
4. É integração externa? → `infra/gateways`
5. É observabilidade? → `infra/telemetry`
6. É só um utilitário genérico? → `shared`