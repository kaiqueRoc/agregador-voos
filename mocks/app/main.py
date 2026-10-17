"""Mock dos três provedores de passagens aéreas.

Uma única aplicação serve os três contratos; o provider ativo é escolhido pela
env `PROVIDER` (a|b|c). Cada um expõe `/provider-{x}/search`, aceita GET e POST
e devolve o formato "legado" que o desafio descreve — nomes de campo, unidades
e granularidade de data diferentes entre si de propósito.

Chaos engineering via env (todos desligados por padrão):
    LATENCY_MIN_MS / LATENCY_MAX_MS  latência artificial
    FAIL_RATE                        probabilidade de responder 500
    TIMEOUT_RATE                     probabilidade de "pendurar" a resposta
    DIRTY                            emite registros sujos (preço 0, moeda
                                     estrangeira) para exercitar validação
"""

from __future__ import annotations

import asyncio
import os
import random
from datetime import date as Date
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .catalog import airline_for, entries_for, price_for, to_datetimes

PROVIDER = os.getenv("PROVIDER", "a").lower()
if PROVIDER not in {"a", "b", "c"}:
    raise RuntimeError(f"PROVIDER inválido: {PROVIDER!r} (use a, b ou c)")

LATENCY_MIN_MS = int(os.getenv("LATENCY_MIN_MS", "80"))
LATENCY_MAX_MS = int(os.getenv("LATENCY_MAX_MS", "450"))
FAIL_RATE = float(os.getenv("FAIL_RATE", "0"))
TIMEOUT_RATE = float(os.getenv("TIMEOUT_RATE", "0"))
DIRTY = os.getenv("DIRTY", "1") == "1"

app = FastAPI(title=f"Mock Provider {PROVIDER.upper()}", version="1.0.0")


def _parse_params(payload: dict[str, Any]) -> tuple[str, str, Date]:
    origin = str(payload.get("origin") or payload.get("origem") or "GRU").upper()
    destination = str(payload.get("destination") or payload.get("destino") or "GIG").upper()
    raw_date = str(payload.get("date") or payload.get("data") or "")
    try:
        day = Date.fromisoformat(raw_date) if raw_date else Date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="date inválida (use YYYY-MM-DD)") from None
    return origin, destination, day


async def _simulate_conditions() -> None:
    if TIMEOUT_RATE and random.random() < TIMEOUT_RATE:
        await asyncio.sleep(30)  # muito além do timeout do agregador
    if FAIL_RATE and random.random() < FAIL_RATE:
        raise HTTPException(status_code=500, detail="provider indisponível")
    if LATENCY_MAX_MS > 0:
        await asyncio.sleep(random.randint(LATENCY_MIN_MS, LATENCY_MAX_MS) / 1000)


def _render_a(origin: str, destination: str, day: Date) -> dict[str, Any]:
    flights = []
    for entry in entries_for("a"):
        depart, arrive = to_datetimes(entry, day)
        flights.append(
            {
                "company": airline_for(entry, "a"),
                "price": price_for(entry, "a", origin, destination, day.isoformat()),
                "depart_at": depart.isoformat(),
                "arrive_at": arrive.isoformat(),
            }
        )
    return {"flights": flights}


def _render_b(origin: str, destination: str, day: Date) -> dict[str, Any]:
    results = []
    for entry in entries_for("b"):
        price = price_for(entry, "b", origin, destination, day.isoformat())
        results.append(
            {
                "airline_name": airline_for(entry, "b"),
                "amount": int(round(price * 100)),  # centavos
                "currency": "BRL",
                "departure": entry.depart,
                "arrival": entry.arrive,
            }
        )
    if DIRTY:
        # Tarifa em moeda estrangeira: o agregador não faz câmbio, deve descartar.
        results.append(
            {
                "airline_name": "Copa Airlines",
                "amount": 21000,
                "currency": "USD",
                "departure": "14:40",
                "arrival": "18:05",
            }
        )
    return {"results": results}


def _render_c(origin: str, destination: str, day: Date) -> dict[str, Any]:
    data = []
    for entry in entries_for("c"):
        data.append(
            {
                "carrier": airline_for(entry, "c"),
                "fare": price_for(entry, "c", origin, destination, day.isoformat()),
                "departure_time": entry.depart,
                "arrival_time": entry.arrive,
            }
        )
    if DIRTY:
        # Assento esgotado devolvido com tarifa zerada — precisa ser descartado.
        data.append(
            {"carrier": "Gol", "fare": 0.0, "departure_time": "15:00", "arrival_time": "18:20"}
        )
    return {"data": data}


RENDERERS = {"a": _render_a, "b": _render_b, "c": _render_c}


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "provider": PROVIDER, "at": datetime.now().isoformat()}


@app.api_route(f"/provider-{PROVIDER}/search", methods=["GET", "POST"])
async def search(request: Request) -> JSONResponse:
    if request.method == "POST":
        try:
            payload = await request.json()
        except Exception:
            payload = {}
    else:
        payload = dict(request.query_params)
    if not isinstance(payload, dict):
        payload = {}

    origin, destination, day = _parse_params(payload)
    await _simulate_conditions()
    return JSONResponse(RENDERERS[PROVIDER](origin, destination, day))
