#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting Build Process..."

# Create output directory
rm -rf public
mkdir -p public

# Check if Env Vars are present
if [ -z "$API_KEY" ]; then
    echo "⚠️  No API_KEY environment variable found. Using default keys (Local Mode)."
    cp index.html public/index.html
else
    echo "🔒 Injecting Environment Variables..."
    
    # Use piping to be compatible with both Mac (BSD) and Linux (GNU) sed without -i flag issues
    # We read index.html, pipe through 3 sed replacements, and write to public/index.html
    
    cat index.html | \
    sed "s|API_KEY: '.*'|API_KEY: '$API_KEY'|g" | \
    sed "s|API_SECRET: '.*'|API_SECRET: '$API_SECRET'|g" | \
    sed "s|TELEGRAM_TOKEN: '.*'|TELEGRAM_TOKEN: '$TELEGRAM_TOKEN'|g" \
    > public/index.html
    
    echo "✅ Keys injected successfully."
fi

echo "🎉 Build Complete! Output in public/index.html"
