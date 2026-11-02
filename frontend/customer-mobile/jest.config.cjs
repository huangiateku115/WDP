module.exports={
  preset:'jest-expo',
  cacheDirectory:'<rootDir>/.expo/jest-cache',
  testMatch:['<rootDir>/tests/**/*.test.ts','<rootDir>/tests/**/*.test.tsx'],
  setupFilesAfterEnv:['<rootDir>/tests/setup.ts'],
  clearMocks:true,
};
