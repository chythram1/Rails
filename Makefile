# Thin wrapper around the npm scripts. Run `make` (or `make help`) to list targets.
# Env vars (RAILS_HOME, RAILS_HOST, RAILS_PORT, RAILS_TOKEN) pass through, e.g. `RAILS_PORT=5000 make dev`.

.DEFAULT_GOAL := help
.PHONY: help install dev dev-lan dev-tmp typecheck build start token clean distclean

TMP_HOME ?= /tmp/rails-dev

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

node_modules: package.json package-lock.json packages/*/package.json
	npm install
	@touch node_modules

install: node_modules ## Install dependencies (only when package files changed)

dev: node_modules ## Dev servers: API :4317 + Vite :5173 (localhost only)
	npm run dev

dev-lan: node_modules ## Dev servers reachable on the LAN / Tailscale
	RAILS_HOST=0.0.0.0 npm run dev

dev-tmp: node_modules ## Dev on LAN with throwaway state (/tmp/rails-dev, token "t")
	RAILS_HOME=$(TMP_HOME) RAILS_TOKEN=t RAILS_HOST=0.0.0.0 npm run dev

typecheck: node_modules ## Typecheck all packages (must pass)
	npm run typecheck

build: node_modules ## Build the web app into packages/web/dist
	npm run build

start: build ## Build, then run prod (server serves the UI on :4317)
	npm start

token: ## Print the access token
	@node -e 'const p=require("path"),h=process.env.RAILS_HOME||p.join(require("os").homedir(),".rails");console.log(process.env.RAILS_TOKEN||(()=>{try{return JSON.parse(require("fs").readFileSync(p.join(h,"config.json"))).token}catch{console.error("No token yet in "+h+" (start the server once)");process.exit(1)}})())'

clean: ## Remove build output and the dev-tmp state
	rm -rf packages/web/dist $(TMP_HOME)

distclean: clean ## Also remove node_modules
	rm -rf node_modules packages/*/node_modules
