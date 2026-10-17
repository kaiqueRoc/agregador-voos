"""Catálogo determinístico de voos usado pelos três providers mockados.

A ideia é que os três "sistemas de terceiros" vendam parcialmente os MESMOS
voos, com preços e grafias diferentes. Isso garante que o agregador tenha
duplicidades reais para deduplicar, e não apenas payloads distintos.

São 60 voos únicos distribuídos de forma que cada provider ofereça exatamente
40 — malha suficiente para a ordenação e a deduplicação terem trabalho de
verdade (120 ofertas por busca, ~50% delas duplicadas).

Nada aqui é aleatório em função do relógio: a variação de preço é derivada de
um hash de (origem, destino, data), então a mesma busca sempre devolve os
mesmos números — o que torna cache e testes reprodutíveis.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from datetime import date as Date
from datetime import datetime, timedelta


@dataclass(frozen=True)
class CatalogEntry:
    airline: str  # chave canônica; a grafia por provider sai de SPELLINGS
    depart: str  # HH:MM
    arrive: str  # HH:MM (pode ser no dia seguinte)
    base_price: float
    sold_by: tuple[str, ...]  # "a" | "b" | "c"


# Cada provider escreve o nome da companhia do seu jeito — é o que obriga o
# agregador a normalizar antes de deduplicar.
SPELLINGS = {
    "LATAM": {"a": "LATAM", "b": "Latam", "c": "Latam Airlines"},
    "GOL": {"a": "GOL", "b": "Gol", "c": "Gol Linhas Aéreas"},
    "AZUL": {"a": "AZUL", "b": "Azul", "c": "Azul Linhas Aereas"},
    "VOEPASS": {"a": "VOEPASS", "b": "Passaredo", "c": "Voepass"},
}

BASE_PRICE = {"LATAM": 780.0, "GOL": 720.0, "AZUL": 700.0, "VOEPASS": 480.0}

# Ciclo de 12 posições: 12 voos geram 24 ofertas, 8 para cada provider. Em 60
# voos (5 ciclos) dá exatamente 40 por provider. Mistura voo vendido pelos três,
# por dois e exclusivo de um só.
SOLD_BY_CYCLE = (
    ("a", "b"),
    ("b", "c"),
    ("a", "c"),
    ("a", "b", "c"),
    ("a",),
    ("b", "c"),
    ("a", "b"),
    ("c",),
    ("a", "c"),
    ("a", "b", "c"),
    ("b",),
    ("a", "b", "c"),
)

# Comprimento 7, coprimo com o ciclo de 12 acima: evita que uma companhia caia
# sempre no mesmo padrão de distribuição.
AIRLINE_CYCLE = ("LATAM", "GOL", "AZUL", "LATAM", "AZUL", "GOL", "VOEPASS")

# Os três primeiros são os exemplos literais do enunciado; o quarto é o voo que
# vira a meia-noite. Ficam nas posições 0-3 do ciclo, então o LATAM 08:00 cai em
# A, o Azul 08:15 em B e o Gol 08:50 em C, como no DESAFIO.md.
SEEDS = (
    ("LATAM", "08:00", 190, 820.40),
    ("AZUL", "08:15", 195, 790.90),
    ("GOL", "08:50", 195, 845.20),
    ("VOEPASS", "22:30", 165, 480.00),
)

GENERATED = 56  # 4 seeds + 56 = 60 voos
FIRST_DEPARTURE = 5 * 60  # 05:00
SLOT_MINUTES = 19  # malha de 05:00 a 22:25


def _hhmm(minutes: int) -> str:
    return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"


def _base_price(airline: str, minutes: int, duration: int, index: int) -> float:
    """Preço-base plausível: horário de pico custa mais, madrugada custa menos."""
    hour = (minutes // 60) % 24
    if hour < 7 or hour >= 21:
        window = 0.82
    elif 7 <= hour < 10 or 17 <= hour < 20:
        window = 1.18
    else:
        window = 1.0
    stretch = 1 + (duration - 90) / 600  # voo mais longo, tarifa mais alta
    wobble = 1 + (((index * 37) % 15) - 7) / 100  # ±7% determinístico
    return round(BASE_PRICE[airline] * window * stretch * wobble, 2)


def _build_catalog() -> tuple[CatalogEntry, ...]:
    entries: list[CatalogEntry] = [
        CatalogEntry(
            airline=airline,
            depart=depart,
            arrive=_hhmm(int(depart[:2]) * 60 + int(depart[3:]) + duration),
            base_price=price,
            sold_by=(),  # definido abaixo pelo ciclo
        )
        for airline, depart, duration, price in SEEDS
    ]

    for index in range(GENERATED):
        minutes = FIRST_DEPARTURE + SLOT_MINUTES * index
        airline = AIRLINE_CYCLE[index % len(AIRLINE_CYCLE)]
        duration = 60 + (index * 23) % 150  # 60 a 209 minutos
        entries.append(
            CatalogEntry(
                airline=airline,
                depart=_hhmm(minutes),
                arrive=_hhmm(minutes + duration),
                base_price=_base_price(airline, minutes, duration, index),
                sold_by=(),
            )
        )

    return tuple(
        replace(entry, sold_by=SOLD_BY_CYCLE[i % len(SOLD_BY_CYCLE)])
        for i, entry in enumerate(entries)
    )


CATALOG: tuple[CatalogEntry, ...] = _build_catalog()

# Cada provider tem sua própria margem — é o que faz a deduplicação precisar
# escolher a oferta mais barata em vez de simplesmente descartar repetidos.
PROVIDER_MARKUP = {"a": 1.0, "b": 0.985, "c": 1.012}


def _jitter(origin: str, destination: str, day: str) -> float:
    """Variação de preço em [-4%, +4%] derivada da rota+data (determinística)."""
    seed = f"{origin.upper()}|{destination.upper()}|{day}"
    digest = hashlib.sha256(seed.encode()).digest()
    return 1.0 + ((digest[0] / 255.0) * 0.08 - 0.04)


def price_for(entry: CatalogEntry, provider: str, origin: str, destination: str, day: str) -> float:
    raw = entry.base_price * PROVIDER_MARKUP[provider] * _jitter(origin, destination, day)
    return round(raw, 2)


def airline_for(entry: CatalogEntry, provider: str) -> str:
    """Grafia da companhia como aquele provider específico escreve."""
    return SPELLINGS[entry.airline][provider]


def entries_for(provider: str) -> list[CatalogEntry]:
    return [e for e in CATALOG if provider in e.sold_by]


def to_datetimes(entry: CatalogEntry, day: Date) -> tuple[datetime, datetime]:
    """Resolve HH:MM para datetimes, somando 1 dia quando o voo vira a noite."""
    dep_h, dep_m = (int(x) for x in entry.depart.split(":"))
    arr_h, arr_m = (int(x) for x in entry.arrive.split(":"))
    depart = datetime(day.year, day.month, day.day, dep_h, dep_m)
    arrive = datetime(day.year, day.month, day.day, arr_h, arr_m)
    if arrive <= depart:
        arrive += timedelta(days=1)
    return depart, arrive
