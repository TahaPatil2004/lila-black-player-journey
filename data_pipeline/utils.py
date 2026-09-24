"""
utils.py
Shared utilities for the LILA BLACK preprocessing pipeline.
"""

import re
import uuid
from typing import Any


# ── Entity classification ────────────────────────────────────────────────────

# Compiled once; numeric-only user_ids are bots.
_NUMERIC_RE = re.compile(r"^\d+$")


def classify_entity(user_id: str) -> str:
    """
    Return 'human' if user_id is a UUID, 'bot' if it is purely numeric.

    Definition from dataset README:
        UUID → human player
        numeric string (e.g. '1440', '382') → bot

    Args:
        user_id: Raw user_id string from telemetry.

    Returns:
        'human' or 'bot'
    """
    if _NUMERIC_RE.match(str(user_id)):
        return "bot"
    return "human"


# ── Event classification ─────────────────────────────────────────────────────

# Events that represent continuous position sampling.
POSITION_EVENTS = frozenset({"Position", "BotPosition"})

# Events that represent discrete, meaningful in-game actions.
DISCRETE_EVENTS = frozenset({
    "Kill",
    "Killed",
    "BotKill",
    "BotKilled",
    "KilledByStorm",
    "Loot",
})

ALL_EXPECTED_EVENTS = POSITION_EVENTS | DISCRETE_EVENTS


def is_position_event(event: str) -> bool:
    return event in POSITION_EVENTS


def is_discrete_event(event: str) -> bool:
    return event in DISCRETE_EVENTS


# ── Timestamp utilities ──────────────────────────────────────────────────────

def parse_ts_to_seconds(ts_value: Any) -> int:
    """
    Convert the raw Parquet timestamp to an integer number of seconds.

    Investigation finding (DATA_RECON.md):
        The Parquet column is annotated as timestamp[ms], but the underlying
        integer values represent SECONDS since the Unix epoch (not milliseconds).
        E.g. 1770681535 → 2026-02-10T23:58:55Z.

        When pandas reads the column it treats the integer as milliseconds,
        so pandas datetime values appear in Jan 1970. We recover the true
        seconds by dividing the pandas int64 nanoseconds representation by 1e9,
        or equivalently by reading the raw int64 value (already in ms) and
        dividing by 1000 to discard the ms annotation artifact.

    Args:
        ts_value: A pandas Timestamp (datetime64[ms]) object.

    Returns:
        Integer seconds since Unix epoch.
    """
    # pandas stores datetime64[ms] as int64 NANOSECONDS since epoch.
    # The raw Parquet integer is in seconds, but annotated as ms.
    # pandas therefore interprets it as 1770 ms → stores 1770 * 1e6 ns.
    # To recover the original seconds integer: divide ns by 1e6 (not 1e9).
    #   ts_value.value (ns) / 1_000_000 = 1770 (ms label = true seconds value)
    return int(ts_value.value // 1_000_000)


# ── Safe decoding ────────────────────────────────────────────────────────────

def decode_event(raw: Any) -> str:
    """
    Decode the binary `event` column to a UTF-8 string.

    The Parquet binary field stores event names as raw bytes. This function
    handles both bytes and already-decoded strings gracefully.
    """
    if isinstance(raw, bytes):
        return raw.decode("utf-8")
    return str(raw)
