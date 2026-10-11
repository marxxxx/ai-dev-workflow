"""Spike: Harbor's OpenCode agent using the host's OpenCode login (OAuth or API key) as ACP target.

- Copies only the model provider's entry of OPENCODE_AUTH_JSON_PATH into the target's XDG data dir.
- Passes the model via an OPENCODE_CONFIG file: the image's launch-agent wrapper overwrites
  OPENCODE_CONFIG_CONTENT (MCP + superpowers plugin), which is where Harbor puts the model.
"""

import json
import os
import tempfile
from pathlib import Path
from typing import override

from harbor.agents.installed.opencode import OpenCode
from harbor.environments.base import BaseEnvironment

CONFIG_PATH = "/home/dev/.e2e-opencode.json"


class OpenCodeSubscription(OpenCode):
    async def _upload_json(self, environment: BaseEnvironment, data: dict, target: str) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json") as tmp:
            json.dump(data, tmp)
        try:
            await environment.upload_file(Path(tmp.name), target)
        finally:
            os.unlink(tmp.name)
        await self.exec_as_root(environment, command=f"chown dev:dev {target} && chmod 600 {target}")

    @override
    async def acp_install(self, environment: BaseEnvironment) -> None:
        await super().acp_install(environment)
        provider, model_id = self.model_name.split("/", 1)
        auth = json.loads(Path(os.environ["OPENCODE_AUTH_JSON_PATH"]).read_text())
        data_dir = (self.environment_logs_dir / "opencode" / "xdg-data" / "opencode").as_posix()
        await self.exec_as_agent(environment, command=f"mkdir -p {data_dir}")
        await self._upload_json(environment, {provider: auth[provider]}, f"{data_dir}/auth.json")
        config = {"model": self.model_name, "provider": {provider: {"models": {model_id: {}}}}}
        await self._upload_json(environment, config, CONFIG_PATH)

    @override
    def acp_command(self) -> list[str]:
        command = [p for p in super().acp_command() if not p.startswith("OPENCODE_CONFIG_CONTENT=")]
        command.insert(command.index("opencode"), f"OPENCODE_CONFIG={CONFIG_PATH}")
        return command
