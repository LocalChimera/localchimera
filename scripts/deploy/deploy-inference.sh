#!/bin/bash
set -e

echo "=== Updating and installing dependencies ==="
apt update
apt install -y nginx certbot python3-certbot-nginx

echo "=== Creating nginx config ==="
cat > /etc/nginx/sites-available/inference << 'EOF'
server {
    listen 80;
    server_name inference.localchimera.com;

    location / {
        root /root/inference-frontend;
        try_files $uri $uri/ /index.html;
    }

    location /api/result {
        proxy_pass http://localhost:3006;
        proxy_set_header Host $host;
    }
}
EOF

echo "=== Enabling site ==="
ln -sf /etc/nginx/sites-available/inference /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo "=== Getting SSL certificate ==="
certbot --nginx -d inference.localchimera.com --agree-tos -n

echo "=== Done ==="
