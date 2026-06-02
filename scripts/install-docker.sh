#!/bin/bash
set -e

echo '=== Updating apt ==='
sudo apt-get update -y

echo '=== Installing prerequisites ==='
sudo apt-get install -y ca-certificates curl gnupg

echo '=== Adding Docker GPG key ==='
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo '=== Adding Docker repository ==='
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

echo '=== Installing Docker Engine ==='
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo '=== Adding user to docker group ==='
sudo usermod -aG docker $USER

echo '=== Starting Docker ==='
sudo service docker start

echo '=== Done! ==='
docker --version
docker compose version
