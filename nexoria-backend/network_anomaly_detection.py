from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import json
import re

from hf_client import call_hf_model


def compute_network_stats(
    heartbeat_collection,
    serial: str,
    window_hours: int = 24,
) -> Dict[str, Any]:
    """
    Analyze network performance for a device based on wifi_rssi and wifi_link_mbps.

    Returns:
    - time series points
    - averages and mins
    - simple stability scores
    - anomaly list (rule-based)
    """

    since = datetime.utcnow() - timedelta(hours=window_hours)

    cursor = heartbeat_collection.find(
        {"serial": serial, "timestamp": {"$gte": since}}
    ).sort("timestamp", 1)

    rows: List[Dict[str, Any]] = list(cursor)
    if len(rows) == 0:
        return {
            "serial": serial,
            "window_hours": window_hours,
            "points": [],
            "avg_rssi": None,
            "min_rssi": None,
            "avg_link_mbps": None,
            "min_link_mbps": None,
            "rssi_stability_score": None,
            "link_stability_score": None,
            "anomalies": [],
        }

    points: List[Dict[str, Any]] = []
    rssi_values: List[int] = []
    link_values: List[float] = []

    prev_rssi = None
    prev_link = None

    for row in rows:
        rssi = row.get("wifi_rssi")
        link = row.get("wifi_link_mbps")
        ssid = row.get("wifi_ssid")

        points.append(
            {
                "t": row["timestamp"].isoformat(),
                "wifi_rssi": rssi,
                "wifi_link_mbps": link,
                "wifi_ssid": ssid,
            }
        )

        if isinstance(rssi, (int, float)):
            rssi_values.append(int(rssi))
        if isinstance(link, (int, float)):
            link_values.append(float(link))

    avg_rssi = sum(rssi_values) / len(rssi_values) if rssi_values else None
    min_rssi = min(rssi_values) if rssi_values else None

    avg_link_mbps = sum(link_values) / len(link_values) if link_values else None
    min_link_mbps = min(link_values) if link_values else None

    rssi_jumps = 0
    link_jumps = 0

    for row in rows:
        rssi = row.get("wifi_rssi")
        link = row.get("wifi_link_mbps")

        if isinstance(rssi, (int, float)):
            if prev_rssi is not None and abs(rssi - prev_rssi) >= 15:
                rssi_jumps += 1
            prev_rssi = rssi

        if isinstance(link, (int, float)):
            if prev_link is not None and abs(link - prev_link) >= 20:
                link_jumps += 1
            prev_link = link

    total_samples = max(len(rows), 1)
    rssi_stability_score = 1.0 - min(rssi_jumps / total_samples, 1.0)
    link_stability_score = 1.0 - min(link_jumps / total_samples, 1.0)

    anomalies: List[Dict[str, Any]] = []

    WEAK_RSSI = -70
    VERY_WEAK_RSSI = -80

    LOW_LINK = 10
    VERY_LOW_LINK = 3

    if avg_rssi is not None and avg_rssi <= VERY_WEAK_RSSI:
        anomalies.append(
            {
                "type": "rssi",
                "severity": "high",
                "reason": f"Average WiFi RSSI is very weak ({avg_rssi:.1f} dBm).",
            }
        )
    elif avg_rssi is not None and avg_rssi <= WEAK_RSSI:
        anomalies.append(
            {
                "type": "rssi",
                "severity": "medium",
                "reason": f"Average WiFi RSSI is weak ({avg_rssi:.1f} dBm).",
            }
        )

    if avg_link_mbps is not None and avg_link_mbps <= VERY_LOW_LINK:
        anomalies.append(
            {
                "type": "link",
                "severity": "high",
                "reason": f"Average link speed is very low ({avg_link_mbps:.1f} Mbps).",
            }
        )
    elif avg_link_mbps is not None and avg_link_mbps <= LOW_LINK:
        anomalies.append(
            {
                "type": "link",
                "severity": "medium",
                "reason": f"Average link speed is low ({avg_link_mbps:.1f} Mbps).",
            }
        )

    if rssi_stability_score is not None and rssi_stability_score < 0.6:
        anomalies.append(
            {
                "type": "rssi",
                "severity": "medium",
                "reason": "WiFi signal strength is fluctuating heavily.",
            }
        )

    if link_stability_score is not None and link_stability_score < 0.6:
        anomalies.append(
            {
                "type": "link",
                "severity": "medium",
                "reason": "WiFi link speed is unstable.",
            }
        )

    return {
        "serial": serial,
        "window_hours": window_hours,
        "points": points,
        "avg_rssi": avg_rssi,
        "min_rssi": min_rssi,
        "avg_link_mbps": avg_link_mbps,
        "min_link_mbps": min_link_mbps,
        "rssi_stability_score": rssi_stability_score,
        "link_stability_score": link_stability_score,
        "anomalies": anomalies,
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
    """
    Reject non-strings or weak recommendations.
    """
    if not isinstance(s, str):
        return True
    words = [w for w in s.strip().split() if w]
    return len(words) < 8


def _build_default_network_recommendations(stats: Dict[str, Any]) -> List[str]:
    """
    Always return useful recommendations, even when no anomalies exist.
    This is the key fix for your dashboard.
    """
    avg_rssi = stats.get("avg_rssi")
    avg_link_mbps = stats.get("avg_link_mbps")
    rssi_stability = stats.get("rssi_stability_score")
    link_stability = stats.get("link_stability_score")
    anomalies = stats.get("anomalies", [])

    recommendations: List[str] = []

    if anomalies:
        recommendations.append(
            "Review WiFi signal quality and device placement, because weak or unstable connectivity can interrupt telemetry updates and remote management tasks."
        )

        if avg_rssi is not None and avg_rssi <= -70:
            recommendations.append(
                f"Move the headset closer to the access point or reduce physical obstructions, because the average RSSI of {avg_rssi:.1f} dBm indicates weak reception."
            )

        if avg_link_mbps is not None and avg_link_mbps <= 10:
            recommendations.append(
                f"Check router load, channel congestion, and backhaul performance, because the average link speed of {avg_link_mbps:.1f} Mbps is low for VR usage."
            )

        if rssi_stability is not None and rssi_stability < 0.6:
            recommendations.append(
                "Inspect interference from nearby devices and overlapping wireless networks, because large RSSI fluctuations can cause inconsistent session quality."
            )

        if link_stability is not None and link_stability < 0.6:
            recommendations.append(
                "Monitor bandwidth variation during active sessions, because unstable link speed can affect remote installs, streaming, and management responsiveness."
            )

        recommendations.append(
            "Prefer a 5 GHz or less congested wireless band for this headset, because VR workloads benefit from more stable throughput and lower interference."
        )

        recommendations.append(
            "Capture timestamps, RSSI values, and link speed samples during poor performance periods, because this helps correlate anomalies with real usage conditions."
        )

    else:
        recommendations.extend(
            [
                "Maintain the headset within strong WiFi coverage, because consistent signal quality supports stable telemetry transmission and smoother remote management operations.",
                "Continue monitoring RSSI and link speed during active VR sessions, because performance can degrade under movement, congestion, or changing room conditions.",
                "Prefer a 5 GHz network where possible, because it usually provides better throughput and less interference for shared VR headset environments.",
                "Keep the access point firmware and network configuration updated, because stable infrastructure reduces unexpected drops in wireless performance over time.",
                "Review network behaviour during peak lab usage hours, because a normal average can still hide temporary congestion when multiple devices connect together.",
            ]
        )

        if avg_rssi is not None and avg_rssi > -60:
            recommendations.append(
                f"The current average RSSI of {avg_rssi:.1f} dBm is healthy, so the present device placement appears suitable for reliable connectivity."
            )

        if avg_link_mbps is not None and avg_link_mbps >= 100:
            recommendations.append(
                f"The average link speed of {avg_link_mbps:.1f} Mbps is strong, which indicates the device currently has sufficient bandwidth for routine operation."
            )

        if (
            rssi_stability is not None
            and link_stability is not None
            and rssi_stability >= 0.8
            and link_stability >= 0.8
        ):
            recommendations.append(
                "Both signal and link stability appear strong across the observed window, so no immediate corrective action is required beyond routine monitoring."
            )

    unique_recommendations: List[str] = []
    seen = set()
    for rec in recommendations:
        if rec not in seen:
            unique_recommendations.append(rec)
            seen.add(rec)

    return unique_recommendations[:8]


def _normalize_ai_response(parsed: Dict[str, Any], stats: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize AI response and guarantee minimum useful content.
    """
    parsed.setdefault("overall_assessment", "")
    parsed.setdefault("risk_level", "low")
    parsed.setdefault("anomalies", [])
    parsed.setdefault("recommended_actions", [])

    if not isinstance(parsed.get("anomalies"), list):
        parsed["anomalies"] = []

    if not isinstance(parsed.get("recommended_actions"), list):
        parsed["recommended_actions"] = []

    cleaned_actions: List[str] = []
    for item in parsed["recommended_actions"]:
        if isinstance(item, str) and item.strip():
            cleaned_actions.append(item.strip())

    parsed["recommended_actions"] = cleaned_actions

    weak_count = sum(1 for r in parsed["recommended_actions"] if _is_action_too_short(r))
    if len(parsed["recommended_actions"]) < 3 or weak_count >= 2:
        fallback = _build_default_network_recommendations(stats)
        merged = parsed["recommended_actions"] + fallback

        unique_merged: List[str] = []
        seen = set()
        for rec in merged:
            if isinstance(rec, str) and rec.strip() and rec not in seen:
                unique_merged.append(rec.strip())
                seen.add(rec)

        parsed["recommended_actions"] = unique_merged[:8]

    if not parsed["overall_assessment"]:
        if stats.get("anomalies"):
            parsed["overall_assessment"] = "Network performance shows signs of instability or reduced quality and should be reviewed."
        else:
            parsed["overall_assessment"] = "Network performance looks normal and no major anomalies were detected in the selected time window."

    if parsed["risk_level"] not in {"low", "medium", "high"}:
        parsed["risk_level"] = "low" if not stats.get("anomalies") else "medium"

    return parsed


def analyze_network_with_ai(stats: Dict[str, Any]) -> Dict[str, Any]:
    """
    AI interpretation layer for network stats.
    If AI output is weak or invalid, fallback recommendations are still returned.
    """

    points = stats.get("points", [])
    sample_points = points[-80:]

    payload_summary = {
        "serial": stats.get("serial"),
        "window_hours": stats.get("window_hours"),
        "avg_rssi": stats.get("avg_rssi"),
        "min_rssi": stats.get("min_rssi"),
        "avg_link_mbps": stats.get("avg_link_mbps"),
        "min_link_mbps": stats.get("min_link_mbps"),
        "rssi_stability_score": stats.get("rssi_stability_score"),
        "link_stability_score": stats.get("link_stability_score"),
        "anomalies_detected_by_rule": stats.get("anomalies", []),
        "recent_points": sample_points,
    }

    base_prompt = (
        "You are a network diagnostics assistant for VR headsets.\n"
        "Analyze WiFi RSSI, link speed, stability, and suggest practical actions for lab environments.\n\n"
        "Return ONLY valid JSON with this schema:\n"
        "{\n"
        '  "overall_assessment": string,\n'
        '  "risk_level": "low" | "medium" | "high",\n'
        '  "anomalies": [\n'
        '    {\n'
        '      "timestamp": string | null,\n'
        '      "severity": "low" | "medium" | "high",\n'
        '      "short_description": string,\n'
        '      "details": string\n'
        "    }\n"
        "  ],\n"
        '  "recommended_actions": [string]\n'
        "}\n\n"
        "Rules:\n"
        "1) If anomalies exist, describe them clearly.\n"
        "2) If no anomalies exist, state that no major anomalies were detected.\n"
        "3) Always provide 5 to 8 recommended_actions.\n"
        "4) Recommendations should be practical for shared VR headset environments.\n"
        "5) Return JSON only, no markdown.\n\n"
        f"Data:\n{json.dumps(payload_summary, default=str)}"
    )

    generated_text = ""
    parsed = None

    try:
        result = call_hf_model(base_prompt)
        generated_text = (result.get("generated_text") or "").strip()
        print("HF AI response (first 200 chars):", generated_text[:200])
        parsed = _extract_json_object(generated_text)
    except Exception as e:
        print("HF AI call failed:", str(e))

    if not parsed and generated_text:
        try:
            repair_prompt = (
                "Convert the following content into ONLY valid JSON matching this schema:\n"
                "{\n"
                '  "overall_assessment": string,\n'
                '  "risk_level": "low" | "medium" | "high",\n'
                '  "anomalies": [{"timestamp": string | null, "severity": "low" | "medium" | "high", "short_description": string, "details": string}],\n'
                '  "recommended_actions": [string]\n'
                "}\n\n"
                f"Content:\n{generated_text}"
            )
            repaired_text = (call_hf_model(repair_prompt).get("generated_text") or "").strip()
            print("HF AI repair (first 200 chars):", repaired_text[:200])
            parsed = _extract_json_object(repaired_text)
            if parsed:
                generated_text = repaired_text
        except Exception as e:
            print("HF AI repair failed:", str(e))

    if parsed:
        parsed = _normalize_ai_response(parsed, stats)
        parsed["raw_text"] = generated_text
        return parsed

    fallback_anomalies = []
    for item in stats.get("anomalies", []):
        fallback_anomalies.append(
            {
                "timestamp": None,
                "severity": item.get("severity", "low"),
                "short_description": item.get("type", "network").upper(),
                "details": item.get("reason", ""),
            }
        )

    return {
        "overall_assessment": (
            "Network performance looks normal and no major anomalies were detected in the selected time window."
            if not stats.get("anomalies")
            else "Network performance indicates potential issues that should be monitored more closely."
        ),
        "risk_level": "low" if not stats.get("anomalies") else "medium",
        "anomalies": fallback_anomalies,
        "recommended_actions": _build_default_network_recommendations(stats),
        "raw_text": generated_text,
    }