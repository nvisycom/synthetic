# Contributing

Thank you for your interest in contributing to the Nvisy synthetic benchmark
harness.

## Requirements

- Node.js 24.0.0 or higher
- TypeScript 5.9.0 or higher
- Python 3.12 or higher, for the binary and media renderers
- npm

## Development Setup

```bash
git clone https://github.com/nvisycom/synthetic.git
cd synthetic
npm install
```

## Development

### Scripts

- `npm start` - Run the CLI from source
- `npm run build` - Build the CLI
- `npm run dev` - Build in watch mode for development
- `npm test` - Run test suite
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Check code style and quality
- `npm run format` - Format code with Biome
- `npm run check` - Run all linting and formatting checks
- `npm run typecheck` - Verify TypeScript types
- `npm run clean` - Remove build artifacts

### Quality Checks

Before submitting changes:

```bash
npm run check      # Lint and format
npm run typecheck  # Verify TypeScript types
npm test           # Run test suite
npm run build      # Verify build works
```

## Ground Truth

The correctness of every metric rests on the ground truth being exactly right,
so changes touching planting or scoring warrant more care than the rest:

- A generator change that moves a planted value must move its recorded position
  in the same commit. The two are one fact, never two.
- Never widen a match in the scorer to make a number look better. If a pipeline
  misses a value, the benchmark's job is to say so.
- Offsets are UTF-16 code units, half-open. Cover any new coordinate handling
  with a test using non-ASCII text.

## Pull Request Process

1. Create a feature branch
2. Make your changes
3. Add tests for new functionality
4. Run quality checks: `npm run check`
5. Submit a pull request

### Pull Request Checklist

- [ ] Tests pass
- [ ] Code follows project style
- [ ] TypeScript types are correct
- [ ] Ground truth and generation stay in sync
- [ ] Documentation updated if needed

## Code Standards

- Follow existing TypeScript patterns
- Use native JavaScript private fields (`#`)
- Write tests for new features
- Include JSDoc for public APIs

## License

By contributing, you agree your contributions will be licensed under the MIT
License.
