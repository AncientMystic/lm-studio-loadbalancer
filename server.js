const express = require('express');
const proxy = require('express-http-proxy');
const axios = require('axios');

// Load environment variables
require('dotenv').config();

const app = express();

// Configuration from environment variables with defaults
const config = {
  LM_STUDIO_URL: process.env.LM_STUDIO_URL || 'http://localhost:1234',
  LOAD_BALANCER_PORT: parseInt(process.env.LOAD_BALANCER_PORT) || 4321,
  MODEL_REFRESH_INTERVAL: parseInt(process.env.MODEL_REFRESH_INTERVAL) || 30000,
  REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 300000,
  MAX_PAYLOAD_SIZE: process.env.MAX_PAYLOAD_SIZE || '50mb',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ENABLE_REQUEST_LOGGING: process.env.ENABLE_REQUEST_LOGGING === 'true'
};

// Logging utility
const logger = {
  error: (message, ...args) => console.error(`[ERROR] ${new Date().toISOString()}: ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[WARN] ${new Date().toISOString()}: ${message}`, ...args),
  info: (message, ...args) => {
    if (config.LOG_LEVEL === 'info' || config.LOG_LEVEL === 'debug') {
      console.info(`[INFO] ${new Date().toISOString()}: ${message}`, ...args);
    }
  },
  debug: (message, ...args) => {
    if (config.LOG_LEVEL === 'debug') {
      console.debug(`[DEBUG] ${new Date().toISOString()}: ${message}`, ...args);
    }
  }
};

// Configure Express to handle large payloads
app.use(express.json({ limit: config.MAX_PAYLOAD_SIZE }));
app.use(express.urlencoded({ extended: true, limit: config.MAX_PAYLOAD_SIZE }));

// Increase payload size limit for raw body parser
app.use(express.raw({ limit: config.MAX_PAYLOAD_SIZE, type: 'application/json' }));
app.use(express.raw({ limit: config.MAX_PAYLOAD_SIZE, type: 'text/plain' }));

// State management
let availableModels = [];
let inProgressModels = []; // Array to track multiple requests per model
let modelIndex = 0;

/**
 * Loads available models from LM Studio API
 * @returns {Promise<Array>} Array of loaded models
 */
async function loadModels() {
  try {
    const response = await axios.get(`${config.LM_STUDIO_URL}/api/v0/models`, {
      timeout: config.REQUEST_TIMEOUT
    });
    
    const previousCount = availableModels.length;
    availableModels = response.data.data.filter(model => model.state === 'loaded');
    
    if (availableModels.length !== previousCount) {
      logger.info(`Loaded models: [${availableModels.map(m => m.id).join(', ')}]`);
      logger.info(`Total loaded models: ${availableModels.length}`);
    }
    
    return availableModels;
  } catch (error) {
    logger.error('Failed to load models from LM Studio:', error.message);
    if (error.code === 'ECONNREFUSED') {
      logger.error('LM Studio is not running or not accessible');
    }
    availableModels = []; // Set to empty array instead of exiting
    return [];
  }
}

/**
 * Starts the periodic model update process
 */
function startModelUpdater() {
  logger.debug(`Starting model updater with ${config.MODEL_REFRESH_INTERVAL}ms interval`);
  
  setInterval(async () => {
    logger.debug('Updating model list...');
    await loadModels();

    // Clean up inProgressModels that are no longer available
    const availableModelIds = new Set(availableModels.map(m => m.id));
    const initialLength = inProgressModels.length;
    
    inProgressModels = inProgressModels.filter(modelId => {
      if (!availableModelIds.has(modelId)) {
        logger.warn(`Cleaned up unavailable model: ${modelId}`);
        return false;
      }
      return true;
    });

    if (inProgressModels.length < initialLength) {
      logger.info(`Cleaned up ${initialLength - inProgressModels.length} unavailable models`);
    }

    logger.debug(`Model update completed. Available models: ${availableModels.length}`);
  }, config.MODEL_REFRESH_INTERVAL);
}

/**
 * Selects the best available model based on current load
 * @returns {Object} Selected model object
 * @throws {Error} If no models are available
 */
function selectModel() {
  if (availableModels.length === 0) {
    throw new Error('No models available');
  }

  // Count in-progress requests for each model
  const modelRequestCounts = {};
  inProgressModels.forEach(modelId => {
    modelRequestCounts[modelId] = (modelRequestCounts[modelId] || 0) + 1;
  });

  // Find model with least in-progress requests
  let selectedModel = null;
  let minRequests = Infinity;

  for (const model of availableModels) {
    const requestCount = modelRequestCounts[model.id] || 0;
    if (requestCount < minRequests) {
      minRequests = requestCount;
      selectedModel = model;
    }
  }

  logger.debug(`Selected model ${selectedModel.id} with ${minRequests} in-progress requests`);
  return selectedModel;
}

/**
 * Modifies request body to replace model with load-balanced selection
 * @param {string|Object} bodyContent - Request body content
 * @param {Object} srcReq - Source request object
 * @returns {string} Modified request body as JSON string
 */
