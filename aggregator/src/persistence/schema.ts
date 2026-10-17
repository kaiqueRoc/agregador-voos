/**
 * Schema de analytics (Postgres padrão, idempotente). Em `search_flights` a
 * oferta escolhida e a mais barata ficam lado a lado: é o que mede a regra.
 */

export const MIGRATION_LOCK_ID = 727_001;

export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS searches (
  id             uuid        PRIMARY KEY,
  request_id     text,
  origin         char(3)     NOT NULL,
  destination    char(3)     NOT NULL,
  travel_date    date        NOT NULL,
  strategy       text        NOT NULL,
  partial        boolean     NOT NULL,
  unavailable    boolean     NOT NULL,
  flights_count  integer     NOT NULL,
  duration_ms    integer     NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS searches_created_at_idx ON searches (created_at);
CREATE INDEX IF NOT EXISTS searches_route_idx ON searches (origin, destination, travel_date);

CREATE TABLE IF NOT EXISTS search_providers (
  search_id   uuid    NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  provider    text    NOT NULL,
  status      text    NOT NULL,
  offers      integer NOT NULL,
  discarded   integer NOT NULL,
  cached      boolean NOT NULL,
  latency_ms  integer NOT NULL,
  PRIMARY KEY (search_id, provider)
);

CREATE TABLE IF NOT EXISTS search_flights (
  search_id                  uuid      NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  flight_id                  text      NOT NULL,
  airline                    text      NOT NULL,
  departure_at               timestamp NOT NULL,
  arrival_at                 timestamp NOT NULL,
  offers_compared            smallint  NOT NULL,
  selected_provider          text      NOT NULL,
  selected_price_cents       integer   NOT NULL,
  selected_commission_cents  integer   NOT NULL,
  cheapest_provider          text      NOT NULL,
  cheapest_price_cents       integer   NOT NULL,
  cheapest_commission_cents  integer   NOT NULL,
  PRIMARY KEY (search_id, flight_id)
);
CREATE INDEX IF NOT EXISTS search_flights_selected_provider_idx
  ON search_flights (selected_provider);

-- Uma linha por voo exibido, com o efeito da estratégia já calculado.
CREATE OR REPLACE VIEW flight_selection_economics AS
SELECT
  s.id AS search_id,
  s.created_at,
  s.origin,
  s.destination,
  s.travel_date,
  s.strategy,
  f.flight_id,
  f.airline,
  f.offers_compared,
  f.selected_provider,
  f.cheapest_provider,
  f.selected_provider <> f.cheapest_provider             AS switched,
  f.selected_price_cents,
  f.cheapest_price_cents,
  f.selected_price_cents - f.cheapest_price_cents        AS customer_premium_cents,
  f.selected_commission_cents,
  f.selected_commission_cents - f.cheapest_commission_cents AS commission_uplift_cents
FROM search_flights f
JOIN searches s ON s.id = f.search_id;
`;
