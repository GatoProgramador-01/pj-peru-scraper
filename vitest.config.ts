import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli.ts',
        'src/tools/**',
        'src/index.ts',
        'src/http-scraper.ts',
        'src/logger.ts',
        'src/config.ts',
        'src/display/**',
        'src/models/internalTypes.ts',
        'src/models/jsfTypes.ts',
        'src/models/pdfTypes.ts',
        'src/models/scraperTypes.ts',
        'src/session/session.ts',
        'src/jsf/searchForm.ts',
        'src/jsf/pagination.ts',
        'src/scraper/scraper.ts',
        'src/scraper/sectorScraper.ts',
        'src/scraper/sectorDiscovery.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
