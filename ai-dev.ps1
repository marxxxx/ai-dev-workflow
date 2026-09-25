function dc { docker compose -p luca-ai --env-file .env.ai-dev -f compose.ai-dev.yml run --rm ai-dev-workflow @args }

dc @args