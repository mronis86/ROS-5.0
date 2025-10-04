#!/bin/bash
# Safety Backup Script for ROS-5.0
# Run this before making major changes

echo "🛡️ Creating safety backup..."

# Create timestamped backup branch
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_BRANCH="backup-$(date +"%Y%m%d_%H%M%S")"

# Create and push backup branch
git checkout -b "$BACKUP_BRANCH"
git push origin "$BACKUP_BRANCH"

echo "✅ Safety backup created: $BACKUP_BRANCH"
echo "📍 Current working state saved to: https://github.com/mronis86/ROS-5.0/tree/$BACKUP_BRANCH"

# Return to master
git checkout master

echo "🔄 Returned to master branch"
echo "💡 To restore this backup later: git checkout $BACKUP_BRANCH"
