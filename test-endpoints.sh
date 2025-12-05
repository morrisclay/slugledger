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

# Test 1: POST /jobs
echo "1. Testing POST /jobs"
echo "-------------------"
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

if [ "$HTTP_CODE" != "201" ]; then
  echo "❌ Test 1 FAILED - Expected 201, got $HTTP_CODE"
else
  echo "✅ Test 1 PASSED"
fi
echo ""

# Test 2: GET /runs/:run_id
echo "2. Testing GET /runs/:run_id"
echo "---------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/runs/$RUN_ID")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 2 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 2 PASSED"
  RUN_COUNT=$(echo "$BODY" | grep -o '"runs":\[.*\]' | grep -o '{' | wc -l | tr -d ' ')
  echo "Number of runs returned: $RUN_COUNT"
fi
echo ""

# Test 3: GET /runs/:run_id/latest
echo "3. Testing GET /runs/:run_id/latest"
echo "----------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/runs/$RUN_ID/latest")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 3 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 3 PASSED"
fi
echo ""

# Test 4: GET /executions/:n8n_execution_id
echo "4. Testing GET /executions/:n8n_execution_id"
echo "--------------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/executions/$EXECUTION_ID")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 4 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 4 PASSED"
  EXEC_COUNT=$(echo "$BODY" | grep -o '"executions":\[.*\]' | grep -o '{' | wc -l | tr -d ' ')
  echo "Number of executions returned: $EXEC_COUNT"
fi
echo ""

# Test 5: Error handling - Invalid POST /jobs
echo "5. Testing Error Handling - Invalid POST /jobs"
echo "----------------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"run_id\": \"\",
    \"n8n_workflow_id\": \"$WORKFLOW_ID\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "400" ]; then
  echo "❌ Test 5 FAILED - Expected 400, got $HTTP_CODE"
else
  echo "✅ Test 5 PASSED"
fi
echo ""

# Test 6: Error handling - Non-existent run_id
echo "6. Testing Error Handling - Non-existent run_id"
echo "------------------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/runs/non-existent-run-id/latest")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "404" ]; then
  echo "❌ Test 6 FAILED - Expected 404, got $HTTP_CODE"
else
  echo "✅ Test 6 PASSED"
fi
echo ""

EVENT_ID="event-$(date +%s)"
EVENT_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Test 7: POST /events
echo "7. Testing POST /events"
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
  echo "❌ Test 7 FAILED - Expected 201, got $HTTP_CODE"
else
  echo "✅ Test 7 PASSED"
fi
echo ""

# Test 8: GET /events (filter by id)
echo "8. Testing GET /events?id="
echo "--------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -G "$BASE_URL/events" --data-urlencode "id=$EVENT_ID" --data-urlencode "limit=1")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 8 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 8 PASSED"
  MATCH=$(echo "$BODY" | grep -o "\"id\":\"$EVENT_ID\"")
  if [ -z "$MATCH" ]; then
    echo "❌ Test 8 FAILED - Event not found in response"
  else
    echo "Event located: $EVENT_ID"
  fi
fi
echo ""

AUTO_EVENT_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Test 9: POST /events without providing id
echo "9. Testing POST /events without id"
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
  echo "❌ Test 9 FAILED - Expected 201 with generated id"
else
  echo "✅ Test 9 PASSED - Generated id: $AUTO_EVENT_ID"
fi
echo ""

# Test 10: GET /events?id=<generated id>
echo "10. Testing GET /events?id=auto-generated"
echo "----------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -G "$BASE_URL/events" --data-urlencode "id=$AUTO_EVENT_ID" --data-urlencode "limit=1")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 10 FAILED - Expected 200, got $HTTP_CODE"
else
  MATCH=$(echo "$BODY" | grep -o "\"id\":\"$AUTO_EVENT_ID\"")
  if [ -z "$MATCH" ]; then
    echo "❌ Test 10 FAILED - Auto-generated event not found"
  else
    echo "✅ Test 10 PASSED - Auto-generated event retrieved"
  fi
fi
echo ""

echo "========================================="
echo "Testing Complete!"
echo "========================================="

