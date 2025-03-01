/**
 * Multicast DNS (mDNS) advertisement script for ChatBot
 *
 * This script advertises the ChatBot service on the local network,
 * allowing other devices to discover it using the hostname "chatbot.local"
 *
 * To use:
 * 1. Install the dependency: npm install bonjour
 * 2. Run this script: node advertise.js
 * 3. Access the chatbot from other devices using: http://cb.local:3002
 */

import bonjour from 'bonjour';

// Create a bonjour instance
const bonjourInstance = bonjour();

// Define service information
const service = {
  name: 'ChatBot',  // The service name that will appear in discovery
  host: 'cb.local', // The hostname to advertise
  type: 'http',     // Service type
  port: 3002,       // The port your chatbot runs on
  txt: {            // Optional text records
    description: 'AI Security Chatbot'
  }
};

// Publish the service
bonjourInstance.publish(service);

console.log('✅ ChatBot service is being advertised via mDNS');
console.log('📱 Devices on your network can access it at:');
console.log(`   http://${service.host}:${service.port}`);
console.log('');
console.log('ℹ️  This script must keep running to maintain the advertisement');
console.log('   Press Ctrl+C to stop advertising and exit');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping mDNS advertisement...');
  bonjourInstance.unpublishAll(() => {
    console.log('✅ Service advertisement stopped');
    process.exit();
  });
});
