/**
 * Simple jest-dom replacement functions
 */

// Add custom matchers to Jest
expect.extend({
  // Check if element has a specific class
  toHaveClass(received, expectedClass) {
    const pass = received.classList.contains(expectedClass);
    return {
      pass,
      message: () => `Expected element ${pass ? 'not ' : ''}to have class "${expectedClass}"`,
    };
  },
  
  // Check if element has specific text content
  toHaveTextContent(received, expectedText) {
    const text = received.textContent.trim();
    const pass = text.includes(expectedText);
    return {
      pass,
      message: () => `Expected element ${pass ? 'not ' : ''}to have text content "${expectedText}", but got "${text}"`,
    };
  },
  
  // Check if element is visible
  toBeVisible(received) {
    // Check various CSS properties that could hide an element
    const styles = window.getComputedStyle(received);
    
    const isVisible = 
      styles.display !== 'none' && 
      styles.visibility !== 'hidden' && 
      styles.opacity !== '0' &&
      received.offsetWidth > 0 && 
      received.offsetHeight > 0;
      
    return {
      pass: isVisible,
      message: () => `Expected element ${isVisible ? 'not ' : ''}to be visible`,
    };
  },
  
  // Check if element has style property
  toHaveStyle(received, styleObj) {
    const styles = window.getComputedStyle(received);
    let pass = true;
    let failedStyles = [];
    
    for (const [prop, value] of Object.entries(styleObj)) {
      if (styles[prop] !== value) {
        pass = false;
        failedStyles.push(`${prop}: ${styles[prop]} (expected: ${value})`);
      }
    }
    
    return {
      pass,
      message: () => `Expected element ${pass ? 'not ' : ''}to have style ${JSON.stringify(styleObj)}${!pass ? `. Failed styles: ${failedStyles.join(', ')}` : ''}`,
    };
  },
});