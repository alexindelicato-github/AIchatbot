export default {
  testEnvironment: 'jsdom',
  transform: {
    "^.+\\.jsx?$": "babel-jest", // Tells Jest to use babel-jest to transform JS/JSX files
  },
  moduleFileExtensions: ['js', 'json'],
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['./tests/setupTests.js', './tests/custom-jest-dom.js'],
  testEnvironmentOptions: {
    url: 'http://localhost/',
  },
};
