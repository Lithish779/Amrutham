#!/usr/bin/env bash
# Smoke demo against a running stack (needs curl + jq): register patient, login, search doctors, list slots.
set -euo pipefail
API=${API:-http://localhost:8080/api/v1}
EMAIL="demo$RANDOM@example.com"; PASS='Str0ngPassw0rd!'
curl -s -X POST $API/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"fullName\":\"Demo Patient\"}" | jq .
TOKEN=$(curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .accessToken)
echo "--- doctors"; curl -s "$API/doctors?sort=rating&limit=3" | jq '.items[] | {id,name,specialization,consultationFeePaise}'
DOC=$(curl -s "$API/doctors?limit=1" | jq -r '.items[0].id')
echo "--- slots"; curl -s "$API/doctors/$DOC/slots" | jq '.items | length'
