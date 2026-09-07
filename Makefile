# Makefile for the Nvisy.com synthetic benchmark harness

ifneq (,$(wildcard ./.env))
	include .env
	export
endif

# Where a generated corpus and a benchmark run are written.
CORPUS_DIR ?= ./corpus
RUNS_DIR ?= ./runs

# Seed and size for `make generate`. The same seed always yields the same
# corpus, so a score is only comparable to another from this seed.
SEED ?= 42
RECORDS ?= 20

# Records in flight during a run. The win flattens past four: the pipeline
# processes largely in series, so more mostly queues.
CONCURRENCY ?= 4

# Shell-level logger (expands to a printf that runs in the shell).
define log
printf "[%s] [MAKE] [$(MAKECMDGOALS)] $(1)\n" "$$(date '+%Y-%m-%d %H:%M:%S')"
endef

.DEFAULT_GOAL := help

.PHONY: help
help: ## Lists the available targets.
	@grep -hE '^[a-z][a-z-]*:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Installs Node and Python dependencies.
	@$(call log,Installing Node dependencies...)
	@npm ci
	@$(call log,Installing notebook dependencies...)
	@cd notebooks && uv sync
	@$(call log,Dependencies installed.)

# Corpus Commands
.PHONY: generate
generate: ## Generates a corpus from data/ (SEED, RECORDS, CORPUS_DIR).
	@$(call log,Generating $(RECORDS) records from seed $(SEED)...)
	@npm start --silent -- generate \
		--seed $(SEED) --records $(RECORDS) --out $(CORPUS_DIR)
	@$(call log,Corpus written to $(CORPUS_DIR).)

# Benchmark Commands
.PHONY: bench
bench: ## Runs a benchmark against a local server (CONCURRENCY, CORPUS_DIR).
	@$(call log,Submitting $(CORPUS_DIR) to a local pipeline...)
	@npm start --silent -- bench --development \
		--corpus $(CORPUS_DIR) --out $(RUNS_DIR) --concurrency $(CONCURRENCY)
	@$(call log,Run written to $(RUNS_DIR).)

.PHONY: bench-remote
bench-remote: ## Runs a benchmark against the hosted API (needs NVISY_API_TOKEN).
	@$(call log,Submitting $(CORPUS_DIR) to the hosted pipeline...)
	@npm start --silent -- bench \
		--corpus $(CORPUS_DIR) --out $(RUNS_DIR) --concurrency $(CONCURRENCY)
	@$(call log,Run written to $(RUNS_DIR).)

# Notebook Commands
.PHONY: explore
explore: ## Opens the run explorer notebook.
	@$(call log,Opening the explorer...)
	@cd notebooks && uv run marimo edit explore.py

.PHONY: explore-export
explore-export: ## Exports the explorer to a notebook GitHub renders inline.
	@$(call log,Executing the notebook and embedding its output...)
	@cd notebooks && uv run marimo export ipynb explore.py \
		--include-outputs -o explore.ipynb
	@$(call log,Wrote notebooks/explore.ipynb.)

# CI Commands (mirror GitHub Actions)
.PHONY: ci
ci: ## Runs all CI checks locally (check, typecheck, test, e2e, build).
	@$(call log,Running Biome check...)
	@npm run check
	@$(call log,Checking TypeScript...)
	@npm run typecheck
	@$(call log,Running tests...)
	@npm run test
	@$(call log,Running end-to-end tests...)
	@npm run test:e2e
	@$(call log,Running notebook tests...)
	@cd notebooks && uv run pytest -q
	@$(call log,Building...)
	@npm run build
	@$(call log,All CI checks passed!)

.PHONY: fmt
fmt: ## Fixes code formatting and lint.
	@$(call log,Fixing TypeScript...)
	@npm run check:fix
	@$(call log,Fixing notebooks...)
	@cd notebooks && uv run ruff check --fix . && uv run ruff format .
	@$(call log,Formatting fixed!)

.PHONY: test
test: ## Runs the unit test suite.
	@$(call log,Running tests...)
	@npm run test
	@$(call log,Running notebook tests...)
	@cd notebooks && uv run pytest -q
	@$(call log,Tests complete.)

.PHONY: build
build: ## Builds the CLI.
	@$(call log,Building...)
	@npm run build
	@$(call log,Build complete.)

.PHONY: clean
clean: ## Removes build artifacts.
	@$(call log,Cleaning build artifacts...)
	@rm -rf dist/ coverage/ node_modules/.cache/ $(CORPUS_DIR).staging
	@$(call log,Clean complete.)

.PHONY: clean-output
clean-output: ## Removes generated corpora and runs. Both cost time to rebuild.
	@$(call log,Removing $(CORPUS_DIR) and $(RUNS_DIR)...)
	@rm -rf $(CORPUS_DIR) $(RUNS_DIR)
	@$(call log,Generated output removed.)

.PHONY: all
all: install generate bench
