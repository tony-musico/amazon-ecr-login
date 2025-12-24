const core = require('@actions/core');
const exec = require('@actions/exec');

/**
 * When the GitHub Actions job is done, logout of ECR Private/Public.
 */

const STATES = {
  registries: 'registries',
  containerCli: 'containerCli'
};

const SUPPORTED_CLIS = ['docker', 'podman', 'nerdctl'];

async function cleanup() {
  try {
    const registriesState = core.getState(STATES.registries);
    // Retrieve CLI used during login; fall back to 'docker' if state not set
    // (e.g., if index.js threw before saveState or older action version)
    // Validate against supported CLIs to prevent command injection
    const rawCli = core.getState(STATES.containerCli) || 'docker';
    const containerCli = SUPPORTED_CLIS.includes(rawCli) ? rawCli : 'docker';

    if (registriesState) {
      const registries = registriesState.split(',');
      const failedLogouts = [];

      // Logout of each registry
      for (const registry of registries) {
        core.info(`Logging out of registry ${registry}`);

        // Execute the container logout command
        let doLogoutStdout = '';
        let doLogoutStderr = '';
        const exitCode = await exec.exec(containerCli, ['logout', registry], {
          silent: true,
          ignoreReturnCode: true,
          listeners: {
            stdout: (data) => {
              doLogoutStdout += data.toString();
            },
            stderr: (data) => {
              doLogoutStderr += data.toString();
            }
          }
        });
        if (exitCode !== 0) {
          core.debug(doLogoutStdout);
          core.error(`Could not logout of registry ${registry}: ${doLogoutStderr}`);
          failedLogouts.push(registry);
        }
      }

      if (failedLogouts.length) {
        throw new Error(`Failed to logout: ${failedLogouts.join(',')}`);
      }
    }
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = cleanup;

/* istanbul ignore next */
if (require.main === module) {
  cleanup();
}
