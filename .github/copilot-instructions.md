# Amazon ECR Login Action - AI Agent Guide

## Architecture Overview

This is a Node.js-based GitHub Action (compiled with `@vercel/ncc`) that logs Docker clients into AWS ECR Private or ECR Public registries.

**Core Components:**
- `index.js` – main action entrypoint; fetches ECR auth tokens and performs `docker login`
- `cleanup.js` – post-action cleanup; runs `docker logout` for all logged-in registries
- `action.yml` – GitHub Actions metadata; declares inputs, outputs, and uses `node20` runtime
- `dist/` – compiled outputs (`ncc build` bundles dependencies into standalone JS)

**Key Data Flow:**
1. Action reads AWS credentials from environment (set by `aws-actions/configure-aws-credentials`)
2. Calls AWS ECR SDK (`GetAuthorizationToken` or `GetAuthorizationTokenPublic`)
3. Base64-decodes token to extract Docker username/password
4. Executes `docker login` via `@actions/exec`
5. Saves registry URIs to action state for post-cleanup
6. Cleanup phase calls `docker logout` for each registry

## Critical Patterns

### 1. Two Registry Types with Different Behaviors
- **ECR Private** (`registry-type: private`): supports multi-registry login via `registries` input (comma-separated account IDs); registry URI format: `{accountId}.dkr.ecr.{region}.amazonaws.com`
- **ECR Public** (`registry-type: public`): single registry (`public.ecr.aws`); **must use `us-east-1` region** (SDK requirement)

### 2. Dynamic Output Naming Convention
Docker credentials are output with registry URI embedded in the key name:
```javascript
const secretSuffix = replaceSpecialCharacters(registryUri);
core.setOutput(`docker_username_${secretSuffix}`, username);
core.setOutput(`docker_password_${secretSuffix}`, password);
```
Example: `docker_username_123456789012_dkr_ecr_us_east_1_amazonaws_com`

See `replaceSpecialCharacters()` in `index.js` – replaces all non-alphanumeric chars with `_`.

### 3. Silent Exec with Explicit Listeners
All `docker` commands use `silent: true` to prevent credential leaks:
```javascript
await exec.exec('docker', ['login', '-u', user, '-p', pass, endpoint], {
  silent: true,
  ignoreReturnCode: true,
  listeners: { stdout: (data) => { /* collect */ } }
});
```
Never log raw `stdout`/`stderr` – use `core.debug()` or check exit codes.

### 4. Mask Password by Default (v2 Breaking Change)
- `mask-password` defaults to `'true'` in v2 (was `'false'` in v1)
- When `'true'`, calls `core.setSecret(password)` to prevent logging
- **Caveat**: masked secrets cannot be passed between jobs (GitHub Actions limitation)
- Users consuming outputs must set `mask-password: 'false'` and accept security tradeoff

## Development Workflow

### Build and Package
```bash
npm run package
```
Uses `@vercel/ncc` to bundle `index.js` → `dist/index.js` and `cleanup.js` → `dist/cleanup/index.js`.  
**Always run before committing** – action runs from `dist/`, not source files.

### Test Suite
```bash
npm test
```
Runs ESLint + Jest with coverage. Uses `aws-sdk-client-mock` to mock ECR SDK calls.

**Test Patterns:**
- Mock `@actions/core` and `@actions/exec` with `jest.mock()`
- Use `mockGetInput()` helper to inject action inputs
- Mock ECR clients with `mockClient(ECRClient)` from `aws-sdk-client-mock`
- Tests verify exact `docker` command args (see `index.test.js` lines 70-73)

### Conventional Commits Required
PR titles must match conventional commits regex (enforced by `.github/workflows/check.yml`):
```
^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([\w\-\.]+\))?(!)?: ([\w ])+
```
Examples: `feat: add podman support`, `fix(cleanup): handle missing state`

## Common Tasks

### Adding a New Input
1. Add to `action.yml` `inputs` section
2. Add to `INPUTS` object in `index.js`
3. Read via `core.getInput(INPUTS.yourInput)`
4. Update tests to mock the new input
5. Run `npm run package`

### Adding Docker CLI Alternative (e.g., Podman)
- Action auto-detects container CLI in order: `docker` → `podman` → `nerdctl`
- Users can force specific CLI via `container-cli` input (e.g., `container-cli: podman`)
- Detection happens once in `index.js` via `detectContainerCli()` function
- Chosen CLI saved to action state (`STATES.containerCli`) for cleanup phase
- `cleanup.js` reads CLI from state, falls back to `'docker'` if missing
- All `exec.exec()` calls use dynamic `containerCli` variable instead of hardcoded `'docker'`

### Debugging ECR API Issues
- Enable action debug logs: set repository secret `ACTIONS_STEP_DEBUG=true`
- Check `core.debug()` calls for SDK request details
- ECR Public **only** works in `us-east-1` – common misconfiguration
- Multi-account access requires ECR policy granting cross-account permissions (see README "Login to ECR on multiple AWS accounts")

### Handling Proxy Configuration
- Proxy from `http-proxy` input takes precedence over `HTTP_PROXY` env var
- Proxies are wrapped in `HttpsProxyAgent` and passed to AWS SDK's `NodeHttpHandler`
- See `configureProxy()` function in `index.js`

## Files to Modify Together

| Change | Modify These Files |
|--------|-------------------|
| New action input/output | `action.yml` + `index.js` + `index.test.js` |
| Docker command changes | `index.js` + `cleanup.js` + both test files |
| AWS SDK updates | `package.json` + `index.js` + `index.test.js` |
| CI/test configuration | `.github/workflows/check.yml` + `package.json` |

## Testing Locally

Run unit tests: `npm test`  
Check coverage: open `coverage/lcov-report/index.html`  
Lint only: `npm run lint`

**No local integration tests exist** – action relies on GitHub-hosted runners for real Docker/ECR testing.
