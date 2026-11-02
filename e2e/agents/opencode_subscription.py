"""Harbor's OpenCode agent using the host's OpenCode login (OAuth or API key) as ACP target.

- Imports only the model provider's entries from OPENCODE_CREDENTIALS_PATH (an `opencode auth export` file)
  into the target's XDG data dir.
- Passes the model via an OPENCODE_CONFIG file: the image's launch-agent wrapper overwrites
  OPENCODE_CONFIG_CONTENT (MCP + superpowers plugin), which is where Harbor puts the model.
- Keeps the image's opencode wrapper. Harbor's OpenCode, unlike its Claude Code and Codex, always
  npm-installs opencode under nvm and symlinks that binary over /usr/local/bin/opencode, so the
  agent ran without the wrapper's MCP servers and superpowers plugin (#63).
"""

import json
import os
import re
import tempfile
from pathlib import Path
from typing import override

from harbor.agents.installed.opencode import OpenCode
from harbor.environments.base import BaseEnvironment

CONFIG_PATH = "/home/dev/.e2e-opencode.json"
CREDENTIALS_PATH = "/home/dev/.e2e-opencode-credentials.json"
WRAPPER_LINK = "/usr/local/bin/opencode"
WRAPPER = "/usr/local/bin/agent-wrapper.sh"
IMAGE_BINARY = "/opt/agent-tools/node_modules/.bin/opencode"


class OpenCodeSubscription(OpenCode):
    async def _upload_json(self, environment: BaseEnvironment, data: dict | list, target: str) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json") as tmp:
            json.dump(data, tmp)
        try:
            await environment.upload_file(Path(tmp.name), target)
        finally:
            os.unlink(tmp.name)
        await self.exec_as_root(environment, command=f"chown dev:dev {target} && chmod 600 {target}")

    @override
    def parse_version(self, stdout: str) -> str:
        # OpenCode 2 prints "opencode v2.2.3".
        match = re.search(r"\d+\.\d+\.\d+\S*", stdout)
        return match.group(0) if match else stdout.strip()

    async def _wrapper_target(self, environment: BaseEnvironment) -> str:
        result = await environment.exec(command=f"readlink -f {WRAPPER_LINK}")
        return (result.stdout or "").strip()

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        # The image binary is called directly: the wrapper needs /workspace/ai-project.json.
        version = await environment.exec(command=f"{IMAGE_BINARY} --version")
        if version.return_code == 0 and await self._wrapper_target(environment) == WRAPPER:
            found = self.parse_version(version.stdout or "")
            # Harbor's install would npm-install opencode-ai, not the image's OpenCode 2.
            if self._version is not None and found != self._version:
                raise RuntimeError(f"the image has OpenCode {found}, the run requests {self._version}: rebuild the image")
            self.logger.debug("OpenCode is already available at the requested version")
            return
        await super().install(environment)

    @override
    async def acp_install(self, environment: BaseEnvironment) -> None:
        await super().acp_install(environment)
        if (target := await self._wrapper_target(environment)) != WRAPPER:
            raise RuntimeError(f"{WRAPPER_LINK} resolves to {target!r}, not the image's agent wrapper")
        provider, model_id = self.model_name.split("/", 1)
        credentials = [c for c in json.loads(Path(os.environ["OPENCODE_CREDENTIALS_PATH"]).read_text())
                       if c["integrationID"] == provider]
        if not credentials:
            raise RuntimeError(f"OPENCODE_CREDENTIALS_PATH has no login for {provider!r}")
        # The same XDG dirs as Harbor's acp_command, so `opencode acp` finds the login.
        xdg = self.environment_logs_dir / "opencode"
        await self._upload_json(environment, credentials, CREDENTIALS_PATH)
        await self.exec_as_agent(environment, command=(
            f"cd /tmp && XDG_DATA_HOME={(xdg / 'xdg-data').as_posix()} XDG_STATE_HOME={(xdg / 'xdg-state').as_posix()} "
            f"{IMAGE_BINARY} --standalone auth import {CREDENTIALS_PATH}; rc=$?; rm -f {CREDENTIALS_PATH}; exit $rc"))
        config = {"model": self.model_name, "providers": {provider: {"models": {model_id: {}}}}}
        await self._upload_json(environment, config, CONFIG_PATH)

    @override
    def acp_command(self) -> list[str]:
        command = [p for p in super().acp_command() if not p.startswith("OPENCODE_CONFIG_CONTENT=")]
        command.insert(command.index("opencode"), f"OPENCODE_CONFIG={CONFIG_PATH}")
        return command
