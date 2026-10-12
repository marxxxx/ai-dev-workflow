"""Harbor's Codex agent with ChatGPT/Business device-login auth (auth.json) in ACP mode.

Harbor refuses auth.json for ACP targets only because the adapter gets a fresh CODEX_HOME
(/tmp/codex-acp-home) that nobody copies the credentials into. This subclass does that copy.
Set CODEX_AUTH_JSON_PATH=<path to auth.json> (or CODEX_FORCE_AUTH_JSON=1 for ~/.codex/auth.json).
"""

from pathlib import Path
from typing import override

from harbor.agents.installed.codex import Codex
from harbor.environments.base import BaseEnvironment


class CodexSubscription(Codex):
    _skip_auth_check = False

    @override
    def _resolve_auth_json_path(self):  # type: ignore[override]
        if self._skip_auth_check:
            return None
        return super()._resolve_auth_json_path()

    @override
    async def acp_install(self, environment: BaseEnvironment) -> None:
        auth_json: Path | None = super()._resolve_auth_json_path()
        if auth_json is None:
            raise ValueError("Set CODEX_AUTH_JSON_PATH or CODEX_FORCE_AUTH_JSON=1")
        self._skip_auth_check = True
        try:
            await super().acp_install(environment)
        finally:
            self._skip_auth_check = False
        remote = (self._REMOTE_ACP_CODEX_HOME / "auth.json").as_posix()
        await environment.upload_file(auth_json, remote)
        await self.exec_as_root(environment, command=f"chown dev:dev {remote} && chmod 600 {remote}")
        home = self._REMOTE_ACP_CODEX_HOME.as_posix()
        real_codex = "/opt/agent-tools/node_modules/.bin/codex"
        marketplace = "/home/dev/.cache/ai-dev-workflow/codex-marketplace"
        await self.exec_as_agent(
            environment,
            command=(
                f"set -e; export CODEX_HOME={home}; "
                f"name=$(node -p \"require('{marketplace}/.claude-plugin/marketplace.json').name\"); "
                f"{real_codex} plugin marketplace add {marketplace} --json >/dev/null; "
                f"{real_codex} plugin add superpowers@$name --json >/dev/null; "
                f"printf '\\n[plugins.\"superpowers@openai-curated-remote\"]\\nenabled = false\\n' >> {home}/config.toml"
            ),
        )

    @override
    def acp_command(self) -> list[str]:
        # Let the adapter pick up the stored ChatGPT login instead of forcing the API-key method.
        return [part for part in super().acp_command() if not part.startswith("DEFAULT_AUTH_REQUEST=")]
