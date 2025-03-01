/**
 * Test helper functions
 */

// Create a simulated DOM event (e.g., click, keydown)
export function createEvent(type, options = {}) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    ...options
  });
  
  // Add properties for keyboard events
  if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
    Object.assign(event, {
      key: options.key || '',
      code: options.code || '',
      keyCode: options.keyCode || 0,
      ctrlKey: options.ctrlKey || false,
      shiftKey: options.shiftKey || false,
      altKey: options.altKey || false,
      metaKey: options.metaKey || false
    });
  }
  
  return event;
}

// Wait for a specified time (useful for async tests)
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extract text content from an element
export function getTextContent(element) {
  return element.textContent.trim();
}

// Find elements by text content
export function queryByText(container, text) {
  return Array.from(container.querySelectorAll('*'))
    .find(element => element.textContent.trim().includes(text));
}

// Create a mock message object
export function createMockMessage(role, content) {
  return { role, content };
}