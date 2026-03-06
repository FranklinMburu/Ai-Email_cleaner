#!/bin/bash
# Quick verification script to test the implementation

set -e

echo "🔍 Gmail Cleanup Tool - Implementation Verification"
echo "=================================================="
echo ""

# Check backend structure
echo "📦 Backend Files..."
BACKEND_FILES=(
  "backend/src/database.js"
  "backend/src/encryption.js"
  "backend/src/oauth.js"
  "backend/src/sync.js"
  "backend/src/categorize.js"
  "backend/src/operations.js"
  "backend/src/routes.js"
  "backend/src/server.js"
  "backend/package.json"
  "backend/.env.example"
  "backend/tests/categorize.test.js"
  "backend/tests/operations.test.js"
  "backend/tests/smoke.js"
)

for file in "${BACKEND_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file (missing)"
    exit 1
  fi
done

echo ""

# Check frontend structure
echo "🎨 Frontend Files..."
FRONTEND_FILES=(
  "frontend/src/components/Dashboard.js"
  "frontend/src/components/Dashboard.css"
  "frontend/src/services/api.js"
  "frontend/src/App.js"
  "frontend/src/index.js"
  "frontend/public/index.html"
  "frontend/package.json"
)

for file in "${FRONTEND_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file (missing)"
    exit 1
  fi
done

echo ""

# Check documentation
echo "📚 Documentation..."
DOC_FILES=(
  "README.md"
  "IMPLEMENTATION.md"
  "docs/design/gmail-inbox-cleanup.md"
  ".gitignore"
)

for file in "${DOC_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file (missing)"
    exit 1
  fi
done

echo ""
echo "=================================================="
echo "✅ All files present!"
echo ""
echo "Next Steps:"
echo "1. Install dependencies:"
echo "   cd backend && npm install"
echo "   cd ../frontend && npm install"
echo ""
echo "2. Configure secrets (.env):"
echo "   cd backend && cp .env.example .env"
echo "   # Add Google OAuth credentials and generate encryption key"
echo ""
echo "3. Run tests:"
echo "   cd backend && npm test"
echo "   node tests/smoke.js"
echo ""
echo "4. Start development:"
echo "   # Terminal 1: cd backend && npm run dev"
echo "   # Terminal 2: cd frontend && REACT_APP_API_URL=http://localhost:3001 npm start"
echo ""
