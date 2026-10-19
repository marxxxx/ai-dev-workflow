Log in to GitHub once; this also lets `git push` use the same credentials:

```sh
./ai-dev.sh gh auth login
./ai-dev.sh gh auth setup-git
```

Check that Git can reach the remote: `./ai-dev.sh git ls-remote origin`
