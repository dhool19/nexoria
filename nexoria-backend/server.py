# server.py
from flask import Flask, request, jsonify, render_template_string, send_file
from datetime import datetime, timedelta, timezone
from flask_cors import CORS
import json, os, certifi
from collections import defaultdict
from typing import Optional
from datetime import datetime

from pymongo import MongoClient, ReturnDocument
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from bson import ObjectId

from battery_anomaly_detection import compute_battery_stats, analyze_battery_with_ai
from thermal_anomaly_detection import compute_temperature_stats, analyze_thermal_with_ai
from network_anomaly_detection import compute_network_stats, analyze_network_with_ai

load_dotenv()

app = Flask(__name__)

# enable CORS for all routes in development
CORS(app)

# ---------- MongoDB setup ----------
MONGODB_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DBNAME", "nexoria")

if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI not set in environment")

mongo_client = MongoClient(
    MONGODB_URI,
    tls=True,
    tlsCAFile=certifi.where(),
    serverSelectionTimeoutMS=30000,
    connectTimeoutMS=30000,
    socketTimeoutMS=30000,
)
db = mongo_client[DB_NAME]

# latest state per device
devices_collection = db["devices"]
# historical heartbeats per device
device_heartbeats_collection = db["device_heartbeats"]

# atomic counters (used for human-friendly device codes like device_01)
counters_collection = db["counters"]

# index to speed up analytics queries over heartbeats
device_heartbeats_collection.create_index([("serial", 1), ("timestamp", 1)])

# APKs and jobs
apks_collection = db["apks"]
device_jobs_collection = db["device_jobs"]

# where APKs are stored on the server
APK_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads_apk")
os.makedirs(APK_UPLOAD_DIR, exist_ok=True)

# ---------- Room mapping ----------
BSSID_ROOMS = {
    "50:e6:36:86:d6:ec": "Living room",
    "d6:eb:53:e8:c3:42": "ESC/EdCon Raum Nummer 308.1 D",
    "56:30:d2:75:59:d9": "ESC/EdCon Raum Nummer 308.1 D"
    # "AA:BB:CC:DD:EE:FF": "Office",
}

# ---------- Load lab metadata ----------
META_PATH = os.path.join(os.path.dirname(__file__), "device_metadata.json")

try:
    with open(META_PATH, "r", encoding="utf-8") as f:
        DEVICE_META = json.load(f)
except FileNotFoundError:
    DEVICE_META = {}
    print("[device_meta] device_metadata.json not found, continuing with empty metadata")


# ---------- Helpers ----------
def _save_device_meta():
    """Persist DEVICE_META to device_metadata.json."""
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(DEVICE_META, f, ensure_ascii=False, indent=2)

def _next_sequence(name: str) -> int:
    """Atomic counter in Mongo (safe under concurrency)."""
    doc = counters_collection.find_one_and_update(
        {"_id": name},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc.get("seq", 1))

def _next_device_code() -> str:
    """Generate device_01, device_02, ..."""
    n = _next_sequence("device_code")
    return f"device_{n:02d}"

def build_device_entry(serial: str, data: dict, device_code: Optional[str] = None) -> dict:
    bssid = data.get("wifi_bssid")
    room = BSSID_ROOMS.get(bssid, "Unknown")

    meta = DEVICE_META.get(serial, {})
    installed_apps = data.get("installed_apps", [])

    if not isinstance(installed_apps, list):
        installed_apps = []

    return {
        "serial": serial,
        "id": serial,
        "device_code": device_code,

        "model": data.get("model"),
        "brand": data.get("brand"),
        "android_version": data.get("android_version") or data.get("os_version"),
        "pui_version": data.get("pui_version"),
        "software_version": data.get("software_version"),
        "storage_used_mb": data.get("storage_used_mb"),
        "storage_total_mb": data.get("storage_total_mb"),
        "volume_current": data.get("volume_current"),
        "volume_max": data.get("volume_max"),
        "brightness": data.get("brightness"),
        "uptime_minutes": data.get("uptime_minutes"),

        "battery": data.get("battery"),
        "temperature_c": data.get("temperature_c"),
        "health": data.get("health"),
        "controller_l": data.get("controller_l"),
        "controller_r": data.get("controller_r"),
        "charging": data.get("charging"),

        "wifi_ssid": data.get("wifi_ssid"),
        "wifi_rssi": data.get("wifi_rssi"),
        "wifi_frequency_mhz": data.get("wifi_frequency_mhz"),
        "wifi_link_mbps": data.get("wifi_link_mbps"),
        "wifi_bssid": bssid,
        "room": room,
        "ip": data.get("ip_address", "unknown"),
        "mac": data.get("mac_address"),

        "installed_apps": installed_apps,
        "last_seen": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),

        "device_type": meta.get("device_type"),
        "color": meta.get("color"),
        "acquisition_year": meta.get("acquisition_year"),
        "device_model_meta": meta.get("device_model"),
        "lab_name": meta.get("lab_name"),
        "device_SN": meta.get("device_SN"),
    }

