#!/bin/bash

# Test script for n8n workflow ledger API
# Requirements: curl and node (for JSON parsing)
# Make sure wrangler dev is running on http://localhost:8787

BASE_URL="http://localhost:8787"
RUN_ID="test-run-$(date +%s)"
WORKFLOW_ID="workflow-123"
EXECUTION_ID="execution-456"

echo "========================================="
echo "Testing n8n Workflow Ledger API"
echo "========================================="
echo ""

# Test 1: POST /jobs (deprecated)
echo "1. Testing POST /jobs (deprecated)"
echo "---------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"run_id\": \"$RUN_ID\",
    \"n8n_workflow_id\": \"$WORKFLOW_ID\",
    \"n8n_execution_id\": \"$EXECUTION_ID\",
    \"n8n_status_code\": 201,
    \"n8n_status_message\": \"workflow_started\",
    \"metadata\": {
      \"source\": \"test\",
      \"timestamp\": $(date +%s)
    }
  }")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "410" ]; then
  echo "❌ Test 1 FAILED - Expected 410, got $HTTP_CODE"
else
  echo "✅ Test 1 PASSED"
fi
echo ""

# Test 2: GET /runs/:run_id (deprecated)
echo "2. Testing GET /runs/:run_id (deprecated)"
echo "----------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/runs/$RUN_ID")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "410" ]; then
  echo "❌ Test 2 FAILED - Expected 410, got $HTTP_CODE"
else
  echo "✅ Test 2 PASSED"
fi
echo ""

# Test 3: GET /runs/:run_id/latest (deprecated)
echo "3. Testing GET /runs/:run_id/latest (deprecated)"
echo "-----------------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/runs/$RUN_ID/latest")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "410" ]; then
  echo "❌ Test 3 FAILED - Expected 410, got $HTTP_CODE"
else
  echo "✅ Test 3 PASSED"
fi
echo ""

# Test 4: GET /executions/:n8n_execution_id (deprecated)
echo "4. Testing GET /executions/:n8n_execution_id (deprecated)"
echo "--------------------------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/executions/$EXECUTION_ID")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "410" ]; then
  echo "❌ Test 4 FAILED - Expected 410, got $HTTP_CODE"
else
  echo "✅ Test 4 PASSED"
fi
echo ""

# Deprecated endpoints verified. Continue with events API tests.

EVENT_ID="event-$(date +%s)"
EVENT_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Test 5: POST /events
echo "5. Testing POST /events"
echo "-----------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$EVENT_ID\",
    \"ts\": \"$EVENT_TS\",
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
  echo "❌ Test 5 FAILED - Expected 201, got $HTTP_CODE"
else
  echo "✅ Test 5 PASSED"
fi
echo ""

# Test 6: GET /events (filter by id)
echo "6. Testing GET /events?id="
echo "--------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -G "$BASE_URL/events" --data-urlencode "id=$EVENT_ID" --data-urlencode "limit=1")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 6 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 6 PASSED"
  MATCH=$(echo "$BODY" | grep -o "\"id\":\"$EVENT_ID\"")
  if [ -z "$MATCH" ]; then
    echo "❌ Test 6 FAILED - Event not found in response"
  else
    echo "Event located: $EVENT_ID"
  fi
fi
echo ""

AUTO_EVENT_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Test 7: POST /events without providing id
echo "7. Testing POST /events without id"
echo "----------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"ts\": \"$AUTO_EVENT_TS\",
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
  echo "❌ Test 7 FAILED - Expected 201 with generated id"
else
  echo "✅ Test 7 PASSED - Generated id: $AUTO_EVENT_ID"
fi
echo ""

# Test 8: GET /events?id=<generated id>
echo "8. Testing GET /events?id=auto-generated"
echo "----------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -G "$BASE_URL/events" --data-urlencode "id=$AUTO_EVENT_ID" --data-urlencode "limit=1")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 8 FAILED - Expected 200, got $HTTP_CODE"
else
  MATCH=$(echo "$BODY" | grep -o "\"id\":\"$AUTO_EVENT_ID\"")
  if [ -z "$MATCH" ]; then
    echo "❌ Test 8 FAILED - Auto-generated event not found"
  else
    echo "✅ Test 8 PASSED - Auto-generated event retrieved"
  fi
fi
echo ""

echo "========================================="
echo "Testing Complete!"
echo "========================================="

