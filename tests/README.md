# AI Chatbot Tests

This directory contains automated tests for the AI Chatbot application. Tests are written using Jest and Testing Library.

## Test Structure

The test suite is organized by feature:

- **UI Components Tests (`ui.test.js`)** - Tests for UI components like collapse/expand functionality and selection mode
- **Message Handling Tests (`messageHandling.test.js`)** - Tests for sending and receiving messages
- **Conversation Management Tests (`conversationManagement.test.js`)** - Tests for conversation operations (create, delete, select)
- **Collapse Animation Tests (`collapseAnimation.test.js`)** - Tests for the collapse/expand animations

## Running Tests

To run the tests:

```bash
# Install dependencies first
npm install

# Run all tests
npm test

# Run tests with watch mode (for development)
npm run test:watch

# Run a specific test file
npx jest tests/ui.test.js
```

## Test Coverage

These tests verify that all key features are working correctly:

1. **Chat Collapse/Expand Functionality**
   - Chat collapses to bottom-right corner icon
   - Chat expands from icon when clicked
   - Animations work correctly

2. **Message Handling**
   - Sending messages works (including Enter key)
   - Messages display correctly with user/assistant icons
   - Message containers are created properly

3. **Multiple Chat Selection**
   - Selection mode can be toggled
   - Conversations can be selected individually
   - Selected conversations can be deleted

4. **Conversation Management**
   - Create new conversations
   - Delete conversations (single, multiple, or all)
   - Render conversation list correctly

## Mocks

The tests use several mocks to isolate components:

- `localStorage` is mocked to test persistence
- `fetch` is mocked to simulate API calls
- `setTimeout` is mocked for animation testing
- DOM elements are mocked using jsdom

## Adding New Tests

When adding new features, please add corresponding tests following this pattern:

1. Create a relevant test file if needed
2. Mock the necessary HTML structure
3. Mock any required functions
4. Write test cases covering success and failure paths
5. Verify both functionality and UI state