#!/bin/bash

# Test script for n8n workflow ledger API
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

# Test 2: POST /jobs/:run_id/result
echo "2. Testing POST /jobs/:run_id/result"
echo "-----------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/jobs/$RUN_ID/result" \
  -H "Content-Type: application/json" \
  -d "{
    \"n8n_workflow_id\": \"$WORKFLOW_ID\",
    \"n8n_execution_id\": \"$EXECUTION_ID\",
    \"data\": {
      \"result\": \"success\",
      \"processed_items\": 42,
      \"duration_ms\": 1234
    }
  }")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "201" ]; then
  echo "❌ Test 2 FAILED - Expected 201, got $HTTP_CODE"
else
  echo "✅ Test 2 PASSED"
  R2_POINTER=$(echo "$BODY" | grep -o '"r2_pointer":"[^"]*"' | cut -d'"' -f4)
  echo "R2 Pointer: $R2_POINTER"
fi
echo ""

# Test 3: GET /runs/:run_id
echo "3. Testing GET /runs/:run_id"
echo "---------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/runs/$RUN_ID")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 3 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 3 PASSED"
  RUN_COUNT=$(echo "$BODY" | grep -o '"runs":\[.*\]' | grep -o '{' | wc -l | tr -d ' ')
  echo "Number of runs returned: $RUN_COUNT"
fi
echo ""

# Test 4: GET /runs/:run_id/latest
echo "4. Testing GET /runs/:run_id/latest"
echo "----------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/runs/$RUN_ID/latest")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 4 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 4 PASSED"
fi
echo ""

# Test 5: GET /executions/:n8n_execution_id
echo "5. Testing GET /executions/:n8n_execution_id"
echo "--------------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/executions/$EXECUTION_ID")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Test 5 FAILED - Expected 200, got $HTTP_CODE"
else
  echo "✅ Test 5 PASSED"
  EXEC_COUNT=$(echo "$BODY" | grep -o '"executions":\[.*\]' | grep -o '{' | wc -l | tr -d ' ')
  echo "Number of executions returned: $EXEC_COUNT"
fi
echo ""

# Test 6: Error handling - Invalid POST /jobs
echo "6. Testing Error Handling - Invalid POST /jobs"
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
  echo "❌ Test 6 FAILED - Expected 400, got $HTTP_CODE"
else
  echo "✅ Test 6 PASSED"
fi
echo ""

# Test 7: Error handling - Non-existent run_id
echo "7. Testing Error Handling - Non-existent run_id"
echo "------------------------------------------------"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/runs/non-existent-run-id/latest")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')
echo "Response: $BODY"
echo "HTTP Code: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" != "404" ]; then
  echo "❌ Test 7 FAILED - Expected 404, got $HTTP_CODE"
else
  echo "✅ Test 7 PASSED"
fi
echo ""

echo "========================================="
echo "Testing Complete!"
echo "========================================="

