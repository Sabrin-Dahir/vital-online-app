require('./config/mongooseSetup');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const { isAllowedOrigin } = require('./config/cors');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const dietRoutes = require('./routes/dietRoutes');
const activityRoutes = require('./routes/activityRoutes');
const waterRoutes = require('./routes/waterRoutes');
const progressRoutes = require('./routes/progressRoutes');
const coachRoutes = require('./routes/coachRoutes');
const contentRoutes = require('./routes/contentRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

// Render / Heroku sit behind a proxy — needed for secure cookies & correct IPs
app.set('trust proxy', 1);

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/health', async (req, res) => {
  const {
    pingDatabase,
    scheduleConnectionRetry,
    isDatabaseConnected,
  } = require('./config/db');
  const databaseName = req.app.get('databaseName') || '';
  let dbReady = !!req.app.get('dbReady') || isDatabaseConnected();

  // Verify with a ping, but never mark DB offline on a slow ping alone —
  // Atlas on flaky DNS often exceeds ~1s and that was flipping the app to "degraded".
  if (dbReady) {
    try {
      const result = await Promise.race([
        pingDatabase().then((ok) => ({ done: true, ok: Boolean(ok) })),
        new Promise((resolve) => setTimeout(() => resolve({ done: false }), 2500)),
      ]);
      if (result.done) {
        dbReady = result.ok;
        if (!dbReady) {
          req.app.set('dbReady', false);
          scheduleConnectionRetry(req.app);
        } else {
          req.app.set('dbReady', true);
        }
      } else {
        // Timed out — trust mongoose readyState instead of forcing unavailable.
        dbReady = isDatabaseConnected() || !!req.app.get('dbReady');
      }
    } catch {
      dbReady = isDatabaseConnected();
      if (!dbReady) {
        req.app.set('dbReady', false);
        scheduleConnectionRetry(req.app);
      }
    }
  }

  const host = req.get('host') || `127.0.0.1:${process.env.PORT || 5050}`;
  const proto = req.protocol || 'http';

  // Always HTTP 200 so Render healthCheckPath (/api/health) does not restart the service.
  // Body fields still report DB readiness for clients/ops.
  res.status(200).json({
    status: 'ok',
    database: dbReady ? 'connected' : 'unavailable',
    databaseName: databaseName || undefined,
    api: `${proto}://${host}/api`,
    ...(dbReady
      ? {}
      : {
          hint:
            'MongoDB Atlas is unreachable. Under Atlas → Network Access, allow 0.0.0.0/0 (or your host IP), then wait for the API to reconnect.',
        }),
  });
});

app.use((req, res, next) => {
  if (req.path === '/api/health') {
    return next();
  }

  if (!req.app.get('dbReady')) {
    return res.status(503).json({
      message:
        'Database unavailable. Set MONGO_URI on the host and whitelist its IP in MongoDB Atlas Network Access (use 0.0.0.0/0 for Render/Heroku).',
    });
  }

  return next();
});

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/diet', dietRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/water', waterRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/coach', coachRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/share', require('./routes/shareRoutes'));

app.use((error, req, res, next) => {
  if (error?.message === 'Not allowed by CORS') {
    return res.status(403).json({ message: 'Not allowed by CORS' });
  }
  const { respondWithCaughtError } = require('./utils/httpErrors');
  return respondWithCaughtError(res, error, 'Something went wrong');
});

module.exports = app;
