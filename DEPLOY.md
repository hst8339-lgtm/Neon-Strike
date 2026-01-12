# Deploy NEON STRIKE Server to Render

## Quick Start

### 1. Prepare Your Repository

Copy the `render-server` folder to a new GitHub repository, or push your entire project and configure Render to use this folder.

### 2. Create Render Account

1. Go to [render.com](https://render.com) and sign up for free
2. Connect your GitHub account

### 3. Create a New Web Service

1. Click "New" → "Web Service"
2. Connect your repository
3. Configure the service:
   - **Name**: `neon-strike-server` (or any name you prefer)
   - **Region**: Choose closest to your players
   - **Root Directory**: `render-server` (if using the main repo)
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (to start)

4. Click "Create Web Service"

### 4. Get Your Server URL

After deployment completes, Render provides a URL like:
```
https://neon-strike-server.onrender.com
```

### 5. Update Your Game Client

In your Replit project, update the WebSocket connection to use your Render server:

Find the WebSocket connection code and change:
```javascript
// From local:
const ws = new WebSocket('ws://localhost:5001/ws');

// To Render (use wss:// for secure connection):
const ws = new WebSocket('wss://neon-strike-server.onrender.com/ws');
```

Or set an environment variable `VITE_WS_SERVER_URL` and use:
```javascript
const ws = new WebSocket(import.meta.env.VITE_WS_SERVER_URL || 'ws://localhost:5001/ws');
```

**Important**: The WebSocket endpoint is `/ws` - make sure to include this path!

## Notes

- **Free Tier**: Render's free tier spins down after 15 minutes of inactivity. First connection after idle may take 30-60 seconds.
- **Paid Tier**: For production games, upgrade to a paid instance ($7/month) for always-on service.
- **Health Check**: The server includes a `/health` endpoint that Render uses to verify the service is running.

## Local Testing

Before deploying, you can test the standalone server locally:

```bash
cd render-server
npm install
npm run dev
```

Then connect to `ws://localhost:10000/ws`
