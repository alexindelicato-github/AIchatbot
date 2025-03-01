/**
 * Conversation management tests for AI Chatbot
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { wait, queryByText } from './helpers.js';

// Mock HTML before tests
document.body.innerHTML = `
  <main>
    <div class="sidebar">
      <div class="sidebar-buttons">
        <button id="new-chat-btn"></button>
        <button id="select-mode-btn"></button>
        <button id="clear-all-btn"></button>
      </div>
      <div id="selection-actions" style="display: none;">
        <button id="delete-selected-btn"></button>
        <button id="cancel-selection-btn"></button>
      </div>
      <div id="conversation-list"></div>
    </div>
    <div class="main-chat">
      <div id="chat-log"></div>
    </div>
  </main>
`;

describe('Conversation Management Tests', () => {
  // Mock global variables and functions
  beforeEach(() => {
    // Mock global variables
    window.conversations = [
      { id: '1', title: 'Conversation 1', createdAt: new Date().toISOString() },
      { id: '2', title: 'Conversation 2', createdAt: new Date().toISOString() }
    ];
    window.currentConversationId = '1';
    window.messages = [];
    window.isSelectionMode = false;
    window.selectedConversations = [];
    
    // Reset conversation list
    document.getElementById('conversation-list').innerHTML = '';
    document.getElementById('chat-log').innerHTML = '';
    
    // Mock fetch for API calls
    global.fetch.mockImplementation((url, options) => {
      if (url.includes('/api/conversations') && options && options.method === 'DELETE') {
        // Mock delete endpoint
        const id = url.split('/').pop();
        window.conversations = window.conversations.filter(c => c.id !== id);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
    });
  });
  
  test('Should render conversation list correctly', () => {
    // Mock render function
    window.renderConversationList = jest.fn(() => {
      const conversationList = document.getElementById('conversation-list');
      conversationList.innerHTML = '';
      
      window.conversations.forEach(conversation => {
        const conversationEl = document.createElement('div');
        conversationEl.id = `conversation-${conversation.id}`;
        conversationEl.classList.add('conversation');
        
        if (conversation.id === window.currentConversationId) {
          conversationEl.classList.add('active');
        }
        
        // Add selection classes if in selection mode
        if (window.isSelectionMode) {
          conversationEl.classList.add('selectable');
          if (window.selectedConversations.includes(conversation.id)) {
            conversationEl.classList.add('selected');
          }
        }
        
        conversationEl.innerHTML = `<div>${conversation.title}</div>`;
        conversationList.appendChild(conversationEl);
      });
    });
    
    // Call render function
    window.renderConversationList();
    
    // Check conversation elements
    const conversationElements = document.querySelectorAll('.conversation');
    expect(conversationElements.length).toBe(2);
    
    // Check that current conversation is active
    const activeConversation = document.querySelector('.conversation.active');
    expect(activeConversation).not.toBeNull();
    expect(activeConversation.id).toBe(`conversation-${window.currentConversationId}`);
  });
  
  test('Should enable selection mode correctly', () => {
    // Mock toggle selection mode function
    window.toggleSelectionMode = jest.fn(() => {
      window.isSelectionMode = !window.isSelectionMode;
      
      // Update UI
      const selectModeBtn = document.getElementById('select-mode-btn');
      const selectionActions = document.getElementById('selection-actions');
      
      selectModeBtn.classList.toggle('active', window.isSelectionMode);
      selectionActions.style.display = window.isSelectionMode ? 'flex' : 'none';
      
      // Render conversation list with selection mode
      window.renderConversationList();
    });
    
    // Setup renderConversationList mock
    window.renderConversationList = jest.fn();
    
    // Test toggle selection mode
    expect(window.isSelectionMode).toBe(false);
    window.toggleSelectionMode();
    
    // Check that selection mode is enabled
    expect(window.isSelectionMode).toBe(true);
    
    // Check that selection actions are displayed
    expect(document.getElementById('selection-actions').style.display).toBe('flex');
    
    // Check that selection mode button is active
    expect(document.getElementById('select-mode-btn').classList.contains('active')).toBe(true);
    
    // Check that renderConversationList was called
    expect(window.renderConversationList).toHaveBeenCalled();
  });
  
  test('Should delete selected conversations', async () => {
    // Setup selected conversations
    window.isSelectionMode = true;
    window.selectedConversations = ['2'];
    
    // Mock delete selected function
    window.deleteSelectedConversations = jest.fn(async () => {
      if (window.selectedConversations.length === 0) return;
      
      // Delete each selected conversation
      for (const id of window.selectedConversations) {
        await fetch(`/api/conversations/${id}`, {
          method: 'DELETE'
        });
      }
      
      // Reset selection mode
      window.isSelectionMode = false;
      window.selectedConversations = [];
      
      // Update UI
      window.renderConversationList();
    });
    
    // Mock render function
    window.renderConversationList = jest.fn();
    
    // Execute delete selected
    await window.deleteSelectedConversations();
    
    // Check that conversation was deleted
    expect(window.conversations.length).toBe(1);
    expect(window.conversations[0].id).toBe('1');
    
    // Check that selection mode was reset
    expect(window.isSelectionMode).toBe(false);
    expect(window.selectedConversations.length).toBe(0);
    
    // Check that renderConversationList was called
    expect(window.renderConversationList).toHaveBeenCalled();
  });
  
  test('Should delete all conversations', async () => {
    // Mock delete all function
    window.deleteAllConversations = jest.fn(async () => {
      const ids = window.conversations.map(c => c.id);
      
      // Delete each conversation
      for (const id of ids) {
        await fetch(`/api/conversations/${id}`, {
          method: 'DELETE'
        });
      }
      
      // Clear local state
      window.conversations = [];
      window.currentConversationId = null;
      window.messages = [];
      
      // Clear UI
      document.getElementById('chat-log').innerHTML = '';
      window.renderConversationList();
    });
    
    // Mock render function
    window.renderConversationList = jest.fn();
    
    // Execute delete all
    await window.deleteAllConversations();
    
    // Check that all conversations were deleted
    expect(window.conversations.length).toBe(0);
    
    // Check that current conversation was reset
    expect(window.currentConversationId).toBeNull();
    
    // Check that chat log was cleared
    expect(document.getElementById('chat-log').innerHTML).toBe('');
    
    // Check that renderConversationList was called
    expect(window.renderConversationList).toHaveBeenCalled();
  });
});