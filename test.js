const axios = require('axios');

// Configuration
const config = {
  LOAD_BALANCER_URL: process.env.LOAD_BALANCER_URL || 'http://localhost:4321',
  LM_STUDIO_URL: process.env.LM_STUDIO_URL || 'http://localhost:1234',
  TEST_TIMEOUT: parseInt(process.env.TEST_TIMEOUT) || 30000
};

// Test utilities
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

/**
 * Test suite for LM Studio Load Balancer
 */
class LoadBalancerTestSuite {
  constructor() {
    this.testResults = [];
    this.loadBalancerUrl = config.LOAD_BALANCER_URL;
    this.lmStudioUrl = config.LM_STUDIO_URL;
  }

  /**
   * Runs a single test and records the result
   */
  async runTest(testName, testFunction) {
    try {
      log(`\n🧪 Running ${testName}...`);
      const result = await testFunction();
      this.testResults.push({ name: testName, status: 'passed', result });
      logSuccess(`${testName} passed`);
      return result;
    } catch (error) {
      this.testResults.push({ name: testName, status: 'failed', error: error.message });
      logError(`${testName} failed: ${error.message}`);
      if (error.response) {
        log(`   Status: ${error.response.status} ${error.response.statusText}`, colors.yellow);
        if (error.response.data) {
          log(`   Details: ${JSON.stringify(error.response.data, null, 2)}`, colors.yellow);
        }
      }
      throw error;
    }
  }

  /**
   * Test health check endpoint
   */
  async testHealthCheck() {
    const response = await axios.get(`${this.loadBalancerUrl}/health`, {
      timeout: config.TEST_TIMEOUT
    });

    const data = response.data;
    
    // Validate response structure
    if (!data.status || !Array.isArray(data.availableModels) || !Array.isArray(data.inProgressModels)) {
      throw new Error('Invalid health check response structure');
    }

    log(`   Status: ${data.status}`);
    log(`   Available models: [${data.availableModels.join(', ')}]`);
    log(`   In-progress models: [${data.inProgressModels.join(', ')}]`);
    log(`   Total requests: ${data.totalRequests || 0}`);
    
    if (data.uptime) {
      log(`   Uptime: ${Math.floor(data.uptime)}s`);
    }

    return data;
  }

  /**
   * Test models endpoint
   */
  async testModelsEndpoint() {
    const response = await axios.get(`${this.loadBalancerUrl}/models`, {
      timeout: config.TEST_TIMEOUT
    });

    const data = response.data;
    
    // Validate response structure
    if (!Array.isArray(data.availableModels) || !Array.isArray(data.inProgressModels) || !Array.isArray(data.freeModels)) {
      throw new Error('Invalid models endpoint response structure');
    }

    log(`   Available models: [${data.availableModels.join(', ')}]`);
    log(`   In-progress models: [${data.inProgressModels.join(', ')}]`);
    log(`   Free models: [${data.freeModels.join(', ')}]`);
    
    if (data.modelLoad) {
      log(`   Model load: ${JSON.stringify(data.modelLoad)}`);
    }

    return data;
  }

  /**
   * Test LM Studio connection
   */
  async testLMStudioConnection() {
    const response = await axios.get(`${this.lmStudioUrl}/api/v0/models`, {
      timeout: config.TEST_TIMEOUT
    });

    const loadedModels = response.data.data.filter(m => m.state === 'loaded');
    
    log(`   LM Studio is running`);
    log(`   Total models: ${response.data.data.length}`);
    log(`   Loaded models: [${loadedModels.map(m => m.id).join(', ')}]`);

    return loadedModels;
  }

  /**
   * Test chat completion
   */
  async testChatCompletion() {
    const payload = {
      model: "test-model", // This will be replaced by load balancer
      messages: [
        {
          role: "user",
          content: "Hello! Please respond with a simple greeting."
        }
      ],
      max_tokens: 50,
      stream: false
    };

    const response = await axios.post(`${this.loadBalancerUrl}/v1/chat/completions`, payload, {
      timeout: config.TEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;
    
    // Validate response structure
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid chat completion response structure');
    }

    const content = data.choices[0].message.content;
    log(`   Model used: ${data.model || 'unknown'}`);
    log(`   Response: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

    return data;
  }

  /**
   * Test streaming chat completion
   */
  async testStreamingChatCompletion() {
    const payload = {
      model: "test-model",
      messages: [
        {
          role: "user",
          content: "Count from 1 to 5"
        }
      ],
      max_tokens: 30,
      stream: true
    };

    const response = await axios.post(`${this.loadBalancerUrl}/v1/chat/completions`, payload, {
      timeout: config.TEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      responseType: 'stream'
    });

    let chunks = [];
    
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        chunks.push(chunk.toString());
        process.stdout.write('.');
      });

      response.data.on('end', () => {
        log(`   Received ${chunks.length} chunks`);
        resolve({ chunks: chunks.length });
      });

      response.data.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    log('🚀 LM Studio Load Balancer Test Suite', colors.blue);
    log(`   Load Balancer: ${this.loadBalancerUrl}`);
    log(`   LM Studio: ${this.lmStudioUrl}`);
    log(`   Timeout: ${config.TEST_TIMEOUT}ms`);

    try {
      // Test 1: Health check
      const healthData = await this.runTest('Health Check', () => this.testHealthCheck());

      // Test 2: Models endpoint
      const modelsData = await this.runTest('Models Endpoint', () => this.testModelsEndpoint());

      // Test 3: LM Studio connection
      const lmStudioData = await this.runTest('LM Studio Connection', () => this.testLMStudioConnection());

      // Test 4: Chat completion (only if models are available)
      if (healthData.availableModels.length > 0) {
        await this.runTest('Chat Completion', () => this.testChatCompletion());
        
        // Test 5: Streaming chat completion
        await this.runTest('Streaming Chat Completion', () => this.testStreamingChatCompletion());
      } else {
        logWarning('Skipping chat completion tests - no models available');
      }

      // Print summary
      this.printSummary();

    } catch (error) {
      logError(`Test suite failed: ${error.message}`);
      
      if (error.code === 'ECONNREFUSED') {
        logInfo('Make sure the load balancer is running: npm start');
      } else if (error.code === 'ECONNRESET') {
        logInfo('Connection was reset - the server might be restarting');
      }
      
      process.exit(1);
    }
  }

  /**
   * Print test summary
   */
  printSummary() {
    const passed = this.testResults.filter(t => t.status === 'passed').length;
    const failed = this.testResults.filter(t => t.status === 'failed').length;
    const total = this.testResults.length;

    log('\n📊 Test Summary', colors.blue);
    log(`   Total tests: ${total}`);
    logSuccess(`   Passed: ${passed}`);
    
    if (failed > 0) {
      logError(`   Failed: ${failed}`);
      
      log('\n❌ Failed Tests:', colors.red);
      this.testResults
        .filter(t => t.status === 'failed')
        .forEach(test => {
          log(`   - ${test.name}: ${test.error}`, colors.red);
        });
    }

    if (failed === 0) {
      log('\n🎉 All tests passed!', colors.green);
    } else {
      log('\n💡 Some tests failed. Check the error messages above.', colors.yellow);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const testSuite = new LoadBalancerTestSuite();
  testSuite.runAllTests().catch(error => {
    logError(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = LoadBalancerTestSuite;
