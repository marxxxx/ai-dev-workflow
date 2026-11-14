Log in to GitHub once; this also lets `git push` use the same credentials:

```sh
./adw.sh gh auth login
./adw.sh gh auth setup-git
```

Check that Git can reach the remote: `./adw.sh git ls-remote origin`
