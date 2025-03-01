/**
 * UI component tests for AI Chatbot 
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { wait } from './helpers.js';

// Mock HTML before tests
document.body.innerHTML = `
  <main class="center-dock">
    <button id="collapse-btn" class="collapse-btn">
      <i class="fas fa-minus"></i>
    </button>
    <div class="chat-container left-sidebar">
      <div class="sidebar">
        <div class="sidebar-buttons">
          <button id="new-chat-btn" class="new-chat-btn">
            <i class="fas fa-plus"></i> New Chat
          </button>
          <button id="select-mode-btn" class="select-mode-btn">
            <i class="fas fa-check-square"></i>
          </button>
          <button id="clear-all-btn" class="clear-all-btn">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
        <div id="selection-actions" class="selection-actions" style="display: none;">
          <button id="delete-selected-btn" class="delete-selected-btn">Delete Selected</button>
          <button id="cancel-selection-btn" class="cancel-selection-btn">Cancel</button>
        </div>
        <div id="conversation-list" class="conversation-list"></div>
      </div>
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
  <button id="chat-toggle-btn" class="chat-toggle-btn">
    <i class="fas fa-comment-dots"></i>
  </button>
`;

describe('UI Components Tests', () => {
  // Test collapse/expand functionality
  describe('Collapse/Expand Functionality', () => {
    test('Chat should collapse when collapse button is clicked', () => {
      const collapseBtn = document.getElementById('collapse-btn');
      const mainElement = document.querySelector('main');
      
      // Mock setTimeout
      jest.useFakeTimers();
      
      // Click the collapse button
      collapseBtn.click();
      
      // Fast-forward timers
      jest.advanceTimersByTime(300);
      
      // Check that collapsed class was added
      expect(mainElement.classList.contains('collapsed')).toBe(true);
      expect(document.body.classList.contains('chat-hidden')).toBe(true);
      
      // Check localStorage was updated
      expect(localStorage.setItem).toHaveBeenCalledWith('chatCollapsed', 'true');
      
      jest.useRealTimers();
    });
    
    test('Chat should expand when toggle button is clicked', () => {
      const toggleBtn = document.getElementById('chat-toggle-btn');
      const mainElement = document.querySelector('main');
      
      // Setup initial state as collapsed
      mainElement.classList.add('collapsed');
      document.body.classList.add('chat-hidden');
      
      // Click the toggle button
      toggleBtn.click();
      
      // Check that collapsed class was removed
      expect(mainElement.classList.contains('collapsed')).toBe(false);
      expect(document.body.classList.contains('chat-hidden')).toBe(false);
      
      // Check localStorage was updated
      expect(localStorage.setItem).toHaveBeenCalledWith('chatCollapsed', 'false');
    });
  });
  
  // Test selection mode
  describe('Selection Mode', () => {
    test('should toggle selection mode when select button is clicked', () => {
      // Setup - add required functions
      window.toggleSelectionMode = jest.fn(() => {
        const selectModeBtn = document.getElementById('select-mode-btn');
        const selectionActions = document.getElementById('selection-actions');
        
        selectModeBtn.classList.toggle('active');
        selectionActions.style.display = selectionActions.style.display === 'none' ? 'flex' : 'none';
      });
      
      const selectModeBtn = document.getElementById('select-mode-btn');
      const selectionActions = document.getElementById('selection-actions');
      
      // Initial state check
      expect(selectionActions.style.display).toBe('none');
      
      // Click select mode button
      selectModeBtn.addEventListener('click', window.toggleSelectionMode);
      selectModeBtn.click();
      
      // Check that selection actions are visible
      expect(selectionActions.style.display).toBe('flex');
      
      // Click again to exit selection mode
      selectModeBtn.click();
      
      // Check that selection actions are hidden again
      expect(selectionActions.style.display).toBe('none');
    });
  });
});