# battery_anomaly_detection.py

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import mean, pstdev
from typing import Any, Dict, List, Optional
import json
import re

from hf_client import call_hf_model


# ----------------------------
# Helpers
# ----------------------------
def _to_bool(v: Any) -> Optional[bool]:
    """
    Normalize common boolean-like values stored in telemetry:
      True/False, "true"/"false", "yes"/"no", 1/0, "on"/"off", "charging"/"discharging"
    Returns:
      True/False if confidently parsed, otherwise None
    """
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "yes", "y", "1", "on", "charging", "charge"):
            return True
        if s in ("false", "no", "n", "0", "off", "discharging", "discharge"):
            return False
    return None


def _utc_now() -> datetime:
    return datetime.utcnow()


# ----------------------------
# Battery stats + anomalies
# ----------------------------
def compute_battery_stats(
    heartbeat_collection,
    serial: str,
    window_hours: int = 24,
) -> Dict[str, Any]:
    """
    Computes:
      - points: per-sample battery + rate
      - avg_discharge_pct_per_hour: stable discharge baseline (discharge only)
      - anomalies: outliers vs baseline
      - time_to_empty_minutes: predicted runtime (using stable discharge)
      - time_to_full_minutes: predicted charging time (using stable charge)
    """
    since = _utc_now() - timedelta(hours=window_hours)

    cursor = (
        heartbeat_collection.find({"serial": serial, "timestamp": {"$gte": since}})
        .sort("timestamp", 1)
    )

    rows: List[Dict[str, Any]] = list(cursor)
    if len(rows) < 2:
        return {
            "serial": serial,
            "window_hours": window_hours,
            "points": [],
            "avg_discharge_pct_per_hour": None,
            "anomalies": [],
            "time_to_empty_minutes": None,
            "time_to_full_minutes": None,
        }

    points: List[Dict[str, Any]] = []

    discharge_rates: List[float] = []
    charge_rates: List[float] = []

    MAX_ABS_RATE_PER_HOUR = 40.0
    MAX_GAP_HOURS = 1.0
    MIN_VALID_BATTERY = 0.0
    MAX_VALID_BATTERY = 100.0

    prev = rows[0]
    for curr in rows[1:]:
        ts_prev = prev.get("timestamp")
        ts_curr = curr.get("timestamp")

        if isinstance(ts_prev, datetime) and ts_prev.tzinfo is not None:
            ts_prev = ts_prev.astimezone(timezone.utc).replace(tzinfo=None)
        if isinstance(ts_curr, datetime) and ts_curr.tzinfo is not None:
            ts_curr = ts_curr.astimezone(timezone.utc).replace(tzinfo=None)

        if not ts_prev or not ts_curr:
            prev = curr
            continue

        dt_hours = (ts_curr - ts_prev).total_seconds() / 3600.0
        if dt_hours <= 0:
            prev = curr
            continue

        b_prev = prev.get("battery")
        b_curr = curr.get("battery")
        if b_prev is None or b_curr is None:
            prev = curr
            continue

        try:
            b_prev_f = float(b_prev)
            b_curr_f = float(b_curr)
        except Exception:
            prev = curr
            continue

        if not (MIN_VALID_BATTERY <= b_prev_f <= MAX_VALID_BATTERY) or not (
            MIN_VALID_BATTERY <= b_curr_f <= MAX_VALID_BATTERY
        ):
            prev = curr
            continue

        delta = b_curr_f - b_prev_f
        rate_per_hour = delta / dt_hours

        charging = _to_bool(curr.get("charging"))
        if charging is None:
            charging = True if rate_per_hour > 0 else (False if rate_per_hour < 0 else None)

        point = {
            "t": ts_curr.isoformat(),
            "battery": b_curr_f,
            "charging": charging,
            "health": curr.get("health"),
            "rate_per_hour": rate_per_hour,
            "dt_hours": dt_hours,
        }
        points.append(point)

        if abs(rate_per_hour) <= MAX_ABS_RATE_PER_HOUR and dt_hours <= MAX_GAP_HOURS:
            if rate_per_hour < 0:
                discharge_rates.append(rate_per_hour)
            elif rate_per_hour > 0:
                charge_rates.append(rate_per_hour)

        prev = curr

    avg_discharge_rate = mean(discharge_rates) if discharge_rates else None 
    avg_charge_rate = mean(charge_rates) if charge_rates else None      

    std_discharge = pstdev(discharge_rates) if len(discharge_rates) > 1 else 0.0

    anomalies: List[Dict[str, Any]] = []
    threshold_factor = 1.5

    if avg_discharge_rate is not None and std_discharge and std_discharge > 0:
        boundary = avg_discharge_rate - threshold_factor * std_discharge

        for p in points:
            r = p.get("rate_per_hour")
            dt = p.get("dt_hours")
            ch = p.get("charging")

            if r is None or dt is None:
                continue
            if abs(r) > MAX_ABS_RATE_PER_HOUR or dt > MAX_GAP_HOURS:
                continue
            if ch is None:
                ch = True if r > 0 else (False if r < 0 else None)

            if ch is False and r < boundary:
                anomalies.append(
                    {
                        "timestamp": p.get("t"),
                        "battery": p.get("battery"),
                        "rate_per_hour": r,
                        "reason": "High discharge rate vs baseline",
                    }
                )

    latest = points[-1] if points else {}
    latest_battery = latest.get("battery")
    latest_rate = latest.get("rate_per_hour")
    latest_charging = latest.get("charging")

    time_to_empty = None
    time_to_full = None

    effective_discharge = None
    effective_charge = None

    if (
        latest_rate is not None
        and isinstance(latest_rate, (int, float))
        and abs(latest_rate) <= MAX_ABS_RATE_PER_HOUR
    ):
        if latest_charging is None:
            latest_charging = True if latest_rate > 0 else (False if latest_rate < 0 else None)

        if latest_charging is False and latest_rate < 0:
            effective_discharge = float(latest_rate)
        elif latest_charging is True and latest_rate > 0:
            effective_charge = float(latest_rate)

    if effective_discharge is None and avg_discharge_rate is not None:
        effective_discharge = avg_discharge_rate
    if effective_charge is None and avg_charge_rate is not None:
        effective_charge = avg_charge_rate

    if latest_battery is not None and isinstance(latest_battery, (int, float)):
        lb = float(latest_battery)

        if effective_discharge is not None and effective_discharge < 0:
            hours_to_empty = lb / abs(effective_discharge)
            if 0 <= hours_to_empty < 1e6:
                time_to_empty = int(hours_to_empty * 60)

        if effective_charge is not None and effective_charge > 0:
            hours_to_full = (100.0 - lb) / effective_charge
            if 0 <= hours_to_full < 1e6:
                time_to_full = int(hours_to_full * 60)

    avg_discharge_pct_per_hour = abs(avg_discharge_rate) if avg_discharge_rate is not None else None

    return {
        "serial": serial,
        "window_hours": window_hours,
        "points": points,
        "avg_discharge_pct_per_hour": avg_discharge_pct_per_hour,
        "anomalies": anomalies,
        "time_to_empty_minutes": time_to_empty,
        "time_to_full_minutes": time_to_full,
    }