def mongo_devices_dict() -> dict:
    """Return all devices from Mongo in the same shape your old dict had."""
    docs = list(devices_collection.find())
    result = {}
    for doc in docs:
        serial = doc.get("serial") or doc.get("id")
        if not serial:
            continue
        d = dict(doc)
        d.pop("_id", None)
        result[serial] = d
    return result

def _parse_int_arg(name: str, default_val: int) -> int:
    try:
        return int(request.args.get(name, default_val))
    except (TypeError, ValueError):
        return default_val

def _device_serials():
    return [d["serial"] for d in devices_collection.find({}, {"serial": 1}) if d.get("serial")]

def _latest_heartbeat_map(window_hours: int) -> dict:
    """Return {serial: latest_timestamp} within window."""
    since = datetime.utcnow() - timedelta(hours=window_hours)
    pipeline = [
        {"$match": {"timestamp": {"$gte": since}}},
        {"$group": {"_id": "$serial", "last_ts": {"$max": "$timestamp"}}},
    ]
    out = {}
    for row in device_heartbeats_collection.aggregate(pipeline):
        out[row["_id"]] = row["last_ts"]
    return out

def _get_device_latest_snapshot(serial: str) -> dict:
    doc = devices_collection.find_one({"serial": serial})
    if not doc:
        return {}
    d = dict(doc)
    d.pop("_id", None)
    return d

