# Railway.app Deployment Guide

## Overview
This guide explains how to deploy the Python web service from the `./api` subfolder to Railway.app.

## Prerequisites
- A Railway.app account (sign up at https://railway.app)
- Railway CLI (optional but recommended): `npm install -g @railway/cli`
- Git repository with your code

## Configuration Files Created

The following files have been created in the root directory to configure Railway deployment:

### 1. `railway.toml` (Primary Configuration)
Configures Railway to:
- Start the Flask app from the `api/` subdirectory
- Set up health checks
- Configure restart policy

### 2. `nixpacks.toml` (Build Configuration)
Tells Railway's Nixpacks builder:
- Which Python version to use (Python 3.9)
- Where to find requirements.txt (`api/requirements.txt`)
- How to start the application

### 3. `Procfile` (Alternative Start Command)
Backup configuration that defines the web process.

### 4. `.railwayignore`
Excludes unnecessary files from deployment (similar to `.gitignore`):
- Frontend code (`web/`)
- Test files
- Development environment
- Documentation files

## Deployment Steps

### Option 1: Deploy via Railway Web UI (Easiest)

1. **Push your code to GitHub/GitLab**
   ```bash
   git add railway.toml nixpacks.toml Procfile .railwayignore RAILWAY_DEPLOYMENT.md
   git commit -m "Add Railway deployment configuration"
   git push origin main
   ```

2. **Create a new project on Railway**
   - Go to https://railway.app/new
   - Click "Deploy from GitHub repo"
   - Select your repository
   - Railway will automatically detect the configuration

3. **Set Environment Variables**
   In the Railway dashboard, add these environment variables:
   - `FLASK_ENV` = `production`
   - `PORT` = (Railway will set this automatically, don't override)

4. **Deploy!**
   - Railway will automatically build and deploy
   - You'll get a URL like `https://your-app.railway.app`

### Option 2: Deploy via Railway CLI

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway**
   ```bash
   railway login
   ```

3. **Initialize and link project**
   ```bash
   railway init
   railway link
   ```

4. **Deploy**
   ```bash
   railway up
   ```

5. **Set environment variables**
   ```bash
   railway variables set FLASK_ENV=production
   ```

6. **Open your app**
   ```bash
   railway open
   ```

## Important Notes

### Port Configuration
- The `web_advisor.py` file is already configured to use the `PORT` environment variable
- Railway automatically assigns a PORT (usually 8080 or dynamic)
- Default fallback is port 5000 if PORT is not set

### Required Data Files
Your deployment needs these files (they're included by default):
- `data/database.json` - Hero/skill mappings (REQUIRED)
- `data/battles/*.json` - Battle history files for AI training
- `image_extraction/extraction_config.json` - AI configuration (REQUIRED)

### File Structure in Deployment
```
/ (root - Railway runs from here)
├── api/
│   ├── web_advisor.py (main Flask app)
│   ├── ai_recommendation_system.py
│   └── requirements.txt
├── data/
│   ├── database.json
│   └── battles/
│       └── *.json files
├── image_extraction/
│   └── extraction_config.json
├── railway.toml
├── nixpacks.toml
└── Procfile
```

## Testing the Deployment

Once deployed, test your API endpoints:

### Health Check
```bash
curl https://your-app.railway.app/api/get_database_items
```

### Get Recommendation
```bash
curl -X POST https://your-app.railway.app/api/get_recommendation \
  -H "Content-Type: application/json" \
  -d '{
    "round_type": "hero",
    "available_sets": [["英雄A", "英雄B"], ["英雄C", "英雄D"]],
    "game_state": {
      "current_heroes": ["英雄E"],
      "current_skills": [],
      "round_number": 1
    }
  }'
```

### Get Analytics
```bash
curl https://your-app.railway.app/api/get_analytics
```

## Troubleshooting

### Build Fails
- Check Railway logs in the dashboard
- Verify `api/requirements.txt` has all dependencies
- Ensure Python 3.9+ compatible

### App Crashes on Start
- Check that `data/database.json` exists
- Check that `image_extraction/extraction_config.json` exists
- Verify battle data exists in `data/battles/`

### 502 Bad Gateway
- App might be crashing - check Railway logs
- Verify the PORT environment variable is being used correctly

### CORS Issues
- The API already has CORS enabled for `/api/*` routes
- If you need to restrict origins, update the CORS config in `api/web_advisor.py`

## Monitoring

### View Logs
```bash
railway logs
```

Or view in the Railway dashboard under "Deployments" → "Logs"

### Check Metrics
Railway dashboard shows:
- CPU usage
- Memory usage
- Network traffic
- Request rate

## Scaling & Performance

Railway's free tier includes:
- 500 hours of usage per month
- $5 free credit
- Auto-scaling based on traffic

For production use, consider:
- Upgrading to a paid plan for better performance
- Adding monitoring/alerting
- Setting up a custom domain

## Frontend Deployment (Optional)

The React frontend (`web/`) is excluded from this deployment. To serve it:

1. **Option A**: Deploy frontend separately to Vercel/Netlify
   - Update API URL in `web/src/services/api.js` to your Railway URL

2. **Option B**: Serve from the same Flask app
   - Build the React app: `cd web && npm run build`
   - Serve static files from Flask
   - Remove `web/` from `.railwayignore`

## Cost Estimates

Railway pricing (as of 2024):
- **Free Tier**: $5 credit/month, 500 execution hours
- **Pro Plan**: $20/month + usage
- Typically, a simple Flask API costs ~$1-5/month on the Pro plan

## Additional Resources

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Nixpacks Docs: https://nixpacks.com
- Flask Deployment: https://flask.palletsprojects.com/en/latest/deploying/

## Support

If you encounter issues:
1. Check Railway logs first
2. Review this guide's troubleshooting section
3. Check Railway status page: https://status.railway.app
4. Ask in Railway Discord community
