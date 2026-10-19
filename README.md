# Agregador de Provedores de Voos

Consulta três provedores de passagens **em paralelo**, normaliza os contratos de
cada um, elimina duplicidades, escolhe a oferta de cada voo pela regra de
negócio e devolve uma resposta única e ordenada. Cada busca fica registrada
para análise num dashboard.

**Stack:** Node.js 24 · TypeScript · Fastify · Redis · PostgreSQL · Vitest ·
Docker · Prometheus · Grafana · OpenTelemetry · GitHub Actions · AWS EC2

---

## Como rodar

```bash
docker compose -f docker/docker-compose.yml up --build   # providers + redis + postgres + agregador → http://localhost:8000
```

```bash
curl -X POST localhost:8000/search -H 'Content-Type: application/json' \
  -d '{"origin":"GRU","destination":"GIG","date":"2026-12-20"}'
```

| Comando                         | O que faz                                                         |
|---------------------------------|-------------------------------------------------------------------|
| `make observability`            | sobe também Grafana (`:3000`), Prometheus, Loki e Jaeger          |
| `make public` / `.\scripts\public.ps1` | publica API e dashboard na internet ([ver abaixo](#acesso-público)) |
| `make chaos` / `make calm`      | provider-c com 30% de erro 500 e 30% de travamento / normal       |
| `make test` / `make test-db`    | testes / incluindo integração com Postgres real                   |
| `make e2e`                      | E2E contra a stack de pé (local ou o deploy, via `E2E_BASE_URL`)  |
| `make lint`                     | Biome + typecheck                                                 |

Portas no host: agregador `8000`, providers `3001–3003`, Redis `6379`,
Postgres **`5433`** (para não colidir com um Postgres instalado na máquina).

---

## API

**`POST /search`** com `{ "origin": "GRU", "destination": "GIG", "date": "2026-12-20" }`.
Aceita também os nomes do enunciado (`origem`, `destino`, `data`). A data tem que
ser **de hoje em diante** (no fuso de São Paulo, configurável por
`SEARCH_TIMEZONE`); data no passado → `400`. Para testar no navegador:
`GET /search?origin=GRU&destination=GIG&date=2026-12-20`.

```jsonc
{
  "query": { "origin": "GRU", "destination": "GIG", "date": "2026-12-20" },
  "flights": [{
    "id": "VOEPASS-GRUGIG-202612202225", "airline": "VOEPASS",
    "origin": "GRU", "destination": "GIG",
    "departureAt": "2026-12-20T22:25", "arrivalAt": "2026-12-20T23:48", "durationMinutes": 83,
    "price": { "amount": 412.88, "currency": "BRL" },
    "provider": "provider-b",
    "offersCompared": 3                 // quantos providers vendiam este voo
  }],
  "meta": {
    "total": 60, "partial": false, "strategy": "balanced", "durationMs": 422,
    "providers": [{ "name": "provider-c", "status": "timeout", "offers": 0,
                    "cached": false, "latencyMs": 3001, "discarded": 0 }]
  }
}
```

| Status | Quando |
|--------|--------|
| 200 | ao menos um provider respondeu (`meta.partial` diz se faltou algum) |
| 400 | entrada inválida; `details` traz o erro por campo |
| 429 | passou do limite de buscas por cliente |
| 503 | **nenhum** provider respondeu (com `Retry-After`): "não há voos" seria falso |

Operação: `GET /` (endpoints + link de teste), `GET /health` (liveness),
`GET /ready` (Redis, Postgres e circuitos), `GET /metrics` (Prometheus, só na rede interna).

---

## Arquitetura

```
infra/http (Fastify)          rotas → controller: valida, chama o caso de uso, responde
  └─ SearchFlightsUseCase     core: consolidar e registrar ──► SearchRecorder (Postgres, em background)
       └─ FlightOffersGateway  interface no core; ProviderGateway em infra: cache (Redis) + single-flight
            └─ ProviderClient × 3, em paralelo
                 circuit breaker → orçamento de 3s → retry → fetch → normalizador
       └─ core/entities       aggregate(): agrupar por voo → estratégia escolhe 1 oferta → ordenar
```

Segue o [ARCHITECTURE.md](ARCHITECTURE.md): `infra` depende de `core`, e o
`core` nunca importa `infra`.

```
aggregator/src/
├── config/env/           variáveis de ambiente validadas na subida
├── core/                 regra de negócio, sem I/O
│   ├── entities/         oferta, companhia, estratégias, agregação, resultado da busca
│   ├── use-cases/        search-flights, check-readiness
│   ├── gateways/         interfaces: FlightOffersGateway, HealthCheck, SearchMetrics
│   └── repositories/     interface: SearchRecorder
├── infra/
│   ├── database/         repositories/ (Postgres) + migrations/ (schema de analytics)
│   ├── gateways/         flights/ (normalizers, client, gateway, cache Redis) + resilience/
│   ├── http/             build-app, controllers/, routes/, middlewares/ (log, rede do cliente)
│   └── telemetry/        logger/, metrics/, tracing/
├── shared/utils/         utilitários genéricos (datas, comparação de strings)
├── container.ts          composition root: único lugar que monta as peças reais
└── server.ts             entry point + graceful shutdown

mocks/                    os 3 providers simulados (Python, mesma imagem, contratos diferentes)
docker/                   Dockerfile do agregador e docker-compose.yml
observability/            Prometheus, Alloy → Loki e Grafana (datasources + dashboard)
scripts/public.ps1        acesso público via Cloudflare Quick Tunnel (Windows)
deploy/ec2-user-data.sh   bootstrap da VM na AWS EC2
.github/workflows/ci.yml  lint, typecheck, testes, build e E2E com docker compose
```

**Decisões**

- **Domínio isolado.** `core/` não conhece HTTP, Redis, Postgres nem
  telemetria: fala só com interfaces, e a regra é testada sem rede.
- **Anti-corruption layer.** O formato de cada provider existe só em
  `provider-normalizers.ts`. Um provider novo é um normalizador + URL/comissão na config.
- **Strategy pattern** para a escolha de oferta: três estratégias trocáveis por env.
- **Dinheiro em centavos inteiros**, comissão em basis points (100 bps = 1%).
- **Falha de provider é resultado, não exceção.** O cliente devolve
  `status: ok | error | timeout | circuit_open` e a busca segue com o resto.
- **Dependências auxiliares não derrubam a busca.** Redis, Postgres ou tracing
  fora degradam o serviço (visível no `/ready`), mas a busca responde.
- **Injeção de dependência sem framework:** `fetch`, Redis, Postgres e relógio
  são injetáveis, e os testes rodam a app inteira sem rede.

---

## Regra de negócio: qual oferta exibir

Quando vários providers vendem o mesmo voo, a estratégia padrão (`balanced`):

1. toma a oferta **mais barata** como referência do cliente;
2. aceita ofertas até **+2%** acima dela, **limitado a R$ 30** (vale o menor);
3. dentro dessa faixa, exibe a que rende **mais comissão em reais**;
4. desempata por preço e nome do provider (determinístico).

**Por quê:** "não prejudicar significativamente o cliente" vira uma garantia
explícita e auditável: nunca mais de 2% ou R$ 30 acima do menor preço do mesmo
voo. O percentual acompanha a percepção de preço; o teto absoluto protege
passagens caras, onde 2% seria muito dinheiro. A comissão é comparada em reais,
porque é o que de fato se ganha.

Com os markups dos mocks (B ≈ 1,5% mais barato que A; C ≈ 1,2% mais caro), para
R$ 1.000 em A:

| Vendido por | Preço A / B / C     | Comissão A / B / C    | Exibe | Por quê |
|-------------|---------------------|-----------------------|-------|---------|
| A + B       | 1.000 / 985 / –     | 10,00 / 14,78 / –     | **B** | mais barato **e** mais lucrativo |
| A + C       | 1.000 / – / 1.012   | 10,00 / – / 20,24     | **C** | +1,2% ao cliente (R$ 12) por +R$ 10,24 de comissão |
| B + C       | – / 985 / 1.012     | – / 14,78 / 20,24     | **B** | C custaria +2,74%: fora da faixa |
| A + B + C   | 1.000 / 985 / 1.012 | 10,00 / 14,78 / 20,24 | **B** | idem |

> **O que o dashboard mostrou:** na troca A → C a empresa ganha cerca de
> **R$ 0,85 para cada R$ 1** que o cliente paga a mais. A regra é cumprida, mas
> essa troca transfere mais do cliente do que gera. É o sinal para recalibrar,
> por exemplo exigindo eficiência ≥ 1 como condição extra.

**Alternativas:** `cheapest` (ignora a comissão), `max_commission` (sem teto para
o cliente, perde conversão) e score ponderado (`comissão − λ·sobrepreço`: λ é
difícil de calibrar e não dá garantia ao cliente). `cheapest`, `max_commission`
e `balanced` estão implementadas e trocam por `SELECTION_STRATEGY`.

**Limites da estratégia:** ela não enxerga conversão (a tolerância certa sairia
de um teste A/B) e os parâmetros são globais (poderiam variar por rota ou
antecedência).

---

## Normalização e deduplicação

| Provider | Lista     | Companhia      | Preço                 | Horário               | Sujeira enviada |
|----------|-----------|----------------|-----------------------|-----------------------|-----------------|
| A        | `flights` | `company`      | `price` (reais)       | ISO 8601 completo     | –               |
| B        | `results` | `airline_name` | `amount` (centavos) + `currency` | `HH:MM`    | tarifa em USD   |
| C        | `data`    | `carrier`      | `fare` (reais)        | `HH:MM`               | tarifa R$ 0,00  |

- **Companhia:** sem acento, sem sufixo ("Linhas Aéreas", "Airlines"), com
  aliases (`Passaredo → VOEPASS`).
- **Horário:** `HH:MM` + data da busca; chegada ≤ partida ganha +1 dia.
- **Registro inválido** (preço ≤ 0, moeda ≠ BRL, campo faltando) é descartado
  sozinho e contado em `meta.providers[].discarded`. Moeda estrangeira não é
  convertida: sem câmbio confiável, seria inventar preço.
- **Mesmo voo** = companhia + rota + horário de partida (os providers não
  expõem número de voo).
- **Ordenação total:** preço exibido, partida, companhia, provider. Busca igual
  devolve sempre a mesma lista.

---

## Resiliência

| Mecanismo | Comportamento |
|-----------|---------------|
| Paralelismo | `Promise.all`: a busca leva o tempo do provider mais lento, não a soma |
| Timeout de 3s | cobre o **total** do provider, retries incluídos |
| Retry | até 3 tentativas, só em 5xx e erro de rede; backoff exponencial com jitter |
| Circuit breaker | 5 falhas seguidas → provider pulado por 30s; depois, 1 chamada de teste |
| Falha parcial | responde com o que houver e `meta.partial: true` |
| Single-flight | buscas idênticas simultâneas dividem a mesma chamada (evita *cache stampede*) |
| Redis / Postgres fora | cache miss / gravação perdida com log e métrica; a busca segue |
| Graceful shutdown | termina requisições e gravações em andamento antes de sair |

Validado com `make chaos`: os erros 500 foram recuperados por retry, os
travamentos foram cortados em 3,0s com resposta parcial (55 de 60 voos) e
nenhuma busca passou de 3,06s.

---

## Cache

Redis, **TTL de 5 min, por provider** (`offers:v2:{provider}:{origem}:{destino}:{data}`).

- **Por provider, e não a resposta final:** se o C falhou, A e B ficam no
  cache e só o C é reconsultado.
- **Falha não é cacheada.**
- **A seleção roda a cada busca**, sobre o cache (cerca de 120 ofertas, custo
  desprezível), e a comissão vem sempre da config atual. Mudar estratégia ou
  comissão não exige invalidar nada.
- Uma ida ao Redis (`MGET`) para os três providers. Busca repetida: ~420ms → ~1ms.

---

## Observabilidade

- **Logs (pino, JSON):** **uma linha por requisição** (*canonical log line*),
  com rota, status, latência, `reqId`, `trace_id` e o resumo da busca por
  provider. Eventos de exceção (retry, timeout, circuito, falha de gravação)
  saem como linhas próprias. Probes ficam em `debug`; credenciais são mascaradas.
- **Métricas (Prometheus):** RED por rota (`route` = template, nunca a URL
  crua); por provider: status, latência, retries, circuito e descartes; cache;
  gravações; e de **negócio**: voos exibidos por provider, comissão extra e
  sobrepreço ao cliente.
- **Traces (OpenTelemetry → Jaeger):** requisição → providers → Redis → Postgres.
- **Logs no Grafana (Loki):** o Grafana Alloy coleta o stdout de todos os
  containers e envia para o Loki. O JSON é interpretado na consulta (`| json`),
  sem criar labels, o que mantém a cardinalidade baixa. No log, o `trace_id`
  vira um link que abre o trace no Jaeger.

---

## Analytics e dashboard

Cada busca é gravada no Postgres **em background**: no máximo 200 gravações
pendentes (acima disso descarta e conta na métrica), uma transação por busca,
insert em lote via `unnest`. O schema é idempotente e aplicado na subida.

| Tabela | Uma linha por | Para quê |
|--------|---------------|----------|
| `searches` | busca | volume, rotas, % parcial |
| `search_providers` | provider consultado | confiabilidade real de cada provider |
| `search_flights` | voo exibido | oferta **escolhida e mais barata lado a lado** |
| `flight_selection_economics` (view) | voo exibido | comissão extra e sobrepreço já calculados |

**Dashboard** (Grafana, `make observability` → http://localhost:3000, sem
login), em quatro seções:

| Seção | Fonte | O que mostra |
|-------|-------|--------------|
| Negócio | Postgres | eficiência da regra (R$ ganho × R$ cobrado), voos por provider, quem vence nas disputas, rotas, confiabilidade por provider |
| Operação | Prometheus | buscas/s, p50/p95/p99, hit rate do cache, latência e status por provider, circuit breaker |
| Erros | Prometheus | taxa de erro interno (500), % de buscas incompletas, respostas por status (400/429/503), falhas de provider por tipo, falhas de cache e banco |
| Logs | Loki | volume por nível, warn + error, buscas recentes (uma linha por requisição), eventos de resiliência |

Níveis de log: `error` só para bug nosso (5xx), `warn` para degradação externa
(provider fora, timeout, 503). Um alerta em `error` não dispara quando um
provider cai.

SQL padrão: troca para um Postgres gerenciado (Supabase, RDS) só com
`DATABASE_URL` e `DATABASE_SSL=true`.

---

## Acesso público

O serviço roda na máquina local e é publicado por um **Cloudflare Quick
Tunnel**: HTTPS, sem conta, sem domínio e sem abrir porta no roteador (a
conexão *sai* da máquina para a Cloudflare).

```powershell
.\scripts\public.ps1          # sobe tudo e mostra as URLs (url: só mostra; stop: derruba)
```

| Risco | Proteção |
|-------|----------|
| Abuso da API | 60 buscas/min por cliente, pelo IP real (`CF-Connecting-IP`) |
| Vazamento de métricas | `/metrics` responde 404 para quem vem da internet |
| Invasão do Grafana | login desligado por completo (formulário e basic auth); só leitura |
| Logs expostos | o Loki não passa pelo tunnel; só o Grafana (somente leitura) consulta |
| Banco e cache expostos | não passam pelo tunnel |

Limitações: a URL muda quando o tunnel reinicia, e a máquina precisa ficar
ligada. Para uma URL fixa: *named tunnel* da Cloudflare (com domínio) ou o
domínio estático grátis do ngrok.

---

## Testes

158 testes (150 de unidade e integração, 1 com Postgres real e 7 E2E), cerca de
97% de cobertura de linhas: estratégias e cenários da
regra, normalizadores (dados sujos, virada de meia-noite, float), circuit
breaker e retry com relógio falso, cliente (retry, timeout, circuito), cache,
gateway, persistência, e a app inteira via `fastify.inject` (falha parcial,
503, cache, single-flight, rate limit, log por requisição). Com
`TEST_DATABASE_URL` roda também contra Postgres real.

**E2E** (`tests/e2e`): roda contra a stack **de verdade** por HTTP: os 3 mocks
originais, 60 voos únicos, descarte dos registros sujos, ordenação, cache e
validação. O mesmo teste valida a máquina local e o deploy:

```bash
E2E_BASE_URL=http://localhost:8000 npm run test:e2e     # dentro de aggregator/
E2E_BASE_URL=http://<ip-da-vm>:8000 npm run test:e2e
```

A CI executa lint, typecheck, testes com Postgres real, build, e depois sobe a
stack com `docker compose` e roda o E2E.

---

## Trade-offs

| Decisão | Ganho | Custo |
|---------|-------|-------|
| Cache por provider | falha parcial não contamina o cache | agregação refeita a cada busca (barata) |
| Preço cacheado por até 5 min | latência e carga nos providers | preço pode estar defasado: reconfirmar na reserva |
| Breaker, single-flight e rate limit em memória | simples, sem dependência | cada réplica tem o próprio estado |
| Timeout de 3s incluindo retries | latência máxima previsível | menos tentativas com provider lento |
| Voo identificado sem número de voo | funciona com os dados disponíveis | depende da normalização de companhia e horário |
| Horários locais, sem fuso | é o que os providers entregam | duração errada entre fusos diferentes |
| Gravação em background com limite | o banco nunca atrasa a busca | sob pico, buscas podem faltar no analytics |
| Feature flags por env | zero dependência | mudar exige reiniciar |

## Evolução para produção

- Reconfirmar o preço no provider na hora da reserva.
- Estado de resiliência e rate limit compartilhados (Redis) com várias réplicas.
- Stale-while-revalidate no cache, inclusive com o circuito aberto.
- A/B da tolerância medindo conversão × comissão; feature flags dinâmicas.
- Analytics em escala: fila (outbox, SQS) e banco colunar; particionar por data.
- Contract tests com os providers; autenticação; WAF; usuário somente leitura para o Grafana.
- SLOs e alertas: p95, % de respostas parciais, circuito aberto, gravações descartadas.

---

## Configuração

Variáveis de ambiente, validadas na subida (config inválida não sobe). Ver
[`aggregator/src/config/env/load-config.ts`](aggregator/src/config/env/load-config.ts).

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PROVIDER_{A,B,C}_URL` | `localhost:300x` | endpoint de cada provider |
| `PROVIDER_{A,B,C}_ENABLED` | `true` | liga/desliga o provider |
| `PROVIDER_{A,B,C}_COMMISSION_BPS` | `100` / `150` / `200` | comissão em basis points |
| `PROVIDER_TIMEOUT_MS` | `3000` | orçamento total por provider |
| `RETRY_MAX_ATTEMPTS` / `RETRY_BASE_DELAY_MS` / `RETRY_MAX_DELAY_MS` | `3` / `100` / `800` | retry |
| `BREAKER_FAILURE_THRESHOLD` / `BREAKER_RESET_TIMEOUT_MS` | `5` / `30000` | circuit breaker |
| `REDIS_URL` / `CACHE_ENABLED` / `CACHE_TTL_SECONDS` | `redis://localhost:6379` / `true` / `300` | cache |
| `PERSISTENCE_ENABLED` / `DATABASE_URL` / `DATABASE_SSL` / `PERSISTENCE_MAX_PENDING` | `false` / `postgres://…@localhost:5433/aggregator` / `false` / `200` | analytics (o compose liga) |
| `RATE_LIMIT_ENABLED` / `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `true` / `60` / `60000` | limite por cliente |
| `SEARCH_TIMEZONE` | `America/Sao_Paulo` | fuso usado para saber que dia é "hoje" |
| `SELECTION_STRATEGY` | `balanced` | `cheapest` \| `max_commission` \| `balanced` |
| `PRICE_TOLERANCE_BPS` / `PRICE_TOLERANCE_MAX_CENTS` | `200` / `3000` | faixa da `balanced` (2%, R$ 30) |
| `LOG_LEVEL` / `LOG_PRETTY` | `info` / `false` | logs |
| `OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` | `false` / – | tracing |
