# hf_client.py

import os
import requests
from typing import Any, Dict


def call_hf_model(
    prompt: str,
    max_tokens: int = 400,
    temperature: float = 0.1,
    top_p: float = 0.9,
    timeout: int = 60,
) -> Dict[str, Any]:

    hf_token = os.getenv("HF_TOKEN")
    hf_model = os.getenv("HF_MODEL", "HuggingFaceH4/zephyr-7b-beta")

    if not hf_token:
        raise RuntimeError("HF_TOKEN not set")

    url = "https://router.huggingface.co/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": hf_model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
    }

    response = requests.post(url, headers=headers, json=payload, timeout=timeout)

    if response.status_code != 200:
        raise RuntimeError(
            f"HF API error {response.status_code}: {response.text}"
        )

    data = response.json()

    return {
        "generated_text": data["choices"][0]["message"]["content"],
        "raw_response": data,
    }