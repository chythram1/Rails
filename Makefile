# Thin wrapper around the npm scripts. Run `make` (or `make help`) to list targets.
# Env vars (RAILS_HOME, RAILS_HOST, RAILS_PORT, RAILS_TOKEN) pass through, e.g. `RAILS_PORT=5000 make dev`.

.DEFAULT_GOAL := help
.PHONY: help install system-deps dev dev-lan dev-tmp typecheck build start token cli clean distclean

TMP_HOME ?= /tmp/rails-dev
TMUX_MIN := 3.2
BIN_DIR ?= $(HOME)/.local/bin

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

node_modules: package.json package-lock.json packages/*/package.json
	npm install
	@touch node_modules

install: node_modules system-deps ## Install npm deps (when package files changed) and tmux (if missing)

# Panels run in tmux (ADR 0003). Installs it with Homebrew, apt or dnf when it's missing.
system-deps: ## Check for tmux >= 3.2, installing it if missing
	@if ! command -v tmux >/dev/null 2>&1; then \
	  echo "tmux is required (every panel runs in it); installing..."; \
	  if command -v brew >/dev/null 2>&1; then brew install tmux; \
	  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get install -y tmux; \
	  elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y tmux; \
	  else echo "Couldn't find brew, apt-get or dnf. Install tmux >= $(TMUX_MIN) yourself, then rerun." >&2; exit 1; fi; \
	fi
	@v=$$(tmux -V | sed -E 's/^[^0-9]*([0-9]+\.[0-9]+).*/\1/'); \
	if ! awk -v v="$$v" -v m="$(TMUX_MIN)" 'BEGIN { split(v, a, "."); split(m, b, "."); exit !(a[1] > b[1] || (a[1] == b[1] && a[2] >= b[2])) }'; then \
	  echo "tmux $$v is too old; rails needs >= $(TMUX_MIN). Upgrade it (e.g. brew upgrade tmux)." >&2; exit 1; \
	fi

dev: node_modules system-deps ## Dev servers: API :4317 + Vite :5173 (localhost only)
	npm run dev

dev-lan: node_modules system-deps ## Dev servers reachable on the LAN / Tailscale
	RAILS_HOST=0.0.0.0 npm run dev

dev-tmp: node_modules system-deps ## Dev on LAN with throwaway state (/tmp/rails-dev, token "t")
	RAILS_HOME=$(TMP_HOME) RAILS_TOKEN=t RAILS_HOST=0.0.0.0 npm run dev

typecheck: node_modules ## Typecheck all packages (must pass)
	npm run typecheck

build: node_modules ## Build the web app into packages/web/dist
	npm run build

start: build system-deps ## Build, then run prod (server serves the UI on :4317)
	npm start

token: ## Print the access token
	@node -e 'const p=require("path"),h=process.env.RAILS_HOME||p.join(require("os").homedir(),".rails");console.log(process.env.RAILS_TOKEN||(()=>{try{return JSON.parse(require("fs").readFileSync(p.join(h,"config.json"))).token}catch{console.error("No token yet in "+h+" (start the server once)");process.exit(1)}})())'

cli: ## Link bin/rails-agent into ~/.local/bin (override with BIN_DIR=...)
	@mkdir -p "$(BIN_DIR)"
	ln -sf "$(CURDIR)/bin/rails-agent.mjs" "$(BIN_DIR)/rails-agent"
	@echo "rails-agent -> $(BIN_DIR)/rails-agent (make sure $(BIN_DIR) is on your PATH)"

clean: ## Remove build output and the dev-tmp state
	rm -rf packages/web/dist $(TMP_HOME)

distclean: clean ## Also remove node_modules
	rm -rf node_modules packages/*/node_modules
