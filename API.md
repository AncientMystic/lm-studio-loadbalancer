# LM Studio Load Balancer API Documentation

This document provides comprehensive information about the LM Studio Load Balancer REST API.

## Base URL

```
http://localhost:4321
```

*Note: The port can be configured via the `LOAD_BALANCER_PORT` environment variable.*

## Overview

The LM Studio Load Balancer provides a RESTful API that is compatible with OpenAI's chat completions API while adding intelligent load balancing capabilities across multiple LM Studio models.

## Authentication

Currently, the API does not require authentication. This may change in future versions for security purposes.

## Headers

### Required Headers
- `Content-Type: application/json` - For JSON request bodies
- `Accept: application/json` - For JSON responses (default)
- `Accept: text/event-stream` - For streaming responses

### Optional Headers
- `Cache-Control: no-cache` - Recommended for streaming requests
- `Connection: keep-alive` - For persistent connections

## API Endpoints

### 1. Health Check

Check the health and status of the load balancer.

#### Endpoint
```
GET /health
```

#### Response
```json
{
  "status": "healthy",
  "availableModels": ["model1", "model2"],
  "inProgressModels": ["model1"],
  "totalRequests": 42,
  "uptime": 3600.5,
  "memory": {
    "rss": 50331648,
    "heapTotal": 20971520,
    "heapUsed": 15728640,
    "external": 1048576
  }
}
```

#### Response Fields
- `status` (string): Health status ("healthy" or "error")
- `availableModels` (array): List of available model IDs
- `inProgressModels` (array): List of models currently processing requests
- `totalRequests` (number): Total number of requests processed
- `uptime` (number): Server uptime in seconds
- `memory` (object): Memory usage statistics

#### Example Request
```bash
curl -X GET http://localhost:4321/health
```

#### Example Response
```bash
curl -X GET http://localhost:4321/health | jq .
```

---

### 2. Model Status

Get detailed information about available models and their current load.

#### Endpoint
```
GET /models
```

#### Response
```json
{
  "availableModels": ["model1", "model2"],
  "inProgressModels": ["model1"],
  "freeModels": ["model2"],
  "modelLoad": {
    "model1": 1,
    "model2": 0
  }
}
```

#### Response Fields
- `availableModels` (array): List of all available model IDs
- `inProgressModels` (array): Models currently processing requests
- `freeModels` (array): Models available for new requests
- `modelLoad` (object): Current request count per model

#### Example Request
```bash
curl -X GET http://localhost:4321/models
```

---

### 3. Chat Completions

Create a chat completion request. This endpoint is compatible with OpenAI's API format.

#### Endpoint
```
POST /v1/chat/completions
```

#### Request Body
```json
{
  "model": "any-model-name",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello! How are you?"
    }
  ],
  "max_tokens": 100,
  "temperature": 0.7,
  "stream": false
}
```

#### Request Fields
- `model` (string, required): Model name (will be automatically replaced with available model)
- `messages` (array, required): Array of message objects
  - `role` (string): Message role ("system", "user", or "assistant")
  - `content` (string): Message content
- `max_tokens` (number, optional): Maximum tokens to generate (default: unlimited)
- `temperature` (number, optional): Sampling temperature (0.0 to 2.0, default: 1.0)
- `stream` (boolean, optional): Enable streaming response (default: false)

#### Non-Streaming Response
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "model1",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I'm doing well, thank you for asking. How can I assist you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 56,
    "completion_tokens": 31,
    "total_tokens": 87
  }
}
```

#### Streaming Response
When `stream: true`, the response will be sent as Server-Sent Events:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"model1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"model1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"model1","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: [DONE]
```

#### Example Requests

**Non-Streaming Request:**
```bash
curl -X POST http://localhost:4321/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "any-model",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 50
  }'
```

**Streaming Request:**
```bash
curl -X POST http://localhost:4321/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "model": "any-model",
    "messages": [
      {"role": "user", "content": "Count to 5"}
    ],
    "stream": true
  }'
```

---

## Load Balancing Behavior

### Model Selection Algorithm

The load balancer uses a **least-loaded algorithm**:

1. Counts in-progress requests for each available model
2. Selects the model with the fewest active requests
3. Automatically replaces the requested model in the API call

### Failover Handling

