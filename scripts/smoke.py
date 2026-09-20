#!/usr/bin/env python3
"""Integration test. Run ONLY against a fresh disposable Compose installation."""
import http.cookiejar
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
import install_wizard as wizard

base = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8080")
tracker = os.environ.get("TEST_TRACKER_URL", "http://127.0.0.1:5055")
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def request(path, body=None, method=None, opener=client):
    headers = {"Accept": "application/json"}
    if body is not None:
        if isinstance(body, dict):
            headers["Content-Type"] = "application/json"
            body = json.dumps(body).encode()
        else:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            body = body.encode()
    req = urllib.request.Request(base + "/api" + path, data=body, headers=headers, method=method)
    with opener.open(req, timeout=20) as response:
        payload = response.read()
        return json.loads(payload) if payload else None

def must_deny(path, body=None):
    try:
        request(path, body, opener=urllib.request.build_opener())
    except urllib.error.HTTPError as error:
        assert error.code in (400, 401, 403), error.code
    else:
        raise AssertionError("Anonymous access unexpectedly allowed: " + path)

server = request("/server")
if not server["newServer"]:
    raise SystemExit("Refusing: this test requires a fresh, disposable database.")
password = secrets.token_urlsafe(24)
email = "ci-admin@example.invalid"
with patch("builtins.input", side_effect=["CI administrator", email]), \
        patch.object(wizard.getpass, "getpass", return_value=password):
    assert wizard.bootstrap_admin() == email
assert wizard.bootstrap_admin() == "Существующая учётная запись администратора"
assert not request("/server")["registration"]
must_deny("/devices")
must_deny("/users", {"name": "Uninvited", "email": "no@example.invalid", "password": password})
admin = request("/session", urllib.parse.urlencode({"email": email, "password": password}))
assert admin["administrator"]
device = request("/devices", {"name": "CI test vehicle", "uniqueId": "ci-tracker-001"})
start = datetime.now(timezone.utc) - timedelta(minutes=1)
for index in range(3):
    query = urllib.parse.urlencode({
        "id": device["uniqueId"], "timestamp": int(time.time()) + index,
        "lat": 56.8389 + index * .001, "lon": 60.5975 + index * .001, "speed": 10,
    })
    with urllib.request.urlopen(tracker + "/?" + query, timeout=10) as response:
        assert response.status == 200
query = urllib.parse.urlencode({"deviceId": device["id"], "from": start.isoformat(),
                               "to": (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()})
for attempt in range(20):
    route = request("/positions?" + query)
    if len(route) >= 3:
        break
    time.sleep(1)
assert len(route) == 3, route
assert all(point["deviceId"] == device["id"] for point in route)
assert abs(route[-1]["latitude"] - 56.8409) < 0.00001
hidden = request("/devices", {"name": "Other customer", "uniqueId": "ci-hidden-002"})
customer_email = "ci-customer@example.invalid"
customer = request("/users", {
    "name": "CI customer", "email": customer_email, "password": password,
    "administrator": False, "readonly": True, "deviceReadonly": True,
    "userLimit": 0, "deviceLimit": 0, "limitCommands": True, "fixedEmail": True,
})
request("/permissions", {"userId": customer["id"], "deviceId": device["id"]})
customer_client = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
request("/session", urllib.parse.urlencode({"email": customer_email, "password": password}),
        opener=customer_client)
visible = request("/devices?all=true", opener=customer_client)
assert [item["id"] for item in visible] == [device["id"]], visible
assert len(request("/positions?" + query, opener=customer_client)) == 3
# Manager UI stores vehicle metadata without replacing other device settings.
device["model"] = "NAVTELECOM test model"
device["phone"] = "+70000000000"
device["attributes"] = {**device.get("attributes", {}), "intehPlate": "TEST001", "intehProtocol": "EGTS"}
request("/devices/" + str(device["id"]), device, method="PUT")
saved_device = next(item for item in request("/devices?all=true") if item["id"] == device["id"])
assert saved_device["attributes"]["intehPlate"] == "TEST001"
assert saved_device["model"] == "NAVTELECOM test model"
# A client label must never confer access without an explicit server permission.
observer = request("/users", {
    "name": "CI observer", "email": "observer@example.invalid", "password": password,
    "administrator": False, "readonly": True, "deviceReadonly": True,
    "userLimit": 0, "deviceLimit": 0, "limitCommands": True, "fixedEmail": True,
    "attributes": {"intehAccountType": "observer", "intehClientId": customer["id"]},
})
observer_client = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
request("/session", urllib.parse.urlencode({"email": observer["email"], "password": password}), opener=observer_client)
assert request("/devices?all=true", opener=observer_client) == []
request("/permissions", {"userId": observer["id"], "deviceId": device["id"]})
assert [item["id"] for item in request("/devices?all=true", opener=observer_client)] == [device["id"]]
# The explicitly labelled system manager has actual server administrator rights.
manager = request("/users", {
    "name": "CI manager", "email": "manager@example.invalid", "password": password,
    "administrator": True, "readonly": False, "deviceReadonly": False,
    "userLimit": -1, "deviceLimit": -1, "limitCommands": False, "fixedEmail": False,
    "attributes": {"intehAccountType": "manager"},
})
manager_client = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
manager_session = request("/session", urllib.parse.urlencode({"email": manager["email"], "password": password}), opener=manager_client)
assert manager_session["administrator"]
assert {item["id"] for item in request("/devices?all=true", opener=manager_client)} == {device["id"], hidden["id"]}
assert any(item["id"] == customer["id"] for item in request("/users", opener=manager_client))
for path, body in [
    ("/positions?deviceId=" + str(hidden["id"]), None),
    ("/users?userId=" + str(admin["id"]), None),
    ("/devices", {"name": "Unauthorized", "uniqueId": "forbidden"}),
    ("/users", {"name": "Unauthorized", "email": "bad@example.invalid", "password": password}),
]:
    try:
        request(path, body, opener=customer_client)
    except urllib.error.HTTPError as denied:
        assert denied.code in (400, 401, 403), denied.code
    else:
        raise AssertionError("Customer access unexpectedly allowed: " + path)
request("/permissions", {"userId": customer["id"], "deviceId": device["id"]}, method="DELETE")
assert request("/devices?all=true", opener=customer_client) == []
request("/session", method="DELETE")
must_deny("/positions")
print("PASS: bootstrap, login, ingestion, persisted route, customer isolation, permission revocation, logout")
