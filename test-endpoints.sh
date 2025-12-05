#!/bin/bash

# Test script for n8n workflow ledger API
# Requirements: curl and node (for JSON parsing)
# Make sure wrangler dev is running on http://localhost:8787

BASE_URL="http://localhost:8787"
RUN_ID="test-run-$(date +%s)"

echo "========================================="
echo "Testing n8n Workflow Ledger API"
echo "========================================="
echo ""

EVENT_ID="event-$(date +%s)"
# Test 1: POST /events
echo "1. Testing POST /events"
echo "-----------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$EVENT_ID\",
    \"payload\": {
      \"type\": \"workflow.notification\",
      \"run_id\": \"$RUN_ID\"
    }
  }")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "201" ]; then
  echo "❌ Test 1 FAILED - Expected 201, got $HTTP_CODE"
else
  echo "✅ Test 1 PASSED"
fi
echo ""

# Test 2: GET /events (filter by id)
echo "2. Testing GET /events?id="
echo "--------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -G "$BASE_URL/events" --data-urlencode "id=$EVENT_ID" --data-urlencode "limit=1")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

EVENT_TS_VALUE=$(echo "$BODY" | node -e "const fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(0, 'utf8')); const ts = data.events?.[0]?.ts ?? ''; process.stdout.write(ts);")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 2 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 2 PASSED"
  MATCH=$(echo "$BODY" | grep -o "\"id\":\"$EVENT_ID\"")
  if [ -z "$MATCH" ]; then
    echo "❌ Test 2 FAILED - Event not found in response"
  else
    echo "Event located: $EVENT_ID"
    if [ -z "$EVENT_TS_VALUE" ]; then
      echo "❌ Test 2 FAILED - Timestamp missing in stored event"
    else
      echo "Timestamp recorded: $EVENT_TS_VALUE"
    }
  fi
fi
echo ""

# Test 3: POST /events without providing id
echo "3. Testing POST /events without id"
echo "----------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"payload\": {
      \"type\": \"workflow.notification\",
      \"detail\": \"auto-id\"
    }
  }")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

AUTO_EVENT_ID=$(echo "$BODY" | node -e "const fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(0, 'utf8')); process.stdout.write(data.id ?? '');")

if [ "$HTTP_CODE" != "201" ] || [ -z "$AUTO_EVENT_ID" ]; then
  echo "❌ Test 3 FAILED - Expected 201 with generated id"
else
  echo "✅ Test 3 PASSED - Generated id: $AUTO_EVENT_ID"
fi
echo ""

# Test 4: GET /events?id=<generated id>
echo "4. Testing GET /events?id=auto-generated"
echo "----------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -G "$BASE_URL/events" --data-urlencode "id=$AUTO_EVENT_ID" --data-urlencode "limit=1")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

AUTO_EVENT_TS_VALUE=$(echo "$BODY" | node -e "const fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(0, 'utf8')); const ts = data.events?.[0]?.ts ?? ''; process.stdout.write(ts);")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 4 FAILED - Expected 200, got $HTTP_CODE"
else
  MATCH=$(echo "$BODY" | grep -o "\"id\":\"$AUTO_EVENT_ID\"")
  if [ -z "$MATCH" ]; then
    echo "❌ Test 4 FAILED - Auto-generated event not found"
  else
    if [ -z "$AUTO_EVENT_TS_VALUE" ]; then
      echo "❌ Test 4 FAILED - Timestamp missing for auto-generated event"
    else
      echo "✅ Test 4 PASSED - Auto-generated event retrieved with ts $AUTO_EVENT_TS_VALUE"
    fi
  fi
fi
echo ""

echo "========================================="
echo "Testing Complete!"
echo "========================================="