- If a model becomes unavailable, it's automatically removed from the pool
- Requests are redistributed among remaining available models
- Failed requests return appropriate HTTP error codes

### Request Tracking

- Each request is tracked from start to completion
- Models are released when requests complete or fail
- Cleanup occurs on connection close, stream finish, or errors

## Error Handling

### HTTP Status Codes

- `200 OK`: Successful request
- `400 Bad Request`: Invalid request body or parameters
- `413 Payload Too Large`: Request exceeds size limits
- `500 Internal Server Error`: Server error or proxy failure
- `504 Gateway Timeout`: Request timeout or LM Studio unresponsive

### Error Response Format
```json
{
  "error": "Error description",
  "message": "Detailed error message",
  "code": "ERROR_CODE"
}
```

### Common Error Scenarios

#### No Models Available
```json
{
  "error": "No models available",
  "message": "No loaded models found in LM Studio",
  "code": "NO_MODELS"
}
```

#### Payload Too Large
```json
{
  "error": "Request entity too large",
  "message": "Request exceeds maximum payload size",
  "code": "PAYLOAD_TOO_LARGE"
}
```

#### Gateway Timeout
```json
{
  "error": "Gateway timeout",
  "message": "Request took too long to complete",
  "code": "ETIMEDOUT"
}
```

## Configuration

### Environment Variables

The API behavior can be configured via environment variables:

```bash
# LM Studio connection
LM_STUDIO_URL=http://localhost:1234

# Load balancer settings
LOAD_BALANCER_PORT=4321
MODEL_REFRESH_INTERVAL=30000

# Request handling
REQUEST_TIMEOUT=300000
MAX_PAYLOAD_SIZE=50mb

# Logging
LOG_LEVEL=info
ENABLE_REQUEST_LOGGING=true
```

### Configuration File

Create a `.env` file in the project root:

```bash
# Copy the example configuration
cp .env.example .env

# Edit the values as needed
nano .env
```

## Rate Limiting

Currently, there are no built-in rate limits. Rate limiting should be implemented at the infrastructure level if needed.

## Monitoring

### Health Monitoring

- Use `/health` endpoint for health checks
- Monitor response times and error rates
- Track model availability and load distribution

### Metrics to Monitor

- Request count per model
- Response times
- Error rates
- Model availability changes
- Memory usage

## SDK Examples

### Node.js (Axios)

```javascript
const axios = require('axios');

async function chatCompletion(message) {
  try {
    const response = await axios.post('http://localhost:4321/v1/chat/completions', {
      model: 'any-model',
      messages: [{ role: 'user', content: message }],
      max_tokens: 100
    });
    
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}
```

### Python (Requests)

```python
import requests

def chat_completion(message):
    try:
        response = requests.post('http://localhost:4321/v1/chat/completions', json={
            'model': 'any-model',
            'messages': [{'role': 'user', 'content': message}],
            'max_tokens': 100
        })
        
        response.raise_for_status()
        return response.json()['choices'][0]['message']['content']
    except requests.exceptions.RequestException as e:
        print(f'Error: {e}')
```

### JavaScript (Fetch)

```javascript
async function chatCompletion(message) {
  try {
    const response = await fetch('http://localhost:4321/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'any-model',
        messages: [{ role: 'user', content: message }],
        max_tokens: 100
      })
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error:', error);
  }
}
```

## Troubleshooting

### Common Issues

1. **Connection Refused**: Ensure the load balancer is running (`npm start`)
2. **No Models Available**: Check that LM Studio is running with loaded models
3. **Timeout Errors**: Increase `REQUEST_TIMEOUT` or check LM Studio performance
4. **Large Payloads**: Adjust `MAX_PAYLOAD_SIZE` if needed

### Debugging

1. Enable debug logging: `LOG_LEVEL=debug`
2. Check health endpoint: `GET /health`
3. Monitor model status: `GET /models`
4. Review server logs for detailed error information

---

## Support

For API-related questions or issues:

1. Check the [Issues](https://github.com/autolocalize/lm-studio-loadbalancer/issues) page
2. Review the [README.md](README.md) for general information
3. Create a new issue with detailed error information and request details

---

**Note**: This API is designed to be compatible with OpenAI's chat completions API while adding load balancing capabilities for LM Studio.
