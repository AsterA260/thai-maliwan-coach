#!/bin/sh
# Uruchamia skrypt shell na runnerze EC2 (Etap 1b) przez AWS SSM — czyli
# po HTTPS, bo z kontenera Martina nie wychodzi nic poza 80/443.
#
#     narzedzia/runner.sh 'polecenie...'          # jedna linia
#     narzedzia/runner.sh - < skrypt.sh           # cały skrypt ze stdin
#
# Wynik (stdout+stderr) wraca z SSM; limit ~24 KB — dłuższe wyjścia
# skrypt na runnerze powinien sam przycinać (tail).
set -eu
REGION=${AWS_REGION:-eu-central-1}
ID=$(cat "$(dirname "$0")/../.aws-runner-id")
if [ "${1:-}" = "-" ]; then SKRYPT=$(cat); else SKRYPT="$*"; fi

# SSM przyjmuje listę linii; przekazujemy skrypt jako jedną linię
# przez base64, żeby cudzysłowy i dolary nie miały znaczenia.
B64=$(printf '%s' "$SKRYPT" | base64 | tr -d '\n')
CMD=$(aws ssm send-command --region "$REGION" --instance-ids "$ID" \
  --document-name AWS-RunShellScript --timeout-seconds 3600 \
  --parameters "commands=[\"echo $B64 | base64 -d > /tmp/z.sh && bash /tmp/z.sh\"],executionTimeout=[\"3600\"]" \
  --query Command.CommandId --output text)

while :; do
  S=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$ID" \
        --query Status --output text 2>/dev/null || echo Pending)
  case "$S" in Success|Failed|Cancelled|TimedOut) break;; esac
  sleep 5
done
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$ID" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text
[ "$S" = "Success" ]
