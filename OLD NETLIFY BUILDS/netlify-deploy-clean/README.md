# Run of Show Timer - Netlify Deployment

This is a clean Netlify deployment version of the Run of Show Timer application.

## Features

- ✅ **Event Management** - Create and manage live events
- ✅ **Run of Show** - Detailed event scheduling and timing
- ✅ **Real-time Timers** - Live countdown and elapsed time tracking
- ✅ **Display Modes** - Fullscreen timer and clock displays
- ✅ **Graphics Integration** - Lower thirds and schedule XML generation
- ✅ **Reports & Printing** - Event reports and documentation
- ✅ **Green Room** - Speaker management and preparation
- ✅ **Photo View** - Event photography coordination
- ✅ **OSC Control** - External control integration
- ✅ **Backup System** - Data backup and restore functionality

## Deployment

### Netlify Deploy Button
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/your-repo/run-of-show-timer)

### Manual Deployment
1. Build the project: `npm run build`
2. Deploy the `dist` folder to Netlify
3. Configure environment variables (see below)

## Environment Variables

Configure these in Netlify's environment settings:

### Database Configuration
```
VITE_DATABASE_URL=your_database_url
VITE_DATABASE_API_KEY=your_api_key
```

### Authentication (Optional)
```
VITE_AUTH_ENABLED=true
VITE_AUTH_PROVIDER=neon
```

### WebSocket Configuration
```
VITE_WS_URL=wss://your-websocket-url
```

## Build Commands

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
src/
├── components/          # Reusable UI components
├── contexts/           # React context providers
├── pages/             # Main application pages
├── services/          # API and service integrations
└── types/             # TypeScript type definitions
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

MIT License - see LICENSE file for details.
