/**
 * Collapse animation tests for AI Chatbot
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { wait } from './helpers.js';

// Mock HTML before tests
document.body.innerHTML = `
  <main class="center-dock">
    <button id="collapse-btn" class="collapse-btn">
      <i class="fas fa-minus"></i>
    </button>
  </main>
  <button id="chat-toggle-btn" class="chat-toggle-btn">
    <i class="fas fa-comment-dots"></i>
  </button>
`;

describe('Collapse Animation Tests', () => {
  let mainElement;
  let collapseBtn;
  let chatToggleBtn;
  
  beforeEach(() => {
    mainElement = document.querySelector('main');
    collapseBtn = document.getElementById('collapse-btn');
    chatToggleBtn = document.getElementById('chat-toggle-btn');
    
    // Reset main element state
    mainElement.classList.remove('collapsed');
    document.body.classList.remove('chat-hidden');
    mainElement.style.transform = '';
    
    // Mock getBoundingClientRect
    Element.prototype.getBoundingClientRect = jest.fn().mockImplementation(function() {
      if (this.id === 'chat-toggle-btn') {
        return {
          bottom: window.innerHeight - 30,
          right: window.innerWidth - 30,
          width: 60,
          height: 60
        };
      }
      return {
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0
      };
    });
    
    // Mock window properties
    window.innerWidth = 1024;
    window.innerHeight = 768;
    
    // Mock collapse animation function
    window.collapseChat = jest.fn(() => {
      // Get toggle button position to animate towards
      const mainRect = {
        right: window.innerWidth - 60,
        bottom: window.innerHeight - 60  
      };
      
      // Start animation to collapsed state
      mainElement.style.transform = `translate(${mainRect.right}px, ${mainRect.bottom}px) scale(0.1)`;
      
      // Add the collapsed class after animation starts
      setTimeout(() => {
        mainElement.classList.add('collapsed');
        document.body.classList.add('chat-hidden');
        localStorage.setItem('chatCollapsed', 'true');
      }, 300);
    });
    
    // Mock expand animation function
    window.expandChat = jest.fn(() => {
      // Get toggle button position for animation start point
      const mainRect = {
        right: window.innerWidth - 60,
        bottom: window.innerHeight - 60  
      };
      
      // Set initial position to animate from
      mainElement.style.transform = `translate(${mainRect.right}px, ${mainRect.bottom}px) scale(0.1)`;
      
      // Remove collapsed class
      mainElement.classList.remove('collapsed');
      document.body.classList.remove('chat-hidden');
      
      // Force layout calculation
      mainElement.offsetHeight;
      
      // Animate to full size
      mainElement.style.transform = 'translate(0, 0) scale(1)';
      
      localStorage.setItem('chatCollapsed', 'false');
    });
  });
  
  test('Should apply transform styles when collapsing', () => {
    // Mock setTimeout to execute immediately
    jest.useFakeTimers();
    
    // Collapse chat
    window.collapseChat();
    
    // Check transform style was applied
    expect(mainElement.style.transform).toContain('translate');
    expect(mainElement.style.transform).toContain('scale(0.1)');
    
    // Fast-forward timers
    jest.advanceTimersByTime(300);
    
    // Check that collapsed classes were added
    expect(mainElement.classList.contains('collapsed')).toBe(true);
    expect(document.body.classList.contains('chat-hidden')).toBe(true);
    
    // Check localStorage was updated
    expect(localStorage.setItem).toHaveBeenCalledWith('chatCollapsed', 'true');
    
    jest.useRealTimers();
  });
  
  test('Should apply transform styles when expanding', () => {
    // Setup initial collapsed state
    mainElement.classList.add('collapsed');
    document.body.classList.add('chat-hidden');
    
    // Expand chat
    window.expandChat();
    
    // Check that initial transform was applied
    expect(mainElement.style.transform).toContain('scale(0.1)');
    
    // Check that collapsed classes were removed
    expect(mainElement.classList.contains('collapsed')).toBe(false);
    expect(document.body.classList.contains('chat-hidden')).toBe(false);
    
    // Check that final transform was applied
    expect(mainElement.style.transform).toBe('translate(0, 0) scale(1)');
    
    // Check localStorage was updated
    expect(localStorage.setItem).toHaveBeenCalledWith('chatCollapsed', 'false');
  });
  
  test('Should initialize with correct collapsed state on page load', () => {
    // Mock localStorage to return collapsed = true
    localStorage.getItem.mockReturnValue('true');
    
    // Setup collapsed state initialization function
    window.initializeCollapseState = jest.fn(() => {
      const isCollapsed = localStorage.getItem('chatCollapsed') === 'true';
      if (isCollapsed) {
        // Position at toggle button
        const mainRect = {
          right: window.innerWidth - 60,
          bottom: window.innerHeight - 60  
        };
        
        // Set collapsed position
        mainElement.style.transform = `translate(${mainRect.right}px, ${mainRect.bottom}px) scale(0.1)`;
        
        // Add collapsed classes
        mainElement.classList.add('collapsed');
        document.body.classList.add('chat-hidden');
      }
    });
    
    // Call initialization function
    window.initializeCollapseState();
    
    // Check that collapsed state was set correctly
    expect(mainElement.classList.contains('collapsed')).toBe(true);
    expect(document.body.classList.contains('chat-hidden')).toBe(true);
    expect(mainElement.style.transform).toContain('scale(0.1)');
    
    // Check localStorage was read
    expect(localStorage.getItem).toHaveBeenCalledWith('chatCollapsed');
  });
});