function modifyRequestBody(bodyContent, srcReq) {
  if (!bodyContent || bodyContent.length === 0) return bodyContent;

  try {
    let body;

    // Check if bodyContent is already a parsed object
    if (typeof bodyContent === 'object' && bodyContent !== null) {
      body = bodyContent;
    } else {
      // If it's a string or Buffer, parse it as JSON
      const bodyString = bodyContent.toString();
      body = JSON.parse(bodyString);
    }

    if (availableModels.length > 0 && body.model) {
      const selectedModel = selectModel();
      const originalModel = body.model;

      // Store the selected model in the request object for later cleanup
      srcReq.selectedModel = selectedModel.id;

      // Mark model as in progress
      inProgressModels.push(selectedModel.id);

      // Replace model in request body
      body.model = selectedModel.id;
      
      logger.info(`Selected model: ${selectedModel.id} (replaced from ${originalModel})`);
      logger.debug(`In-progress models: [${inProgressModels.join(', ')}]`);

      // Return the modified body as JSON string
      return JSON.stringify(body);
    }

    // If no model replacement needed, return original body
    if (typeof bodyContent === 'object' && bodyContent !== null) {
      return JSON.stringify(bodyContent);
    } else {
      return bodyContent.toString();
    }
  } catch (error) {
    logger.error('Error processing request body:', error.message);
    logger.debug('Body content type:', typeof bodyContent);
    logger.debug('Body content:', bodyContent);

    // Return original body if there's an error
    if (typeof bodyContent === 'object' && bodyContent !== null) {
      return JSON.stringify(bodyContent);
    } else {
      return bodyContent.toString();
    }
  }
}



// Health check endpoint
app.get('/health', (req, res) => {
  try {
    res.json({
      status: 'healthy',
      availableModels: availableModels.map(m => m.id),
      inProgressModels: Array.from(inProgressModels),
      totalRequests: modelIndex,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    logger.error('Health check error:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Model status endpoint
app.get('/models', (req, res) => {
  try {
    // Count in-progress requests for each model
    const modelRequestCounts = {};
    inProgressModels.forEach(modelId => {
      modelRequestCounts[modelId] = (modelRequestCounts[modelId] || 0) + 1;
    });

    res.json({
      availableModels: availableModels.map(m => m.id),
      inProgressModels: inProgressModels,
      freeModels: availableModels.filter(m => !modelRequestCounts[m.id]).map(m => m.id),
      modelLoad: modelRequestCounts
    });
  } catch (error) {
    logger.error('Models endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to get model status', message: error.message });
  }
});

/**
 * Middleware to handle streaming responses and cleanup
 */
app.use((req, res, next) => {
  let cleanupDone = false;

  // Set up cleanup function that only runs once
  const cleanup = () => {
    const modelToRelease = req.selectedModel;
    if (modelToRelease && !cleanupDone) {
      cleanupDone = true;
      const index = inProgressModels.indexOf(modelToRelease);
      if (index > -1) {
        inProgressModels.splice(index, 1);
        logger.debug(`Released model: ${modelToRelease}`);
        logger.debug(`In-progress models: [${inProgressModels.join(', ')}]`);
      }
    }
  };

  // Listen for various events that indicate the response is complete
  res.on('close', () => {
    if (config.ENABLE_REQUEST_LOGGING) {
      logger.debug(`Client connection closed for request: ${req.url}`);
    }
    cleanup();
  });

  res.on('finish', () => {
    if (config.ENABLE_REQUEST_LOGGING) {
      logger.debug(`Stream finished for request: ${req.url}`);
    }
    cleanup();
  });

  res.on('error', (error) => {
    logger.error(`Stream error for request: ${req.url}:`, error.message);
    cleanup();
  });

  // Override res.end as a fallback (in case the above events don't fire)
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    cleanup();
    originalEnd.call(this, chunk, encoding);
  };

  // Set streaming headers for all responses
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  next();
});

// Proxy configuration
app.use(proxy(config.LM_STUDIO_URL, {
  proxyReqBodyDecorator: (bodyContent, srcReq) => {
    const modifiedBody = modifyRequestBody(bodyContent, srcReq);
    if (config.ENABLE_REQUEST_LOGGING) {
      logger.info(`Request URL: ${srcReq.url}`);
    }
    return modifiedBody;
  },
  proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
    // Preserve headers for streaming
    proxyReqOpts.headers['Accept'] = 'text/event-stream';
    proxyReqOpts.headers['Cache-Control'] = 'no-cache';
    proxyReqOpts.headers['Connection'] = 'keep-alive';

    // Remove Content-Length header to let proxy calculate it automatically
    delete proxyReqOpts.headers['content-length'];

    // Set timeout for large requests
    proxyReqOpts.timeout = config.REQUEST_TIMEOUT;

    return proxyReqOpts;
  },

  // Add error handling for large payloads
  proxyErrorHandler: (err, res, next) => {
    logger.error('Proxy error:', err.message);
    
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      res.status(504).json({ 
        error: 'Gateway timeout - request too large or took too long',
        code: err.code 
      });
    } else if (err.message.includes('PayloadTooLargeError')) {
      res.status(413).json({ 
        error: 'Request entity too large',
        code: 'PAYLOAD_TOO_LARGE'
      });
    } else {
      res.status(500).json({ 
        error: 'Proxy error', 
        message: err.message,
        code: err.code || 'UNKNOWN_ERROR'
      });
    }
  }
}));

/**
 * Starts the load balancer server
 */
async function startServer() {
  try {
    await loadModels();

    if (availableModels.length === 0) {
      logger.warn('No models currently loaded in LM Studio. Server will start and continue checking for models.');
    }

    app.listen(config.LOAD_BALANCER_PORT, () => {
      logger.info(`Load balancer server running on port ${config.LOAD_BALANCER_PORT}`);
      logger.info(`Proxying requests to LM Studio at ${config.LM_STUDIO_URL}`);

      if (availableModels.length > 0) {
        logger.info(`Available models: [${availableModels.map(m => m.id).join(', ')}]`);
      } else {
        logger.info('No models currently available. Models will be detected automatically when loaded.');
      }

      // Start periodic model updates
      startModelUpdater();
      logger.info(`Model updater started - checking for new models every ${config.MODEL_REFRESH_INTERVAL}ms`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Start the server
startServer();