def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """
    Robust JSON extractor:
    1) direct json.loads
    2) extract from ```json ... ``` fences
    3) brace-balanced scan for first valid JSON object
    """
    if not text:
        return None

    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    fence = re.search(
        r"```(?:json)?\s*(\{.*?\})\s*```",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if fence:
        candidate = fence.group(1).strip()
        try:
            obj = json.loads(candidate)
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass

    starts = [m.start() for m in re.finditer(r"\{", text)]
    for start in starts:
        depth = 0
        in_string = False
        escape = False

        for i in range(start, len(text)):
            ch = text[i]

            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            else:
                if ch == '"':
                    in_string = True
                    continue

                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = text[start : i + 1].strip()
                        try:
                            obj = json.loads(candidate)
                            if isinstance(obj, dict):
                                return obj
                        except Exception:
                            break

    return None


def _is_action_too_short(s: Any) -> bool:
    if not isinstance(s, str):
        return True
    words = [w for w in s.strip().split() if w]
    return len(words) < 18


# ----------------------------
# AI interpretation
# ----------------------------
def analyze_battery_with_ai(stats: Dict[str, Any]) -> Dict[str, Any]:
    """
    HF-only AI interpretation for battery stats.
    Produces thermal-style messaging:
      - headline (short)
      - summary (1 sentence)
    plus: risk_level, anomalies, recommended_actions
    """

    points = stats.get("points", [])
    sample_points = points[-60:]

    payload_summary = {
        "serial": stats.get("serial"),
        "window_hours": stats.get("window_hours"),
        "avg_discharge_pct_per_hour": stats.get("avg_discharge_pct_per_hour"),
        "time_to_empty_minutes": stats.get("time_to_empty_minutes"),
        "time_to_full_minutes": stats.get("time_to_full_minutes"),
        "anomalies_detected_by_rule": stats.get("anomalies", []),
        "recent_points": sample_points,
    }

    base_prompt = (
        "You are a battery diagnostics assistant for standalone VR headsets.\n"
        "Write outputs in a calm, user-facing style similar to: 'Thermal behaviour looks normal'.\n\n"
        "Return ONLY valid JSON with this schema:\n"
        "{\n"
        '  "headline": string,\n'
        '  "summary": string,\n'
        '  "overall_assessment": string,\n'
        '  "risk_level": "low" | "medium" | "high",\n'
        '  "anomalies": [\n'
        '    {"timestamp": string | null,\n'
        '     "severity": "low" | "medium" | "high",\n'
        '     "short_description": string,\n'
        '     "details": string}\n'
        "  ],\n"
        '  "recommended_actions": [string]\n'
        "}\n\n"
        "Rules:\n"
        "1) headline: max 6 words, e.g. 'Battery behaviour looks normal'.\n"
        "2) summary: exactly 1 sentence, simple and user-friendly.\n"
        "3) If no anomalies exist, explain it naturally (do NOT say 'No AI response received').\n"
        "4) ALWAYS provide 5 to 8 recommended_actions.\n"
        "5) Each action must be minimum 18 words, and include what to do + why it helps.\n"
        "6) Use telemetry values when possible (avg discharge rate, time to empty/full).\n"
        "7) Do NOT mention unrelated domains (gallons per minute, pumps, industrial fluids).\n\n"
        f"Data:\n{json.dumps(payload_summary, default=str)}"
    )

    generated_text = ""
    try:
        result = call_hf_model(base_prompt)
        generated_text = (result.get("generated_text") or "").strip()
        print("HF AI response (first 200 chars):", generated_text[:200])
    except Exception as e:
        return {
            "headline": "Battery insights unavailable",
            "summary": "AI analysis could not be generated right now, showing rule-based results instead.",
            "overall_assessment": f"AI call failed: {e}",
            "risk_level": "low",
            "anomalies": [],
            "recommended_actions": [],
            "raw_text": "",
        }

    parsed = _extract_json_object(generated_text)

    if not parsed:
        repair_prompt = (
            "Convert the following content into ONLY valid JSON matching the schema.\n"
            "Do not include markdown, explanations, or extra text.\n\n"
            "Schema:\n"
            "{\n"
            '  "headline": string,\n'
            '  "summary": string,\n'
            '  "overall_assessment": string,\n'
            '  "risk_level": "low" | "medium" | "high",\n'
            '  "anomalies": [{"timestamp": string | null, "severity": "low" | "medium" | "high", "short_description": string, "details": string}],\n'
            '  "recommended_actions": [string]\n'
            "}\n\n"
            "Important: keep it VR headset battery related only.\n\n"
            f"Content:\n{generated_text}"
        )
        try:
            repaired_text = (call_hf_model(repair_prompt).get("generated_text") or "").strip()
            print("HF AI repair (first 200 chars):", repaired_text[:200])
            repaired_parsed = _extract_json_object(repaired_text)
            if repaired_parsed:
                parsed = repaired_parsed
                generated_text = repaired_text
        except Exception:
            parsed = None

    if parsed:
        parsed.setdefault("headline", "")
        parsed.setdefault("summary", "")
        parsed.setdefault("overall_assessment", "")
        parsed.setdefault("risk_level", "low")
        parsed.setdefault("anomalies", [])
        parsed.setdefault("recommended_actions", [])

        recs = parsed.get("recommended_actions")
        if not isinstance(recs, list):
            parsed["recommended_actions"] = []
            recs = parsed["recommended_actions"]

        if len(recs) < 5:
            extend_prompt = (
                "You will receive a JSON object. Return ONLY valid JSON.\n"
                "Keep all fields the same, but update recommended_actions to have 5 to 8 items.\n"
                "Each action must be minimum 18 words and include what to do and why it helps.\n"
                "Actions must be VR headset battery related only.\n"
                "Do not add extra keys.\n\n"
                f"JSON:\n{json.dumps(parsed, ensure_ascii=False)}"
            )
            try:
                extended_text = (call_hf_model(extend_prompt).get("generated_text") or "").strip()
                print("HF AI extend (first 200 chars):", extended_text[:200])
                extended_parsed = _extract_json_object(extended_text)
                if extended_parsed:
                    parsed = extended_parsed
                    generated_text = extended_text
                    parsed.setdefault("recommended_actions", [])
            except Exception:
                pass

        recs = parsed.get("recommended_actions") if isinstance(parsed.get("recommended_actions"), list) else []
        short_count = sum(1 for r in recs if _is_action_too_short(r))
        if len(recs) == 0 or short_count >= 2:
            rewrite_prompt = (
                "You will receive a JSON object. Return ONLY valid JSON.\n"
                "Keep the same schema and keys.\n"
                "Rewrite recommended_actions to be 5 to 8 items.\n"
                "Each action must be minimum 18 words and include what to do and why it helps.\n"
                "Use telemetry values when possible.\n"
                "Actions must be VR headset battery related only.\n"
                "Do not add extra keys.\n\n"
                f"JSON:\n{json.dumps(parsed, ensure_ascii=False)}"
            )
            try:
                rewritten_text = (call_hf_model(rewrite_prompt).get("generated_text") or "").strip()
                print("HF AI rewrite (first 200 chars):", rewritten_text[:200])
                rewritten_parsed = _extract_json_object(rewritten_text)
                if rewritten_parsed:
                    parsed = rewritten_parsed
                    generated_text = rewritten_text
            except Exception:
                pass

        parsed["raw_text"] = generated_text
        return parsed

    return {
        "headline": "Battery insights unavailable",
        "summary": "AI analysis could not be parsed, showing rule-based results instead.",
        "overall_assessment": "AI analysis returned non-JSON output.",
        "risk_level": "low",
        "anomalies": [],
        "recommended_actions": [],
        "raw_text": generated_text,
    }