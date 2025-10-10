#!/bin/bash

# Netlify Deployment Script for Run of Show Timer

echo "🚀 Starting Netlify deployment process..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building project for production..."
npm run build

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo "📁 Build output is in the 'dist' folder"
    echo "🌐 Ready for Netlify deployment"
else
    echo "❌ Build failed!"
    exit 1
fi

echo "🎉 Deployment preparation complete!"
echo ""
echo "Next steps:"
echo "1. Commit your changes to git"
echo "2. Push to your GitHub repository"
echo "3. Connect your repository to Netlify"
echo "4. Configure environment variables in Netlify dashboard"
echo "5. Deploy!"
