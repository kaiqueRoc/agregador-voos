#!/bin/bash
# Bootstrap de uma VM Ubuntu (EC2 user data): instala Docker, baixa o projeto e
# sobe a stack completa. Roda uma vez, como root, no primeiro boot.
# Log: /var/log/agregador-setup.log
set -euxo pipefail
exec > >(tee -a /var/log/agregador-setup.log) 2>&1

REPO="https://github.com/kaiqueRoc/agregador-voos.git"
DIR=/opt/agregador-voos

apt-get update -y
apt-get install -y git openssl
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu

# Folga de memória para o build das imagens.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Tenta por até 1h: o repositório pode ainda não estar público no primeiro boot.
for _ in $(seq 1 120); do
  [ -d "$DIR/.git" ] && break
  git clone "$REPO" "$DIR" && break
  echo "repositório indisponível, nova tentativa em 30s"
  sleep 30
done
cd "$DIR"

# Modo público: senhas aleatórias e Grafana sem nenhum login (só leitura).
if [ ! -f .env ]; then
  cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)
GRAFANA_DISABLE_LOGIN=true
GRAFANA_BASIC_AUTH=false
OTEL_ENABLED=true
EOF
  chmod 600 .env
fi

# Sobe a stack a cada boot: parar a VM para economizar não exige refazer nada.
cat > /etc/systemd/system/agregador.service <<EOF
[Unit]
Description=Agregador de voos (docker compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$DIR
Environment=COMPOSE_FILE=docker/docker-compose.yml
# Atualiza o código a cada boot (o "-" não deixa uma falha de rede impedir a subida).
ExecStartPre=-/usr/bin/git -C $DIR pull --ff-only
ExecStart=/usr/bin/docker compose --profile observability up -d --build
ExecStop=/usr/bin/docker compose --profile observability stop

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now agregador.service
