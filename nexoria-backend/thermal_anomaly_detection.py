# thermal_anomaly_detection.py

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
import json
import re

from hf_client import call_hf_model


def _safe_iso(dt: Any) -> str:
    try:
        return dt.isoformat()
    except Exception:
        return str(dt)


def _linear_regression_slope(xs: List[float], ys: List[float]) -> Optional[float]:
    """
    Least-squares slope for (x, y). Returns slope in deg/hour.
    """
    n = len(xs)
    if n < 2:
        return None

    x_mean = sum(xs) / n
    y_mean = sum(ys) / n

    num = 0.0
    den = 0.0
    for x, y in zip(xs, ys):
        dx = x - x_mean
        num += dx * (y - y_mean)
        den += dx * dx

    if den == 0.0:
        return 0.0
    return num / den


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """
    Try to parse a JSON object from a model response.
    Accepts either pure JSON, or JSON embedded in text.
    """
    if not text:
        return None

    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not m:
        return None

    try:
        obj = json.loads(m.group(0))
        if isinstance(obj, dict):
            return obj
    except Exception:
        return None

    return None


def analyze_thermal_with_ai(stats: Dict[str, Any]) -> Dict[str, Any]:
    """
    AI-assisted thermal anomaly explanation and recommendations.
    Input: stats returned by compute_temperature_stats()
    Output schema:
      - overall_assessment
      - risk_level (low|medium|high)
      - anomalies [{type, severity, evidence}]
      - recommended_actions [..]
    """
    points = stats.get("points") or []
    anomalies = stats.get("anomalies") or []

    recent_points = points[-50:] if len(points) > 50 else points

    summary = {
        "serial": stats.get("serial"),
        "window_hours": stats.get("window_hours"),
        "avg_temperature_c": stats.get("avg_temperature_c"),
        "max_temperature_c": stats.get("max_temperature_c"),
        "trend_deg_per_hour": stats.get("trend_deg_per_hour"),
        "comfort_level": stats.get("comfort_level"),
        "rule_anomalies": anomalies,
        "recent_points": recent_points,
        "rule_recommendations": stats.get("recommendations", []),
    }

    prompt = (
        "You are a thermal diagnostics assistant for standalone VR headsets.\n"
        "Analyze temperature telemetry and produce an actionable, technician-friendly report.\n\n"
        "Return ONLY valid JSON with this schema:\n"
        "{\n"
        '  "overall_assessment": "string",\n'
        '  "risk_level": "low|medium|high",\n'
        '  "anomalies": [{"type":"string","severity":"low|medium|high","evidence":"string"}],\n'
        '  "recommended_actions": ["string","string","string"]\n'
        "}\n\n"
        "Rules:\n"
        "- If no issues, set anomalies to [] and say explicitly that no anomalies detected.\n"
        "- recommended_actions MUST contain at least 5 items.\n"
        "- Use the provided rule_anomalies and comfort_level as primary evidence.\n\n"
        f"DATA:\n{json.dumps(summary, default=str)}"
    )

    result = call_hf_model(prompt)
    generated_text = result.get("generated_text", "")

    print("HF AI response (first 200 chars):", str(generated_text)[:200])

    parsed = _extract_json_object(generated_text)
    if parsed is None:
        return {
            "overall_assessment": "AI analysis returned non-JSON output.",
            "risk_level": "low",
            "anomalies": [],
            "recommended_actions": [],
            "raw_text": generated_text,
        }

    parsed.setdefault("overall_assessment", "")
    parsed.setdefault("risk_level", "low")
    parsed.setdefault("anomalies", [])
    parsed.setdefault("recommended_actions", [])

    if not isinstance(parsed.get("recommended_actions"), list):
        parsed["recommended_actions"] = []

    while len(parsed["recommended_actions"]) < 3:
        parsed["recommended_actions"].append("Continue monitoring temperature telemetry and review again after more data is collected.")

    return parsed


