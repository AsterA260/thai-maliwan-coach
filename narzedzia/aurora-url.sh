#!/bin/sh
# Wypisuje DATABASE_URL do Aurory, biorąc hasło z AWS Secrets Manager
# W CHWILI URUCHOMIENIA. Nic nie zapisuje na dysk. Użycie:
#
#     export DATABASE_URL="$(narzedzia/aurora-url.sh)"           # master
#     export DATABASE_URL="$(narzedzia/aurora-url.sh api)"       # astera_api
#     export DATABASE_URL="$(narzedzia/aurora-url.sh api proxy)" # przez RDS Proxy
#
# Wymaga: AWS_PROFILE z prawem do odczytu sekretu, jq, aws.
# Hasła NIE wolno echo'wać ani logować — ten skrypt jest jedynym
# miejscem, które je widzi, i oddaje je wyłącznie w zmiennej.
set -eu
KLASTER=astera-coach-etap1b
REGION=${AWS_REGION:-eu-central-1}
KTO=${1:-master}
PRZEZ=${2:-bezposrednio}

if [ "$PRZEZ" = "proxy" ]; then
  HOST=$(aws rds describe-db-proxies --db-proxy-name "$KLASTER" --region "$REGION" \
           --query 'DBProxies[0].Endpoint' --output text)
else
  HOST=$(aws rds describe-db-clusters --db-cluster-identifier "$KLASTER" --region "$REGION" \
           --query 'DBClusters[0].Endpoint' --output text)
fi

if [ "$KTO" = "master" ]; then
  ARN=$(aws rds describe-db-clusters --db-cluster-identifier "$KLASTER" --region "$REGION" \
          --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text)
else
  ARN="astera-coach/etap1b/astera_api"
fi

SEKRET=$(aws secretsmanager get-secret-value --secret-id "$ARN" --region "$REGION" \
           --query SecretString --output text)
UZYTK=$(printf '%s' "$SEKRET" | jq -r .username)
HASLO=$(printf '%s' "$SEKRET" | jq -r '.password|@uri')   # jedno jq: bez doklejonego znaku nowej linii

printf 'postgresql://%s:%s@%s:5432/coach?sslmode=require\n' "$UZYTK" "$HASLO" "$HOST"
