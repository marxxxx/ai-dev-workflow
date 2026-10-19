Log in to Azure once with a device code (append `--tenant <tenant-id>` or set `AZURE_TENANT_ID`
in `.env.ai-dev` when needed):

```sh
./ai-dev.sh az login --use-device-code --allow-no-subscriptions
```

This serves the Azure DevOps MCP server and `az boards`/`az repos`. It does not authenticate
`git push`: configure a Git credential helper or an SSH key for the remote inside the container
(`./ai-dev.sh`, then set it up in the shell; it persists in `agent-home`).

Check that Git can reach the remote: `./ai-dev.sh git ls-remote origin`
