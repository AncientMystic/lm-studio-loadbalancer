# Contributing to LM Studio Load Balancer

Thank you for your interest in contributing to LM Studio Load Balancer! This document provides guidelines and information for contributors.

## 🤝 How to Contribute

### Reporting Bugs

Before creating a bug report, please check:

1. **Existing Issues**: Search [existing issues](https://github.com/autolocalize/lm-studio-loadbalancer/issues) to avoid duplicates
2. **Latest Version**: Ensure you're using the latest version of the load balancer
3. **LM Studio Status**: Verify LM Studio is running and accessible

When creating a bug report, please include:

- **Clear Title**: Descriptive summary of the issue
- **Environment Information**:
  - Node.js version
  - LM Studio version
  - Operating system
  - Browser (if applicable)
- **Steps to Reproduce**: Detailed steps to reproduce the issue
- **Expected Behavior**: What you expected to happen
- **Actual Behavior**: What actually happened
- **Error Messages**: Any error logs or messages
- **Additional Context**: Any other relevant information

### Suggesting Features

Feature suggestions are welcome! Please include:

- **Clear Title**: Descriptive summary of the feature
- **Problem Description**: What problem this feature solves
- **Proposed Solution**: How you envision the feature working
- **Alternatives Considered**: Other approaches you've considered
- **Additional Context**: Any other relevant information

### Pull Requests

We welcome pull requests! Here's how to get started:

#### 1. Fork and Clone

```bash
git clone https://github.com/autolocalize/lm-studio-loadbalancer.git
cd lm-studio-loadbalancer
```

#### 2. Setup Development Environment

```bash
npm install
```

#### 3. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

#### 4. Make Changes

- Follow the existing code style and patterns
- Add tests for new functionality
- Update documentation as needed
- Ensure all existing tests pass

#### 5. Test Your Changes

```bash
npm test
```

#### 6. Commit Your Changes

Use clear, descriptive commit messages:

```bash
git add .
git commit -m "feat: add new feature description"
# or
git commit -m "fix: resolve issue description"
```

#### 7. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a pull request with:

- **Clear Title**: Descriptive summary of changes
- **Detailed Description**: What you changed and why
- **Testing Information**: How you tested your changes
- **Screenshots**: If applicable, include screenshots

## 📝 Code Style Guidelines

### JavaScript/Node.js

- Use **camelCase** for variables and functions
- Use **PascalCase** for classes and constructors
- Use **UPPER_SNAKE_CASE** for constants
- Add proper JSDoc comments for functions and complex logic
- Keep lines under 100 characters when possible
- Use meaningful variable and function names

### Example:

```javascript
/**
 * Loads available models from LM Studio API
 * @returns {Promise<Array>} Array of loaded models
 */
async function loadModels() {
  try {
    const response = await axios.get(`${LM_STUDIO_URL}/api/v0/models`);
    return response.data.filter(model => model.state === 'loaded');
  } catch (error) {
    console.error('Failed to load models:', error.message);
    return [];
  }
}
```

### Error Handling

- Always handle potential errors
- Provide meaningful error messages
- Use appropriate HTTP status codes for API responses
- Log errors with sufficient context

### Testing

- Write tests for new features
- Test edge cases and error conditions
- Ensure tests are deterministic and reliable
- Use descriptive test names

## 🏗️ Project Structure

```
lm-studio-loadbalancer/
├── server.js              # Main load balancer server
├── test.js                # Test suite
├── package.json           # Project configuration
├── .env.example           # Environment variables example
├── .gitignore             # Git ignore file
├── LICENSE                # MIT License
├── README.md              # Project documentation
└── CONTRIBUTING.md        # This file
```

## 🚀 Development Workflow

### Local Development

1. **Start LM Studio**: Ensure LM Studio is running on `localhost:1234`
2. **Load Models**: Load at least one model in LM Studio
3. **Start Development Server**:
   ```bash
   npm run dev
   ```
4. **Run Tests**: 
   ```bash
   npm test
   ```

### Testing Changes

- Test with different LM Studio models
- Verify load balancing behavior
- Check error handling scenarios
- Test streaming responses
- Validate API compatibility

## 📋 Release Process

Releases are managed through Git tags:

1. Update version in `package.json`
2. Update `CHANGELOG.md` (if it exists)
3. Create a Git tag:
   ```bash
   git tag v1.0.0
   ```
4. Push the tag:
   ```bash
   git push origin v1.0.0
   ```

## 🤓 Getting Help

If you need help:

1. Check [existing issues](https://github.com/autolocalize/lm-studio-loadbalancer/issues)
2. Read the [README.md](README.md) documentation
3. Create a new issue with your question
4. Join discussions in existing issues

## 📄 License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.

## 🙏 Recognition

Contributors are recognized in:

- [AUTHORS.md](AUTHORS.md) (if it exists)
- Commit history
- Release notes

Thank you for contributing to LM Studio Load Balancer! 🎉
