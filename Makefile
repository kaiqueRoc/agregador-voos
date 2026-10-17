JSON = node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

PUBLIC = --profile observability --profile public

# A definição da stack fica em docker/: todo `docker compose` abaixo usa este arquivo.
export COMPOSE_FILE := docker/docker-compose.yml

.PHONY: up down restart logs ps install test cov lint fmt observability search health chaos calm psql test-db public public-url private e2e

up:            ## sobe tudo (providers + redis + agregador)
	docker compose up -d --build

down:          ## derruba tudo e limpa volumes
	docker compose down -v

restart:
	docker compose restart aggregator

logs:
	docker compose logs -f aggregator

ps:
	docker compose ps

public:        ## publica API e dashboard na internet (Cloudflare Quick Tunnel)
	GRAFANA_DISABLE_LOGIN=true GRAFANA_BASIC_AUTH=false OTEL_ENABLED=true docker compose $(PUBLIC) up -d --build --wait
	@$(MAKE) --no-print-directory public-url

public-url:    ## mostra as URLs públicas atuais
	@sleep 3
	@echo "API:       $$(docker compose $(PUBLIC) logs tunnel-api 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)"
	@echo "Dashboard: $$(docker compose $(PUBLIC) logs tunnel-dashboard 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)"

private:       ## derruba os tunnels (volta a ser só local)
	docker compose $(PUBLIC) stop tunnel-api tunnel-dashboard

psql:          ## abre o banco de analytics
	docker compose exec postgres psql -U aggregator -d aggregator

test-db:       ## testes incluindo integração com Postgres real (precisa do compose de pé)
	cd aggregator && TEST_DATABASE_URL=postgres://aggregator:aggregator@localhost:5433/aggregator npm test

e2e:           ## E2E contra a stack de pé (E2E_BASE_URL=http://<ip>:8000 make e2e para o deploy)
	cd aggregator && E2E_BASE_URL=$${E2E_BASE_URL:-http://localhost:8000} npm run test:e2e

install:       ## instala dependências do agregador
	cd aggregator && npm ci

test:
	cd aggregator && npm test

cov:
	cd aggregator && npm run cov

lint:
	cd aggregator && npm run lint && npm run typecheck

fmt:
	cd aggregator && npm run fmt

observability: ## sobe tudo + Grafana (3000) + Jaeger (16686) + Prometheus (9090)
	OTEL_ENABLED=true docker compose --profile observability up -d --build

search:        ## busca de exemplo, com data daqui a 30 dias
	@curl -s "localhost:8000/search?origin=GRU&destination=GIG&date=$$(node -p 'new Date(Date.now()+30*864e5).toISOString().slice(0,10)')" | $(JSON)

health:
	@curl -s localhost:8000/health | $(JSON)

chaos:         ## provider-c derrubando 30% e pendurando 30% das chamadas
	docker compose run -d --rm --service-ports \
		-e FAIL_RATE=0.3 -e TIMEOUT_RATE=0.3 provider-c
