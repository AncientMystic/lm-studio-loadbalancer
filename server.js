// ---- 1.  Imports & config ----------------------------------------------------
const express = require('express');
const proxy   = require('express-http-proxy');
const axios   = require('axios');

require('dotenv').config();

const app = express();

// Environment variables (typos kept for backward‑compatibility)
const config = {
  LM_STUDIO_URL: process.env.LM_STUDIO_URL || 'http://localhost:1234',
  LOAD_BALANCER_PORT: parseInt(process.env.LOAD_BALANCER_PORT) || 4321,
  MODEL_REFRESH_INTERVAL: parseInt(process.env.MODEL_REFRESH_INTERVAL) || 30000,
  REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 300000,
  MAX_PAYLOAD_SIZE: process.env.MAX_PAYLOAD_SIZE || '50mb',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ENABLE_REQUEST_LOGGING: process.env.ENABLE_REQUEST_LOGGING === 'true'
};

// ---- 2. Logging ------------------------------------------------------------
const logger = {
  error: (msg, ...a) => console.error(`[ERROR] ${new Date().toISOString()}: ${msg}`, ...a),
  warn:  (msg, ...a) => console.warn(`[WARN ] ${new Date().toISOString()}: ${msg}`, ...a),
  info:  (msg, ...a) => {
    if (config.LOG_LEVEL === 'info' || config.LOG_LEVEL === 'debug') {
      console.info(`[INFO ] ${new Date().toISOString()}: ${msg}`, ...a);
    }
  },
  debug: (msg, ...a) => {
    if (config.LOG_LEVEL === 'debug') {
      console.debug(`[DEBUG] ${new Date().toISOString()}: ${msg}`, ...a);
    }
  }
};

// ---- 3. Express payload limits -----------------------------------------
app.use(express.json({ limit: config.MAX_PAYLOAD_SIZE }));
app.use(express.urlencoded({ extended: true, limit: config.MAX_PAYLOAD_SIZE }));
app.use(express.raw({ limit: config.MAX_PAYLOAD_SIZE, type: 'application/json' }));
app.use(express.raw({ limit: config.MAX_PAYLOAD_SIZE, type: 'text/plain' }));

// ---- 4. State -------------------------------------------------------------
let availableModels = [];          // only embedding models
let inProgressModels = [];   // ids of models currently busy
let modelIndex = 0;           // for round‑robin
let requestQueue = [];      // queued requests while we are still bootstrapping

// ---- 5. Load the list of loaded models ---------------------------------
/**
 * Loads available (embedding) models from LM Studio API.
 * @returns {Promise<Array>}
 */
async function loadModels() {
  try {
    const response = await axios.get(`${config.LM_STUDIO_URL}/api/v0/models`, {
      timeout: config.REQUEST_TIMEOUT
    });

    // Keep only loaded embedding models – the id must contain 'text-embedding'
    availableModels = response.data.data.filter(
      m => m.state === 'loaded' && /text-embedding/.test(m.id)
    );

    logger.info(`Loaded embedding models: [${availableModels.map(m => m.id).join(', ')}]`);
    logger.debug(`Total loaded embedding models: ${availableModels.length}`);

    return availableModels;
  } catch (err) {
    logger.error('Failed to load models from LM Studio:', err.message);
    if (err.code === 'ECONNREFUSED') {
      logger.error('LM Studio is not running or not accessible');
    }
    availableModels = [];
    return [];
  }
}

// ---- 6. Periodic refresh -------------------------------------------------
function startModelUpdater() {
  logger.debug(`Starting model updater with ${config.MODEL_REFRESH_INTERVAL}ms interval`);
  setInterval(async () => {
    logger.debug('Refreshing model list...');
    await loadModels();

    // Remove stale in‑progress entries
    const availIds = new Set(availableModels.map(m => m.id));
    const oldLen   = inProgressModels.length;
    inProgressModels = inProgressModels.filter(id => {
      if (!availIds.has(id)) {
        logger.warn(`Removed unavailable model from queue: ${id}`);
        return false;
      }
      return true;
    });

    if (inProgressModels.length < oldLen) {
      logger.info(`Cleaned up ${oldLen - inProgressModels.length} unavailable models`);
    }

    // If we have requests queued while we had no embedding models, try to dispatch them now
    processRequestQueue();
  }, config.MODEL_REFRESH_INTERVAL);
}

