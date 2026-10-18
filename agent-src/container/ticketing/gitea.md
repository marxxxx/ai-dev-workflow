Add the `tea` login this project uses (`@@GITEA_LOGIN@@`, from `ai-project.json`), with a
Gitea access token:

```sh
./ai-dev.sh tea login add --name @@GITEA_LOGIN@@ --url https://<your-gitea> --token <token>
```

`git push` needs its own credentials for the Gitea remote: configure a Git credential helper or
an SSH key inside the container (`./ai-dev.sh`, then set it up in the shell; it persists in
`agent-home`).

Check that Git can reach the remote: `./ai-dev.sh git ls-remote origin`
