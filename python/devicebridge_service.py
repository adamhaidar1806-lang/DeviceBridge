#!/usr/bin/env python3
"""Small Python service logic used by the DeviceBridge API.

The Node API remains the main web server, while this module owns the
device-fit scoring logic required by the competition brief.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def score_device_fit(payload: dict[str, Any]) -> dict[str, Any]:
    purpose = str(payload.get("purpose", "")).strip().lower()
    category = str(payload.get("category", "")).strip().lower()
    offer = str(payload.get("offer", "")).strip().upper()
    location_match = bool(payload.get("locationMatch", False))

    score = 35
    reasons: list[str] = []

    if len(purpose) >= 20:
        score += 20
        reasons.append("Your purpose gives the provider useful context.")
    elif purpose:
        score += 8
        reasons.append("Add a little more detail about what the device enables.")
    else:
        reasons.append("Share what you need the device to help you do.")

    access_words = ("study", "school", "class", "work", "job", "interview", "online")
    if any(word in purpose for word in access_words):
        score += 18
        reasons.append("The request clearly connects the device to access or opportunity.")

    if category:
        score += 10
        reasons.append(f"The requested category is identified as {category}.")

    if offer == "DONATE":
        score += 8
        reasons.append("Donation requests are prioritised for access impact.")
    elif offer == "LEND":
        score += 5
        reasons.append("A loan can be a practical short-term bridge.")

    if location_match:
        score += 9
        reasons.append("The pickup location matches the listing area.")

    score = min(score, 100)
    label = "Strong fit" if score >= 75 else "Promising fit" if score >= 55 else "Needs more detail"

    return {
        "score": score,
        "label": label,
        "reasons": reasons[:4],
        "engine": "python-device-fit-v1",
    }


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--health":
        print(json.dumps({"status": "ok", "engine": "python-device-fit-v1"}))
        return

    raw_payload = sys.argv[1] if len(sys.argv) > 1 else "{}"
    payload = json.loads(raw_payload)
    print(json.dumps(score_device_fit(payload)))


if __name__ == "__main__":
    main()