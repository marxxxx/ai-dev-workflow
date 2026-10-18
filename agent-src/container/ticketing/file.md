Tickets live in the repository, so there is no ticketing login. `git push` needs credentials for
your remote: configure a Git credential helper or an SSH key inside the container
(`./ai-dev.sh`, then set it up in the shell; it persists in `agent-home`).

Check that Git can reach the remote: `./ai-dev.sh git ls-remote origin`