def _minutes_between(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 60.0


def _build_sessions_from_timestamps(timestamps, gap_minutes: int = 10):
    """
    timestamps: sorted list[datetime]
    returns list of dict: {start, end, duration_minutes}
    """
    if not timestamps:
        return []

    sessions = []
    start = timestamps[0]
    prev = timestamps[0]

    for ts in timestamps[1:]:
        gap = _minutes_between(prev, ts)
        if gap > gap_minutes:
            end = prev
            sessions.append({
                "start": start,
                "end": end,
                "duration_minutes": max(0.0, _minutes_between(start, end)),
            })
            start = ts
        prev = ts

    sessions.append({
        "start": start,
        "end": prev,
        "duration_minutes": max(0.0, _minutes_between(start, prev)),
    })
    return sessions

# this function is used to convert raw heartbeats into meaningful behabioural analytics
def _compute_usage(window_days: int, gap_minutes: int):
    """
    Computes:
      - sessions per device
      - active_minutes per device (sum session durations)
      - avg_session_minutes across fleet
    """
    since = datetime.utcnow() - timedelta(days=window_days)
    window_minutes = window_days * 24 * 60

    serials = _device_serials()
    device_usage = []
    all_session_durations = []

    for serial in serials:
        cursor = device_heartbeats_collection.find(
            {"serial": serial, "timestamp": {"$gte": since}},
            {"timestamp": 1}
        ).sort("timestamp", 1)

        timestamps = [hb["timestamp"] for hb in cursor if hb.get("timestamp")]
        sessions = _build_sessions_from_timestamps(timestamps, gap_minutes=gap_minutes)

        active_minutes = sum(s["duration_minutes"] for s in sessions)
        sessions_count = len(sessions)
        idle_minutes = max(0.0, float(window_minutes) - float(active_minutes))

        for s in sessions:
            all_session_durations.append(s["duration_minutes"])

        device_usage.append({
            "serial": serial,
            "active_minutes": round(active_minutes, 1),
            "sessions": sessions_count,
            "idle_minutes": round(idle_minutes, 1),
        })

    avg_session_minutes = round(sum(all_session_durations) / len(all_session_durations), 1) if all_session_durations else 0.0

    return device_usage, avg_session_minutes

# this function is used the heatmap 
def _compute_heatmap(window_days: int):
    """
    Usage heatmap by day/time.
    We approximate "active minutes" by counting unique minutes that contain at least one heartbeat.
    This avoids overcounting when the agent fast-polls at 5s during job execution.

    Returns: { "Mon": [..24..], ... } where value is active-minutes count.
    """
    since = datetime.utcnow() - timedelta(days=window_days)

    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    heat = {d: [0 for _ in range(24)] for d in days}

    seen = set()

    cursor = device_heartbeats_collection.find(
        {"timestamp": {"$gte": since}},
        {"serial": 1, "timestamp": 1}
    ).sort("timestamp", 1)

    for hb in cursor:
        serial = hb.get("serial")
        ts = hb.get("timestamp")
        if not serial or not ts:
            continue

        minute_ts = ts.replace(second=0, microsecond=0)
        key = (serial, minute_ts)
        if key in seen:
            continue
        seen.add(key)

        day = days[minute_ts.weekday()]
        hour = minute_ts.hour
        heat[day][hour] += 1

    return heat

# this function is turing raw heartbeat telemetry into structured time-series analytics
def _trend_for_metric(serial: str, metric_field: str):
    window_hours = _parse_int_arg("window_hours", 24)
    bucket_minutes = _parse_int_arg("bucket_minutes", 60)

    since = datetime.utcnow() - timedelta(hours=window_hours)

    cursor = device_heartbeats_collection.find(
        {"serial": serial, "timestamp": {"$gte": since}},
        {"timestamp": 1, metric_field: 1, "_id": 0}
    ).sort("timestamp", 1)

    buckets = {}

    for hb in cursor:
        ts = hb.get("timestamp")
        val = hb.get(metric_field)

        if ts is None:
            continue
        if not isinstance(val, (int, float)):
            continue

        bucket_start = ts - timedelta(
            minutes=(ts.minute % bucket_minutes),
            seconds=ts.second,
            microseconds=ts.microsecond
        )

        key = bucket_start.strftime("%Y-%m-%dT%H:%M:%SZ")

        b = buckets.get(key)
        if b is None:
            buckets[key] = {
                "sum": float(val),
                "count": 1,
                "min": float(val),
                "max": float(val)
            }
        else:
            v = float(val)
            b["sum"] += v
            b["count"] += 1
            b["min"] = min(b["min"], v)
            b["max"] = max(b["max"], v)

    points = []
    for k in sorted(buckets.keys()):
        b = buckets[k]
        avg = b["sum"] / b["count"] if b["count"] else None
        points.append({
            "t": k,
            "avg": round(avg, 2) if avg is not None else None,
            "min": round(b["min"], 2),
            "max": round(b["max"], 2),
            "samples": b["count"]
        })

    return jsonify({
        "serial": serial,
        "metric": metric_field,
        "window_hours": window_hours,
        "bucket_minutes": bucket_minutes,
        "points": points
    })

# ---------- API ----------
# device overview API
@app.route("/api/devices", methods=["GET"])
def list_devices_array():
    """Array style API, if you prefer a list instead of object keyed by serial."""
    docs = list(devices_collection.find())
    result = []
    for doc in docs:
        d = dict(doc)
        d.pop("_id", None)
        result.append(d)
    return jsonify(result)

@app.route("/heartbeat", methods=["POST"])
@app.route("/api/heartbeat", methods=["POST"])
def heartbeat():
    try:
        # debug (optional, remove later)
        print("---- HEARTBEAT DEBUG ----")
        print("Content-Type:", request.content_type)
        print("Raw (first 200 bytes):", request.data[:200])
        print("JSON:", request.get_json(silent=True))
        print("-------------------------")

        data = request.get_json(force=True, silent=True)
        if data is None:
            data = request.form.to_dict() if request.form else {}

        if not isinstance(data, dict):
            return jsonify({"error": "Invalid payload, expected JSON object"}), 400

        # agent may send serial in different keys
        serial = (
            data.get("serial")
            or data.get("serial_number")
            or data.get("id")
            or data.get("device_id")
        )

        if not serial:
            return jsonify({
                "error": "Missing serial in payload",
                "received_keys": list(data.keys())
            }), 400

        ts = datetime.now(timezone.utc)

        # 1) save raw heartbeat
        hb_doc = dict(data)
        hb_doc["serial"] = serial
        hb_doc["timestamp"] = ts
        device_heartbeats_collection.insert_one(hb_doc)

        # 2) load existing snapshot
        existing = devices_collection.find_one({"serial": serial}) or {}
        device_code = existing.get("device_code") if existing else _next_device_code()

        print("CURRENT installed_apps:", hb_doc.get("installed_apps"))
        print("OLD installed_apps:", existing.get("installed_apps"))

        # 3) merge installed_apps, preserve old if missing or empty in new heartbeat
        merged_hb = dict(hb_doc)

        incoming_apps = merged_hb.get("installed_apps")

        if isinstance(incoming_apps, list) and len(incoming_apps) > 0:
            merged_hb["installed_apps"] = incoming_apps
        else:
            merged_hb["installed_apps"] = existing.get("installed_apps", [])

        # 4) build latest device snapshot
        device_doc = build_device_entry(serial, merged_hb, device_code=device_code)
        device_doc["last_seen"] = ts.isoformat()

        # extra safety, make sure installed_apps stays preserved
        if not isinstance(device_doc.get("installed_apps"), list):
            device_doc["installed_apps"] = existing.get("installed_apps", [])

        devices_collection.update_one(
            {"serial": serial},
            {"$set": device_doc},
            upsert=True
        )

        # 5) return pending jobs for agent
        pending = list(
            device_jobs_collection.find(
                {"serial": serial, "status": "pending"}
            ).sort("created_at", 1)
        )

        jobs = []
        base = request.host_url.rstrip("/")

        for j in pending:
            item = {
                "job_id": str(j["_id"]),
                "type": j.get("type", "")
            }

            if item["type"] == "install_apk":
                apk_oid = j.get("apk_id")
                apk = apks_collection.find_one({"_id": apk_oid}) if apk_oid else None
                if apk:
                    item["apk_label"] = apk.get("label") or apk.get("filename") or "App"
                    item["apk_download_url"] = f"{base}/api/apks/{str(apk_oid)}/download"

            jobs.append(item)

        return jsonify({
            "ok": True,
            "serial": serial,
            "jobs": jobs
        }), 200

    except Exception as e:
        print("Heartbeat exception:", repr(e))
        return jsonify({
            "error": "Heartbeat failed",
            "details": str(e)
        }), 500

# device overview API in JSON
@app.route("/devices", methods=["GET"])
def devices_map_alias():
    return jsonify(mongo_devices_dict())

# returing device specific information
@app.route("/api/devices/<string:serial>", methods=["GET"])
def get_device(serial):
    doc = devices_collection.find_one({"serial": serial})
    if not doc:
        return jsonify({"error": "Device not found"}), 404
    d = dict(doc)
    d.pop("_id", None)
    return jsonify(d)

#raw battery readings
@app.route("/api/devices/<string:serial>/battery_stats", methods=["GET"])
def get_device_battery_stats(serial):
    """Battery analytics, anomaly detection and simple health prediction."""
    window_hours = _parse_int_arg("window_hours", 24)

    stats = compute_battery_stats(
        device_heartbeats_collection,
        serial,
        window_hours=window_hours,
    )
    return jsonify(stats)

#AI battery readings
@app.route("/api/devices/<string:serial>/battery_stats_ai", methods=["GET"])
def get_device_battery_stats_ai(serial):
    """
    Battery analytics plus AI assisted anomaly explanation and recommendations.
    """
    window_hours = _parse_int_arg("window_hours", 24)

    stats = compute_battery_stats(
        device_heartbeats_collection,
        serial,
        window_hours=window_hours,
    )

    if not stats.get("points"):
        ai_analysis = {
            "overall_assessment": "Not enough data in the selected window.",
            "risk_level": "low",
            "anomalies": [],
            "recommended_actions": [],
        }
    else:
        ai_analysis = analyze_battery_with_ai(stats)

    return jsonify({
        "stats": stats,
        "ai_analysis": ai_analysis,
    })

#raw thermal readings
@app.route("/api/devices/<string:serial>/thermal_stats", methods=["GET"])
def get_device_thermal_stats(serial):
    """
    Thermal comfort and temperature behaviour analytics.
    Looks at long term temperature data and flags potential risks.
    """
    window_hours = _parse_int_arg("window_hours", 24 * 7)

    stats = compute_temperature_stats(
        device_heartbeats_collection,
        serial,
        window_hours=window_hours,
    )
    return jsonify(stats)

#AI thermal readings
@app.route("/api/devices/<string:serial>/thermal_stats_ai", methods=["GET"])
def get_device_thermal_stats_ai(serial):
    window_hours = _parse_int_arg("window_hours", 24 * 7)

    stats = compute_temperature_stats(
        device_heartbeats_collection,
        serial,
        window_hours=window_hours,
    )

    if not stats.get("points"):
        ai_analysis = {
            "overall_assessment": "Not enough data in the selected window.",
            "risk_level": "low",
            "anomalies": [],
            "recommended_actions": [],
        }
    else:
        ai_analysis = analyze_thermal_with_ai(stats)

    return jsonify({
        "stats": stats,
        "ai_analysis": ai_analysis,
    })

#raw network readings
@app.route("/api/devices/<string:serial>/network_stats", methods=["GET"])
def network_stats(serial):
    window_hours = int(request.args.get("window_hours", 24))
    stats = compute_network_stats(device_heartbeats_collection, serial, window_hours)
    return jsonify(stats)

#AI network readings
@app.route("/api/devices/<string:serial>/network_stats_ai", methods=["GET"])
def network_stats_ai(serial):
    window_hours = int(request.args.get("window_hours", 24))
    stats = compute_network_stats(device_heartbeats_collection, serial, window_hours)
    ai = analyze_network_with_ai(stats)
    return jsonify(ai)


# fleet + Usage Analytics
@app.route("/api/analytics/fleet_summary", methods=["GET"])
def fleet_summary():
    """
    Fleet-Level Analytics (Admin View)
    - Average battery across fleet
    - % devices ready for session
    - Low storage devices
    - Overheating today
    - Online vs offline counts
    """
    window_hours = _parse_int_arg("window_hours", 24)

    # Based on your agent: normal heartbeat ~60s, online grace should be bigger than that.
    online_grace_minutes = _parse_int_arg("online_grace_minutes", 5)

    # thresholds (tweak anytime)
    ready_battery_min = _parse_int_arg("ready_battery_min", 60)
    low_storage_free_mb = _parse_int_arg("low_storage_free_mb", 1024)
    overheating_temp_c = _parse_int_arg("overheating_temp_c", 45)

    latest_map = _latest_heartbeat_map(window_hours=window_hours)
    serials = _device_serials()
    fleet_size = len(serials)

    now = datetime.utcnow()

    batteries = []
    ready_count = 0
    online_count = 0
    low_storage_devices = []
    overheating_today = []

    for serial in serials:
        snap = _get_device_latest_snapshot(serial)
        last_ts = latest_map.get(serial)

        is_online = False
        if last_ts:
            is_online = (now - last_ts) <= timedelta(minutes=online_grace_minutes)
        if is_online:
            online_count += 1

        battery = snap.get("battery")
        if isinstance(battery, (int, float)):
            batteries.append(float(battery))

        total_mb = snap.get("storage_total_mb")
        used_mb = snap.get("storage_used_mb")
        free_mb = None
        if isinstance(total_mb, (int, float)) and isinstance(used_mb, (int, float)):
            free_mb = float(total_mb) - float(used_mb)

        temp_c = snap.get("temperature_c")
        is_overheating = isinstance(temp_c, (int, float)) and float(temp_c) >= overheating_temp_c
        if is_overheating:
            overheating_today.append({"serial": serial, "temperature_c": float(temp_c)})

        if free_mb is not None and free_mb < low_storage_free_mb:
            low_storage_devices.append({"serial": serial, "free_mb": round(free_mb, 1)})

        ok_battery = isinstance(battery, (int, float)) and float(battery) >= ready_battery_min
        ok_storage = free_mb is not None and free_mb >= low_storage_free_mb
        ok_temp = not is_overheating

        if is_online and ok_battery and ok_storage and ok_temp:
            ready_count += 1

    avg_battery = round(sum(batteries) / len(batteries), 2) if batteries else None
    offline_count = max(0, fleet_size - online_count)
    ready_pct = round((ready_count / fleet_size) * 100, 2) if fleet_size else 0.0

    return jsonify({
        "fleet_size": fleet_size,
        "avg_battery": avg_battery,
        "ready_count": ready_count,
        "ready_pct": ready_pct,
        "online_count": online_count,
        "offline_count": offline_count,
        "low_storage_devices": low_storage_devices,
        "overheating_today": overheating_today,
        "thresholds": {
            "window_hours": window_hours,
            "online_grace_minutes": online_grace_minutes,
            "ready_battery_min": ready_battery_min,
            "low_storage_free_mb": low_storage_free_mb,
            "overheating_temp_c": overheating_temp_c,
        }
    })

# to check online/offline
@app.route("/api/analytics/online_trend", methods=["GET"])
def online_trend():
    """
    Online vs Offline trend over time.
    Counts distinct devices seen per bucket.
    """
    window_hours = _parse_int_arg("window_hours", 24)
    bucket_minutes = _parse_int_arg("bucket_minutes", 60)

    since = datetime.utcnow() - timedelta(hours=window_hours)

    serials = _device_serials()
    total_devices = len(serials)

    cursor = device_heartbeats_collection.find(
        {"timestamp": {"$gte": since}},
        {"serial": 1, "timestamp": 1}
    ).sort("timestamp", 1)

    buckets = defaultdict(set)
    for hb in cursor:
        ts = hb.get("timestamp")
        serial = hb.get("serial")
        if not ts or not serial:
            continue

        bucket_start = ts - timedelta(
            minutes=(ts.minute % bucket_minutes),
            seconds=ts.second,
            microseconds=ts.microsecond
        )
        key = bucket_start.strftime("%Y-%m-%dT%H:%M:%SZ")
        buckets[key].add(serial)

    points = []
    for k in sorted(buckets.keys()):
        online = len(buckets[k])
        points.append({
            "t": k,
            "online": online,
            "offline": max(0, total_devices - online)
        })

    return jsonify({
        "total_devices": total_devices,
        "bucket_minutes": bucket_minutes,
        "points": points
    })

# usage summary
@app.route("/api/analytics/usage_summary", methods=["GET"])
def usage_summary():
    """
    Usage & Operational Intelligence
    - Session duration analytics
    - Most used devices
    - Least used devices
    - Device idle time analysis
    """
    window_days = _parse_int_arg("window_days", 7)
    session_gap_minutes = _parse_int_arg("session_gap_minutes", 10)

    device_usage, avg_session_minutes = _compute_usage(window_days, session_gap_minutes)

    sorted_by_active = sorted(device_usage, key=lambda x: x.get("active_minutes", 0), reverse=True)
    most_used = sorted_by_active[:5]
    least_used = sorted_by_active[-5:] if len(sorted_by_active) >= 5 else sorted_by_active

    return jsonify({
        "window_days": window_days,
        "session_gap_minutes": session_gap_minutes,
        "avg_session_minutes": avg_session_minutes,
        "most_used": most_used,
        "least_used": least_used,
        "device_usage": device_usage
    })

#usage heatmap
@app.route("/api/analytics/usage_heatmap", methods=["GET"])
def usage_heatmap():
    """
    Usage heatmap by day/time.
    Values represent active-minutes approximation (unique minutes with heartbeats).
    """
    window_days = _parse_int_arg("window_days", 14)
    heat = _compute_heatmap(window_days)

    return jsonify({
        "window_days": window_days,
        "heatmap": heat
    })


@app.route("/api/analytics/insights", methods=["GET"])
def insights():
    """
    Example insights:
      - "Device X used 5x more than fleet average"
      - "Peak usage: Tue 14:00–15:00"
      - "Average session duration: 34 minutes"
    """
    window_days = _parse_int_arg("window_days", 7)
    session_gap_minutes = _parse_int_arg("session_gap_minutes", 10)

    device_usage, avg_session_minutes = _compute_usage(window_days, session_gap_minutes)
    heat = _compute_heatmap(window_days)

    insights_list = []
    insights_list.append(f"Average session duration: {avg_session_minutes} minutes")

    # Peak usage from heatmap
    peak_day, peak_hour, peak_val = None, None, -1
    for day, arr in heat.items():
        for hour, val in enumerate(arr):
            if val > peak_val:
                peak_val = val
                peak_day, peak_hour = day, hour

    if peak_day is not None:
        insights_list.append(f"Peak usage: {peak_day} {peak_hour}:00–{peak_hour + 1}:00")

    # Device used 5x more than fleet average
    actives = [d["active_minutes"] for d in device_usage if isinstance(d.get("active_minutes"), (int, float))]
    fleet_avg_active = (sum(actives) / len(actives)) if actives else 0.0

    if fleet_avg_active > 0:
        # show at most 3 such devices to keep insights clean
        heavy = []
        for d in sorted(device_usage, key=lambda x: x.get("active_minutes", 0), reverse=True):
            ratio = (d.get("active_minutes", 0) / fleet_avg_active) if fleet_avg_active else 0
            if ratio >= 5:
                heavy.append(f"Device {d['serial']} used {round(ratio, 1)}x more than fleet average")
            if len(heavy) >= 3:
                break
        insights_list.extend(heavy)

    return jsonify({
        "window_days": window_days,
        "session_gap_minutes": session_gap_minutes,
        "insights": insights_list
    })


# ---------- APK management and jobs ----------
# upload APK
@app.route("/api/apks", methods=["POST"])
def upload_apk():
    file = request.files.get("apk")
    if not file:
        return jsonify({"error": "No apk file provided"}), 400

    filename = secure_filename(file.filename or "app.apk")
    path = os.path.join(APK_UPLOAD_DIR, filename)
    file.save(path)

    doc = {
        "filename": filename,
        "path": path,
        "label": request.form.get("label") or filename,
        "uploaded_at": datetime.utcnow(),
    }
    result = apks_collection.insert_one(doc)

    return jsonify({
        "id": str(result.inserted_id),
        "filename": filename,
        "label": doc["label"],
    })

# list all APKs
@app.route("/api/apks", methods=["GET"])
def list_apks():
    items = []
    for d in apks_collection.find():
        d["id"] = str(d.pop("_id"))
        d.pop("path", None)
        items.append(d)
    return jsonify(items)

# download APK 
@app.route("/api/apks/<string:apk_id>/download", methods=["GET"])
def download_apk(apk_id):
    try:
        doc = apks_collection.find_one({"_id": ObjectId(apk_id)})
    except Exception:
        return jsonify({"error": "Invalid apk id"}), 400
    if not doc:
        return jsonify({"error": "APK not found"}), 404
    return send_file(doc["path"], as_attachment=True)

# install APK on headset 
@app.route("/api/devices/<string:serial>/install_apk", methods=["POST"])
def create_install_job(serial):
    data = request.json or {}
    apk_id = data.get("apk_id")
    if not apk_id:
        return jsonify({"error": "apk_id required"}), 400

    try:
        apk_oid = ObjectId(apk_id)
    except Exception:
        return jsonify({"error": "Invalid apk_id"}), 400

    if not devices_collection.find_one({"serial": serial}):
        return jsonify({"error": "Device not found"}), 404

    if not apks_collection.find_one({"_id": apk_oid}):
        return jsonify({"error": "APK not found"}), 404

    existing = device_jobs_collection.find_one({
        "serial": serial,
        "type": "install_apk",
        "apk_id": apk_oid,
        "status": "pending",
    })
    if existing:
        return jsonify({"job_id": str(existing["_id"]), "status": "pending", "deduped": True}), 200

    now = datetime.utcnow()

    job = {
        "serial": serial,
        "type": "install_apk",
        "apk_id": apk_oid,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
    }
    result = device_jobs_collection.insert_one(job)
    return jsonify({"job_id": str(result.inserted_id), "status": "pending", "deduped": False}), 200

# job completion acknowledgement endpoint
@app.route("/api/jobs/<string:job_id>/complete", methods=["POST"])
def complete_job(job_id):
    try:
        oid = ObjectId(job_id)
    except Exception:
        return jsonify({"error": "Invalid job id"}), 400

    result = device_jobs_collection.update_one(
        {"_id": oid},
        {"$set": {"status": "done", "updated_at": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        return jsonify({"error": "Job not found"}), 404

    return jsonify({"status": "ok"})

# battery percentage
@app.route("/api/devices/<string:serial>/battery_trend", methods=["GET"])
def battery_trend(serial):
    return _trend_for_metric(serial, "battery")

# temperature in celsius
@app.route("/api/devices/<string:serial>/temperature_trend", methods=["GET"])
def temperature_trend(serial):
    return _trend_for_metric(serial, "temperature_c")

# for lab meta data
@app.route("/api/devices/<string:serial>/lab_metadata", methods=["PUT"])
def update_lab_metadata(serial: str):
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid payload"}), 400

    required = ["device_type", "color", "acquisition_year", "device_model", "lab_name", "device_SN"]
    missing = [k for k in required if payload.get(k) in (None, "", [])]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    try:
        acquisition_year = int(payload.get("acquisition_year"))
    except Exception:
        return jsonify({"error": "acquisition_year must be an integer"}), 400

    DEVICE_META[serial] = {
        "device_type": payload.get("device_type"),
        "color": payload.get("color"),
        "acquisition_year": acquisition_year,
        "device_model": payload.get("device_model"),
        "lab_name": payload.get("lab_name"),
        "device_SN": payload.get("device_SN"),
    }
    _save_device_meta()

    devices_collection.update_one(
        {"serial": serial},
        {"$set": {
            "device_type": payload.get("device_type"),
            "color": payload.get("color"),
            "acquisition_year": acquisition_year,
            "device_model_meta": payload.get("device_model"),
            "lab_name": payload.get("lab_name"),
            "device_SN": payload.get("device_SN"),
            "last_seen": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }},
        upsert=True
    )

    return jsonify({"message": "Lab metadata updated", "serial": serial}), 200

#Delete apk route
@app.route("/api/apks/<string:apk_id>", methods=["DELETE"])
def delete_apk(apk_id):
    try:
        oid = ObjectId(apk_id)
    except Exception:
        return jsonify({"error": "Invalid apk id"}), 400

    doc = apks_collection.find_one({"_id": oid})
    if not doc:
        return jsonify({"error": "APK not found"}), 404

    in_use = device_jobs_collection.count_documents({"apk_id": oid, "status": {"$in": ["queued", "running"]}})
    if in_use > 0:
        return jsonify({"error": "APK is in use by active jobs. Cancel jobs or use force delete."}), 409

    path = doc.get("path")
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass

    apks_collection.delete_one({"_id": oid})
    return jsonify({"message": "APK deleted"}), 200

#Delete device 
@app.route("/api/devices/<string:serial>", methods=["DELETE"])
def delete_device(serial: str):
    existing = devices_collection.find_one({"serial": serial})
    if not existing:
        return jsonify({"error": "Device not found"}), 404

    try:
        if serial in DEVICE_META:
            DEVICE_META.pop(serial, None)
            _save_device_meta()
    except Exception:
        pass 

    dev_res = devices_collection.delete_one({"serial": serial})
    hb_res = device_heartbeats_collection.delete_many({"serial": serial})
    jobs_res = device_jobs_collection.delete_many({"serial": serial})

    return jsonify({
        "message": "deleted",
        "serial": serial,
        "deleted": {
            "device": dev_res.deleted_count,
            "heartbeats": hb_res.deleted_count,
            "jobs": jobs_res.deleted_count,
        }
    }), 200

# ---------- Dashboard (HTML view) ----------
@app.route("/")
def dashboard():
    # consider a device online if the last heartbeat is within 5 minutes
    now = datetime.now()

    def status(ts: str) -> str:
        try:
            dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
            return "Online" if now - dt <= timedelta(minutes=5) else "Offline"
        except Exception:
            return "Unknown"

    devices = mongo_devices_dict()

    html = """
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>VR Fleet Dashboard</title>
  <style>
    body { font-family: system-ui, Arial, sans-serif; margin: 20px; color: #111; }
    h1 { margin: 0 0 12px 0; }
    .wrap { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
    .card { border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px; background: #fff; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .title { font-size: 16px; font-weight: 700; }
    .badge { padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 12px; }
    .ok { background: #e9f9ee; color: #0f6b3a; }
    .err { background: #ffecec; color: #8a1f1f; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 12px; color: #666; padding: 6px 0; }
    td { padding: 4px 0; font-size: 14px; border-bottom: 1px solid #f3f3f3; vertical-align: top; }
    small { color: #666; }
    .grid3 { display: grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 900px) { .grid3 { grid-template-columns: repeat(3, 1fr); } }
    .muted { color: #666; }
    .mt12 { margin-top: 12px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
    details { margin-top: 4px; }
    details summary { cursor: pointer; list-style: none; }
    details summary::-webkit-details-marker { display: none; }
    details summary::before { content: "▸ "; font-size: 10px; }
    details[open] summary::before { content: "▾ "; }
    ul.app-list { list-style: none; padding-left: 0; margin: 4px 0 0 0; max-height: 180px; overflow-y: auto; }
    ul.app-list li { font-size: 13px; padding: 2px 0; }
  </style>
</head>
<body>
  <h1>VR Fleet Dashboard</h1>

  {% if not devices %}
    <p>No devices yet. Waiting for heartbeats...</p>
  {% else %}
    <div class="wrap">
    {% for sn, d in devices.items() %}
      <div class="card">
        <div class="head">
          <div class="title">
            Device
            {% if d.get('device_code') %}
              <span class="mono">{{ d.get('device_code') }}</span>
              <small class="muted">(SN: <span class="mono">{{ sn }}</span>)</small>
            {% else %}
              <span class="muted mono">SN: {{ sn }}</span>
            {% endif %}
          </div>
          <span class="badge {{ 'ok' if status(d['last_seen'])=='Online' else 'err' }}">
            {{ status(d['last_seen']) }}
          </span>
        </div>

        <div class="grid3">
          <!-- Device block -->
          <div>
            <table>
              <tr><th colspan="2">Device</th></tr>
              <tr><td>Last online</td><td class="mono">{{ d.get('last_seen','-') }}</td></tr>
              <tr><td>Model</td><td>{{ d.get('brand','-') }} {{ d.get('model','') }}</td></tr>
              <tr><td>Android version</td><td>{{ d.get('android_version','-') }}</td></tr>
              <tr><td>PUI version</td><td>{{ d.get('pui_version','-') }}</td></tr>
              <tr><td>Software version</td><td>{{ d.get('software_version','-') }}</td></tr>
              <tr><td>Storage used</td><td>{{ d.get('storage_used_mb','-') }} / {{ d.get('storage_total_mb','-') }} MB</td></tr>
              <tr><td>Volume</td><td>{{ d.get('volume_current','-') }}/{{ d.get('volume_max','-') }}</td></tr>
              <tr><td>Brightness</td><td>{{ d.get('brightness','-') }}</td></tr>
              <tr><td>Uptime</td><td>{{ d.get('uptime_minutes','-') }} min</td></tr>
              <tr>
                <td colspan="2">
                  <details>
                    <summary>
                      Installed apps ({{ d.get('installed_apps', [])|length }})
                    </summary>
                    {% if d.get('installed_apps') %}
                      <ul class="app-list">
                        {% for app in d['installed_apps'] %}
                          <li>
                            {{ app.get('label', app.get('package_name')) }}
                            <small class="muted">
                              ({{ app.get('package_name') }}, {{ app.get('version_name','') }})
                            </small>
                          </li>
                        {% endfor %}
                      </ul>
                    {% else %}
                      <span class="muted">No data</span>
                    {% endif %}
                  </details>
                </td>
              </tr>
            </table>
          </div>

          <!-- Battery block -->
          <div>
            <table>
              <tr><th colspan="2">Battery</th></tr>
              <tr><td>Device</td><td>{{ d.get('battery','-') }}%</td></tr>
              <tr><td>Temperature</td><td>{{ d.get('temperature_c','-') }} °C</td></tr>
              <tr><td>Health</td><td>{{ d.get('health','-') }}</td></tr>
              <tr><td>Charging</td><td>{{ d.get('charging','-') }}</td></tr>
              <tr><td>Controller (L)</td><td>{{ d.get('controller_l','-') }}</td></tr>
              <tr><td>Controller (R)</td><td>{{ d.get('controller_r','-') }}</td></tr>
            </table>
          </div>

          <!-- Network and lab metadata block -->
          <div>
            <table>
              <tr><th colspan="2">Network</th></tr>
              <tr><td>SSID</td><td>{{ d.get('wifi_ssid','-') }}</td></tr>
              <tr><td>Room</td><td>{{ d.get('room','-') }}</td></tr>
              <tr><td>BSSID</td><td class="mono">{{ d.get('wifi_bssid','-') }}</td></tr>
              <tr><td>Signal strength</td><td>{{ d.get('wifi_rssi','-') }} dBm</td></tr>
              <tr><td>Frequency</td><td>{{ d.get('wifi_frequency_mhz','-') }} MHz</td></tr>
              <tr><td>Link speed</td><td>{{ d.get('wifi_link_mbps','-') }} Mbps</td></tr>
              <tr><td>IP address</td><td class="mono">{{ d.get('ip','-') }}</td></tr>
              <tr><td>MAC address</td><td class="mono">{{ d.get('mac','-') }}</td></tr>
              <tr><th colspan="2">Lab metadata</th></tr>
              <tr><td>Device type</td><td>{{ d.get('device_type','-') }}</td></tr>
              <tr><td>Color</td><td>{{ d.get('color','-') }}</td></tr>
              <tr><td>Acquisition year</td><td>{{ d.get('acquisition_year','-') }}</td></tr>
              <tr><td>Model (meta)</td><td>{{ d.get('device_model_meta','-') }}</td></tr>
              <tr><td>Lab name</td><td>{{ d.get('lab_name','-') }}</td></tr>
              <tr><td>Lab SN</td><td>{{ d.get('device_SN','-') }}</td></tr>
            </table>
          </div>
        </div>
      </div>
    {% endfor %}
    </div>
  {% endif %}
</body>
</html>
"""
    return render_template_string(html, devices=devices, status=status)

# ---------- Main ----------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
