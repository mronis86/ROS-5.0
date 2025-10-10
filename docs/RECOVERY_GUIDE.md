# 🛡️ Recovery Guide - ROS-5.0

## **Emergency Recovery Steps**

### **If You Lose Work:**

1. **Check Recent Backups:**
   ```bash
   git branch -a | grep backup
   ```

2. **Restore from Latest Backup:**
   ```bash
   git checkout backup-YYYYMMDD_HHMMSS
   git checkout -b recovery-branch
   git push origin recovery-branch
   ```

3. **Check Railway Deployment Status:**
   - Visit: https://ros-50-production.up.railway.app/health
   - If down, check Railway logs

### **Prevention Checklist:**

#### **Before Making Changes:**
- [ ] Run `safety-backup.bat` (Windows) or `safety-backup.sh` (Linux/Mac)
- [ ] Check current branch: `git branch`
- [ ] Verify Railway is working: `curl https://ros-50-production.up.railway.app/health`

#### **During Development:**
- [ ] Make small, focused commits
- [ ] Test each change before moving to next
- [ ] Keep debug logging minimal
- [ ] Don't force push to master

#### **After Changes:**
- [ ] Test locally first
- [ ] Test Railway deployment
- [ ] Create backup before pushing to master

### **Key Files to Never Break:**
- `src/pages/RunOfShowPage.tsx` - Main functionality
- `api-server.js` - Backend API
- `src/services/database.ts` - Database connections
- `src/contexts/AuthContext.tsx` - Authentication

### **Emergency Contacts:**
- Railway Dashboard: https://railway.app/dashboard
- GitHub Repository: https://github.com/mronis86/ROS-5.0
- Current Working Branch: `backup-working-state`

### **Quick Recovery Commands:**
```bash
# Restore from backup
git checkout backup-working-state

# Reset to last known good state
git reset --hard HEAD~1

# Check what changed
git log --oneline -10
```
