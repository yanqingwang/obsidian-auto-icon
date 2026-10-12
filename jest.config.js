/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    // The real obsidian package is a type-only facade at runtime (it needs Electron), so tests get
    // a stub implementing the handful of classes and helpers these modules touch.
    "^obsidian$": "<rootDir>/tests/mocks/obsidian.js",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { module: "CommonJS", esModuleInterop: true, strict: true } }],
  },
};