// ---- 7. Model selection --------------------------------------------------
/**
 * Pick the least‑used embedding model.
 */
function selectModel() {
  if (!availableModels.length) throw new Error('No embedding models available');

  // Count in‑progress per id
  const counts = {};
  inProgressModels.forEach(id => { counts[id] = (counts[id] || 0) + 1; });

  let best   = null;
  let minReq = Infinity;

  for (const m of availableModels) {
    const c = counts[m.id] ?? 0;
    if (c < minReq) { minReq = c; best = m; }
  }

  // If a tie – rotate round‑robin
  const ties = availableModels.filter(m => (counts[m.id] ?? 0) === minReq);
  if (ties.length > 1) {
    best = ties[(modelIndex++) % ties.length];
  }

  logger.debug(`Selected model ${best.id} (in‑progress: ${minReq})`);
  return best;
}

// ---- 8. Modify request body ----------------------------------------------
/**
 * Replace the model id in the request body with a load‑balanced one.
 */
function modifyRequestBody(bodyContent, srcReq) {
  if (!bodyContent || bodyContent.length === 0) return bodyContent;

  try {
    let body;
    if (typeof bodyContent === 'object' && bodyContent !== null) {
      body = bodyContent;              // already parsed
    } else {
      const s = bodyContent.toString();
      body = JSON.parse(s);
    }

    if (body.model && availableModels.length > 0) {
      const chosen = selectModel();

      srcReq.selectedModel = chosen.id;
      inProgressModels.push(chosen.id);

      // Replace the model
      const orig = body.model;
      body.model = chosen.id;

      logger.info(`Replaced model ${orig} → ${chosen.id}`);
      return JSON.stringify(body);
    }

    // No replacement – just return whatever we had
    if (typeof bodyContent === 'object' && bodyContent !== null) {
      return JSON.stringify(bodyContent);
    }
    return bodyContent.toString();
  } catch (err) {
    logger.error('Body‑parse error:', err.message);
    return typeof bodyContent === 'object' ? JSON.stringify(bodyContent) : bodyContent.toString();
  }
}

// ---- 9. Process queued requests ------------------------------------------
function processRequestQueue() {
  while (requestQueue.length > 0 && availableModels.length > 0) {
    const req = requestQueue.shift();
    try {
      const chosen = selectModel();

      inProgressModels.push(chosen.id);
      req.selectedModel = chosen.id;

      proxy(config.LM_STUDIO_URL, {
        proxyReqBodyDecorator: (body, src) => {
          const mod = modifyRequestBody(body, src);
          if (config.ENABLE_REQUEST_LOGGING) logger.info(`Proxying ${src.url}`);
          return mod;
        },
        proxyReqOptDecorator: (opts, src) => {
          opts.headers['Accept']            = 'text/event-stream';
          opts.headers['Cache-Control']     = 'no-cache';
          opts.headers['Connection']        = 'keep-alive';
          delete opts.headers['content-length'];
          opts.timeout = config.REQUEST_TIMEOUT;
          return opts;
        }
      })(req, {}, (err) => {
        if (err) logger.error('Proxy error:', err.message);
        const rel = req.selectedModel;
        inProgressModels.splice(inProgressModels.indexOf(rel), 1);
      });
    } catch (e) {
      logger.error('Failed to dispatch queued request:', e.message);
      // Re‑queue it
      requestQueue.unshift(req);
    }
  }
}

