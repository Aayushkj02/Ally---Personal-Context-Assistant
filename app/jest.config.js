module.exports = {
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: './tsconfig.json',
      },
    ],
  },

  testEnvironment: 'node',

  testMatch: ['**/__tests__/**/*.test.ts'],
};