# import_devices.py
import json
import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DBNAME", "nexoria")

client = MongoClient(MONGODB_URI)
db = client[DB_NAME]
devices = db["devices"]

JSON_PATH = "device_metadata.json"

with open(JSON_PATH, "r", encoding="utf-8") as f:
    raw = json.load(f)

docs = []

if isinstance(raw, dict):

    for device_id, info in raw.items():
        doc = {"id": device_id}
        doc.update(info)
        docs.append(doc)
elif isinstance(raw, list):
   
    docs = raw
else:
    raise ValueError("Unexpected JSON structure in device_metadata.json")

if not docs:
    raise ValueError("No devices found in device_metadata.json")

devices.delete_many({})

result = devices.insert_many(docs)
print(f"Imported {len(result.inserted_ids)} devices")