// ---- 10. Health & status endpoints --------------------------------------
app.get('/health', (req, res) => {
  try {
    res.json({
      status: 'healthy',
      availableModels: availableModels.map(m => m.id),
      inProgressModels,
      totalRequests: modelIndex,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (e) { logger.error('Health check failed:', e.message); res.status(500).json({ status:'error', message:e.message }); }
});

app.get('/models', (req, res) => {
  try {
    const counts = {};
    inProgressModels.forEach(id => { counts[id] = (counts[id] ?? 0) + 1; });

    res.json({
      availableModels: availableModels.map(m => m.id),
      inProgressModels,
      freeModels: availableModels.filter(m => !counts[m.id]).map(m => m.id),
      modelLoad: counts
    });
  } catch (e) { logger.error('Model status failed:', e.message); res.status(500).json({ error:'Failed to get model status', message:e.message }); }
});

// ---- 11. Stream cleanup middleware ---------------------------------------
app.use((req, res, next) => {
  let done = false;
  const cleanup = () => {
    if (!done && req.selectedModel) {
      done = true;
      const idx = inProgressModels.indexOf(req.selectedModel);
      if (idx > -1) {
        inProgressModels.splice(idx, 1);
        logger.debug(`Released model: ${req.selectedModel}`);
        logger.debug(`In‑progress now: [${inProgressModels.join(', ')}]`);
      }
    }
  };

  res.on('close', () => { if (config.ENABLE_REQUEST_LOGGING) logger.debug(`Client closed: ${req.url}`); cleanup(); });
  res.on('finish', () => { if (config.ENABLE_REQUEST_LOGGING) logger.debug(`Response finished: ${req.url}`); cleanup(); });
  res.on('error', e => { logger.error(`Stream error on ${req.url}:`, e.message); cleanup(); });

  const origEnd = res.end;
  res.end = function(chunk, enc) { cleanup(); origEnd.call(this, chunk, enc); };

  // common headers
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  next();
});

// ---- 12. Main proxy -------------------------------------------------------
app.use(proxy(config.LM_STUDIO_URL, {
  proxyReqBodyDecorator: (body, src) => {
    const mod = modifyRequestBody(body, src);
    if (config.ENABLE_REQUEST_LOGGING) logger.info(`Proxying ${src.url}`);
    return mod;
  },
  proxyReqOptDecorator: (opts, src) => {
    opts.headers['Accept']            = 'text/event-stream';
    opts.headers['Cache-Control']     = 'no-cache';
    opts.headers['Connection']        = 'keep-alive';
    delete opts.headers['content-length'];
    opts.timeout = config.REQUEST_TIMEOUT;
    return opts;
  },
  proxyErrorHandler: (err, res, next) => {
    logger.error('Proxy error:', err.message);
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      res.status(504).json({ error:'Gateway timeout', code: err.code });
    } else if (err.message.includes('PayloadTooLargeError')) {
      res.status(413).json({ error:'Request entity too large', code:'PAYLOAD_TOO_LARGE' });
    } else {
      res.status(500).json({ error:'Proxy error', message: err.message, code: err.code || 'UNKNOWN_ERROR' });
    }
  }
}));

// ---- 13. Server startup -------------------------------------------------
async function startServer() {
  try {
    await loadModels();
    if (!availableModels.length) logger.warn('No embedding models loaded – server will start and keep polling');

    app.listen(config.LOAD_BALANCER_PORT, () => {
      logger.info(`Load‑balancer listening on ${config.LOAD_BALANCER_PORT}`);
      logger.info(`Proxying to LM Studio at ${config.LM_STUDIO_URL}`);

      if (availableModels.length) {
        logger.info(`Embedding models: [${availableModels.map(m=>m.id).join(', ')}]`);
      }

      startModelUpdater();
      logger.info(`Started model updater – refresh every ${config.MODEL_REFRESH_INTERVAL} ms`);
    });
  } catch (e) { logger.error('Failed to start server:', e.message); process.exit(1); }
}

// ---- 14. Graceful shutdown --------------------------------------------
process.on('SIGTERM', () => { logger.info('SIGTERM received – shutting down'); process.exit(0); });
process.on('SIGINT',  () => { logger.info('SIGINT received – shutting down'); process.exit(0); });

// ---- 15. Kick‑off --------------------------------------------------------
startServer();
