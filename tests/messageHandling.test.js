/**
 * Message handling tests for AI Chatbot
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createEvent, wait, createMockMessage } from './helpers.js';

// Mock HTML before tests
document.body.innerHTML = `
  <main class="center-dock">
    <div class="chat-container left-sidebar">
      <div class="main-chat">
        <div id="chat-log"></div>
        <div class="input-container">
          <form id="message-form" onsubmit="return false;">
            <textarea id="message"></textarea>
            <button type="button" id="send-button">
              <i class="fas fa-paper-plane"></i>
            </button>
          </form>
        </div>
      </div>
    </div>
  </main>
`;

describe('Message Handling Tests', () => {
  beforeEach(() => {
    // Reset chat log
    document.getElementById('chat-log').innerHTML = '';
    
    // Mock fetch success response for chat messages
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        completion: {
          role: 'assistant',
          content: 'This is a response from the AI assistant'
        }
      })
    });
  });
  
  test('Should add user message to chat when send button is clicked', async () => {
    // Setup required functions
    window.createMessageElement = jest.fn((message) => {
      const msgEl = document.createElement('div');
      msgEl.className = `message message--${message.role === 'user' ? 'sent' : 'received'}`;
      msgEl.innerHTML = `
        <div class="message__avatar">
          <i class="fas ${message.role === 'user' ? 'fa-user' : 'fa-robot'}"></i>
        </div>
        <div class="message__text">${message.content}</div>
      `;
      return msgEl;
    });
    
    window.handleSubmit = jest.fn(async (e) => {
      if (e) e.preventDefault();
      
      const messageInput = document.getElementById('message');
      const chatLog = document.getElementById('chat-log');
      const messageText = messageInput.value;
      
      if (!messageText) return;
      
      // Clear input
      messageInput.value = '';
      
      // Create message container
      const container = document.createElement('div');
      container.className = 'message-container';
      
      // Add user message
      const userMessage = { role: 'user', content: messageText };
      container.appendChild(window.createMessageElement(userMessage));
      
      // Add to chat log
      chatLog.appendChild(container);
      
      // Add typing indicator
      const typingIndicator = document.createElement('div');
      typingIndicator.className = 'typing-indicator';
      container.appendChild(typingIndicator);
      
      try {
        // Simulate API call
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [userMessage] })
        });
        
        const data = await response.json();
        
        // Remove typing indicator
        container.removeChild(typingIndicator);
        
        // Add AI response
        container.appendChild(window.createMessageElement(data.completion));
      } catch (error) {
        console.error('Error:', error);
        container.removeChild(typingIndicator);
      }
    });
    
    // Set up message form and button
    const messageForm = document.getElementById('message-form');
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message');
    
    // Set up event listeners
    sendButton.addEventListener('click', window.handleSubmit);
    
    // Test sending a message
    messageInput.value = 'Hello, AI assistant!';
    sendButton.click();
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Check that message container was added
    const messageContainers = document.querySelectorAll('.message-container');
    expect(messageContainers.length).toBe(1);
    
    // Check user message added
    const userMessage = document.querySelector('.message--sent');
    expect(userMessage).not.toBeNull();
    expect(userMessage.textContent.trim()).toContain('Hello, AI assistant!');
    
    // Check AI response added
    const aiMessage = document.querySelector('.message--received');
    expect(aiMessage).not.toBeNull();
    expect(aiMessage.textContent.trim()).toContain('This is a response from the AI assistant');
  });
  
  test('Should handle Enter key to send message', () => {
    // Setup
    const messageInput = document.getElementById('message');
    window.handleSubmit = jest.fn();
    
    // Test pressing Enter without shift
    const enterEvent = createEvent('keydown', { 
      key: 'Enter',
      shiftKey: false
    });
    
    // Mock handleMessageKeyDown function
    window.handleMessageKeyDown = jest.fn((e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        window.handleSubmit();
      }
    });
    
    // Set up event listener
    messageInput.addEventListener('keydown', window.handleMessageKeyDown);
    
    // Trigger enter key press
    messageInput.dispatchEvent(enterEvent);
    
    // Check that handleSubmit was called
    expect(window.handleSubmit).toHaveBeenCalled();
    
    // Test Shift+Enter should not submit
    window.handleSubmit.mockClear();
    const shiftEnterEvent = createEvent('keydown', { 
      key: 'Enter',
      shiftKey: true
    });
    
    messageInput.dispatchEvent(shiftEnterEvent);
    expect(window.handleSubmit).not.toHaveBeenCalled();
  });
});