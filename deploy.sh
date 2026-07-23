#!/bin/bash
# ==============================================================================
# GastroFlow SaaS Suite — Automated Production Cloud Deployment Script
# Target OS: Ubuntu 22.04 LTS / 24.04 LTS (DigitalOcean / AWS EC2 / Hetzner / Linode)
# ==============================================================================

set -e

echo "🚀 Starting GastroFlow Production Cloud Deployment..."

# 1. Update System Packages & Install Dependencies
echo "📦 Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git ufw nginx certbot python3-certbot-nginx

# 2. Install Docker & Docker Compose if not present
if ! command -v docker &> /dev/null; then
    echo "🐳 Installing Docker Engine..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
fi

if ! command -v docker-compose &> /dev/null; then
    echo "🐳 Installing Docker Compose..."
    sudo apt-get install -y docker-compose-plugin
fi

# 3. Configure UFW Firewall (Open Ports 80, 443, 22)
echo "🔒 Hardening UFW Firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# 4. Copy Environment Template if .env missing
if [ ! -f .env ]; then
    echo "⚙️ Creating production .env file from .env.example..."
    cp .env.example .env
    echo "⚠️ WARNING: Please update secrets in your .env file before go-live!"
fi

# 5. Build and Launch Containers via Docker Compose
echo "🏗️ Building GastroFlow Production Containers..."
sudo docker compose build --no-cache

echo "⚡ Starting Containers in Background..."
sudo docker compose up -d

echo "----------------------------------------------------------------------"
echo "✅ GastroFlow SaaS Suite Successfully Deployed & Running Live!"
echo "----------------------------------------------------------------------"
echo "🖥️ GastroPOS:         http://<YOUR-SERVER-IP>:3000"
echo "🍔 GastroFood:        http://<YOUR-SERVER-IP>:3001"
echo "🛵 GastroDriver:      http://<YOUR-SERVER-IP>:3002"
echo "⚙️ Backend API:       http://<YOUR-SERVER-IP>:5000/api"
echo "----------------------------------------------------------------------"