def compute_temperature_stats(
    heartbeat_collection,
    serial: str,
    window_hours: int = 24 * 7, 
    *,
    high_temp_threshold: float = 40.0,
    very_high_temp_threshold: float = 45.0,
    spike_delta: float = 8.0,             
    spike_window_hours: float = 0.5,       
    rising_trend_threshold: float = 1.0,  
) -> Dict[str, Any]:
    """
    Analyze long-term temperature behavior for a device.

    Output fields:
      - points: [{t, temperature_c}]
      - avg_temperature_c, max_temperature_c
      - trend_deg_per_hour (linear regression slope)
      - anomalies: list of events
      - comfort_level
      - recommendations: list of actionable recommendations
      - summary_recommendation: first recommendation (quick text)
    """

    since = datetime.utcnow() - timedelta(hours=window_hours)

    cursor = (
        heartbeat_collection.find({"serial": serial, "timestamp": {"$gte": since}})
        .sort("timestamp", 1)
    )
    rows: List[Dict[str, Any]] = list(cursor)

    if not rows:
        return {
            "serial": serial,
            "window_hours": window_hours,
            "points": [],
            "avg_temperature_c": None,
            "max_temperature_c": None,
            "trend_deg_per_hour": None,
            "anomalies": [],
            "comfort_level": "UNKNOWN",
            "recommendations": ["No data available yet, collect more heartbeats and check again."],
            "summary_recommendation": "No data available yet, collect more heartbeats and check again.",
        }

    t0 = rows[0].get("timestamp")
    if t0 is None:
        return {
            "serial": serial,
            "window_hours": window_hours,
            "points": [],
            "avg_temperature_c": None,
            "max_temperature_c": None,
            "trend_deg_per_hour": None,
            "anomalies": [{"reason": "Missing timestamps in heartbeat data", "severity": "high"}],
            "comfort_level": "UNKNOWN",
            "recommendations": ["Heartbeat timestamps are missing, verify backend ingestion and database fields."],
            "summary_recommendation": "Heartbeat timestamps are missing, verify backend ingestion and database fields.",
        }

    points: List[Dict[str, Any]] = []
    temps: List[float] = []
    times_hours: List[float] = []

    for row in rows:
        ts = row.get("timestamp")
        temp = row.get("temperature_c")
        if ts is None or temp is None:
            continue
        try:
            temp_f = float(temp)
        except Exception:
            continue

        dt_hours = (ts - t0).total_seconds() / 3600.0
        times_hours.append(dt_hours)
        temps.append(temp_f)
        points.append({"t": _safe_iso(ts), "temperature_c": temp_f})

    if not temps:
        return {
            "serial": serial,
            "window_hours": window_hours,
            "points": [],
            "avg_temperature_c": None,
            "max_temperature_c": None,
            "trend_deg_per_hour": None,
            "anomalies": [],
            "comfort_level": "UNKNOWN",
            "recommendations": ["Temperature values are missing, check the agent telemetry key: temperature_c."],
            "summary_recommendation": "Temperature values are missing, check the agent telemetry key: temperature_c.",
        }

    avg_temp = sum(temps) / len(temps)
    max_temp = max(temps)

    trend_deg_per_hour = _linear_regression_slope(times_hours, temps)

    if trend_deg_per_hour is not None and abs(trend_deg_per_hour) < 0.005:
        trend_deg_per_hour = 0.0

    anomalies: List[Dict[str, Any]] = []

    # Rule 1: absolute thresholds
    for p in points:
        temp = p["temperature_c"]
        if temp >= very_high_temp_threshold:
            anomalies.append(
                {
                    "timestamp": p["t"],
                    "temperature_c": temp,
                    "reason": f"Temperature above {very_high_temp_threshold:.0f} °C",
                    "severity": "high",
                }
            )
        elif temp >= high_temp_threshold:
            anomalies.append(
                {
                    "timestamp": p["t"],
                    "temperature_c": temp,
                    "reason": f"Temperature above {high_temp_threshold:.0f} °C",
                    "severity": "medium",
                }
            )

    # Rule 2: spikes (use cleaned series)
    for i in range(1, len(points)):
        dt_h = times_hours[i] - times_hours[i - 1]
        delta = temps[i] - temps[i - 1]
        if dt_h <= spike_window_hours and delta >= spike_delta:
            anomalies.append(
                {
                    "timestamp": points[i]["t"],
                    "temperature_c": temps[i],
                    "reason": f"Temperature spike of {delta:.1f} °C in {dt_h * 60:.0f} minutes",
                    "severity": "medium",
                }
            )

    seen: set[Tuple[str, str]] = set()
    deduped: List[Dict[str, Any]] = []
    for a in anomalies:
        key = (a.get("timestamp", ""), a.get("reason", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(a)
    anomalies = deduped

    if max_temp < 30:
        comfort_level = "COMFORTABLE"
    elif max_temp < 37:
        comfort_level = "WARM"
    elif max_temp < 42:
        comfort_level = "HOT"
    else:
        comfort_level = "RISK"

    recommendations: List[str] = []

    if comfort_level in ("HOT", "RISK"):
        recommendations.append(
            "Let the headset cool down between sessions, keep it in a ventilated area, and avoid direct sunlight."
        )
        recommendations.append(
            "Avoid charging while actively using the headset if temperatures remain high."
        )

    if trend_deg_per_hour is not None and trend_deg_per_hour >= rising_trend_threshold:
        recommendations.append(
            "Temperature trend is rising, monitor the next sessions and check room temperature or airflow near the device."
        )

    if any(a.get("severity") == "high" for a in anomalies):
        recommendations.append(
            "High severity thermal events detected, inspect vents, check for dust blockage, and consider pausing use until stable."
        )
    elif anomalies:
        recommendations.append(
            "Thermal anomalies detected, verify if usage pattern (long sessions, charging) explains it, otherwise inspect the device."
        )

    if not recommendations:
        recommendations.append(
            "No immediate action needed, continue normal usage and keep periodic monitoring enabled."
        )

    summary_recommendation = recommendations[0] if recommendations else None

    return {
        "serial": serial,
        "window_hours": window_hours,
        "points": points,
        "avg_temperature_c": avg_temp,
        "max_temperature_c": max_temp,
        "trend_deg_per_hour": trend_deg_per_hour,
        "anomalies": anomalies,
        "comfort_level": comfort_level,
        "recommendations": recommendations,
        "summary_recommendation": summary_recommendation,
    }
