Add the `tea` login this project uses (`@@GITEA_LOGIN@@`, from `ai-project.json`), with a
Gitea access token:

```sh
./ai-dev.sh tea login add --name @@GITEA_LOGIN@@ --url https://<your-gitea> --token <token>
```

Add `--git-credentials` to also register `tea` as the Git credential helper for that host, so
`git push` works too; otherwise configure a credential helper or an SSH key inside the container.

Check that Git can reach the remote: `./ai-dev.sh git ls-remote origin`
