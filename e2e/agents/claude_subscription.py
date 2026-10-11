"""Harbor's Claude Code agent with subscription OAuth (CLAUDE_CODE_OAUTH_TOKEN) as ACP target.

The simulated user (also Claude Code) starts the target adapter from its Bash tool, and Claude
Code does not pass its own OAuth token to tool subprocesses. So the target adapter would start
logged out. This subclass uploads the token to a file and reads it when the adapter starts.
"""

import os
import shlex
import tempfile
from pathlib import Path
from typing import override

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.environments.base import BaseEnvironment

TOKEN_PATH = "/home/dev/.e2e-claude-oauth-token"


class ClaudeSubscription(ClaudeCode):
    @override
    async def acp_install(self, environment: BaseEnvironment) -> None:
        await super().acp_install(environment)
        token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip()
        if not token:
            raise ValueError("CLAUDE_CODE_OAUTH_TOKEN is not set")
        with tempfile.NamedTemporaryFile("w", delete=False) as tmp:
            tmp.write(token)
        try:
            await environment.upload_file(Path(tmp.name), TOKEN_PATH)
        finally:
            os.unlink(tmp.name)
        await self.exec_as_root(environment, command=f"chown dev:dev {TOKEN_PATH} && chmod 600 {TOKEN_PATH}")

    @override
    def acp_command(self) -> list[str]:
        inner = " ".join(shlex.quote(part) for part in super().acp_command())
        subagent = os.environ.get("E2E_CLAUDE_SUBAGENT_MODEL", "").strip()
        sub = f"CLAUDE_CODE_SUBAGENT_MODEL={shlex.quote(subagent)} " if subagent else ""
        script = f'CLAUDE_CODE_OAUTH_TOKEN="$(cat {TOKEN_PATH})" {sub}exec {inner}'
        return ["sh", "-c", script]
