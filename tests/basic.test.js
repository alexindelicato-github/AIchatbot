/**
 * Basic test file to verify Jest setup
 */

describe('Basic DOM Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="test-div" class="test-class">Test content</div>
      <button id="test-button">Click me</button>
    `;
  });
  
  test('should find elements in the DOM', () => {
    const div = document.getElementById('test-div');
    expect(div).not.toBeNull();
    expect(div.textContent).toBe('Test content');
  });
  
  test('should check for classes', () => {
    const div = document.getElementById('test-div');
    expect(div.classList.contains('test-class')).toBe(true);
  });
  
  test('should handle click events', () => {
    let clicked = false;
    const button = document.getElementById('test-button');
    
    button.addEventListener('click', () => {
      clicked = true;
    });
    
    button.click();
    expect(clicked).toBe(true);
  });
});