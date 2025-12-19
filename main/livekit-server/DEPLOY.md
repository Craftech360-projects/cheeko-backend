# Deploying Cheeko LiveKit Agent to DigitalOcean Kubernetes

## Prerequisites

1. **DigitalOcean Account** with Kubernetes cluster created
2. **doctl CLI** installed and authenticated
3. **kubectl** installed and configured
4. **Docker** installed locally

## Step 1: Create DigitalOcean Container Registry

```bash
# Create a container registry (if not exists)
doctl registry create cheeko

# Login to the registry
doctl registry login
```

## Step 2: Build and Push Docker Image

```bash
# Navigate to the livekit-server directory
cd D:\cheekofinal\xiaozhi-esp32-server\main\livekit-server

# Build the Docker image
docker build -t registry.digitalocean.com/cheeko/cheeko-livekit-agent:latest .

# Push to DigitalOcean Container Registry
docker push registry.digitalocean.com/cheeko/cheeko-livekit-agent:latest
```

## Step 3: Connect to Your Kubernetes Cluster

```bash
# List available clusters
doctl kubernetes cluster list

# Save kubeconfig for your cluster
doctl kubernetes cluster kubeconfig save <your-cluster-name>

# Verify connection
kubectl get nodes
```

## Step 4: Create Registry Pull Secret

```bash
# Create the registry credentials secret in the livekit namespace
kubectl create namespace livekit

# Create docker registry secret for pulling images
doctl registry kubernetes-manifest | kubectl apply -f -

# Or manually create the secret:
kubectl create secret docker-registry do-registry-secret \
  --namespace=livekit \
  --docker-server=registry.digitalocean.com \
  --docker-username=<your-do-token> \
  --docker-password=<your-do-token> \
  --docker-email=your-email@example.com
```

## Step 5: Update Secrets with Your Values

Edit `secrets.yaml` and replace all placeholder values with your actual credentials:

```yaml
# Required secrets to update:
- LIVEKIT_URL: Your LiveKit Cloud URL
- LIVEKIT_API_KEY: Your LiveKit API Key
- LIVEKIT_API_SECRET: Your LiveKit API Secret
- GOOGLE_API_KEY: Your Google/Gemini API Key
- AWS_ACCESS_KEY_ID: Your AWS Access Key
- AWS_SECRET_ACCESS_KEY: Your AWS Secret Key
- QDRANT_URL: Your Qdrant Cloud URL
- QDRANT_API_KEY: Your Qdrant API Key
- MEM0_API_KEY: Your Mem0 API Key
- MANAGER_API_URL: Your Manager API URL
- MANAGER_API_SECRET: Your Manager API Secret
- WEATHER_API: Your OpenWeatherMap API Key
```

## Step 6: Deploy to Kubernetes

```bash
# Navigate to k8s directory
cd k8s

# Apply secrets first (creates namespace and secrets)
kubectl apply -f secrets.yaml

# Apply the deployment, service, and HPA
kubectl apply -f agent-manifest.yaml

# Verify deployment
kubectl get pods -n livekit
kubectl get services -n livekit
kubectl get hpa -n livekit
```

## Step 7: Verify Deployment

```bash
# Check pod status
kubectl get pods -n livekit -w

# Check pod logs
kubectl logs -f deployment/cheeko-livekit-agent -n livekit

# Check if agent is registered with LiveKit
kubectl logs -f deployment/cheeko-livekit-agent -n livekit | grep "Agent"
```

## Updating the Deployment

### Update Docker Image

```bash
# Build new image with tag
docker build -t registry.digitalocean.com/cheeko/cheeko-livekit-agent:v1.2.0 .
docker push registry.digitalocean.com/cheeko/cheeko-livekit-agent:v1.2.0

# Update deployment
kubectl set image deployment/cheeko-livekit-agent \
  agent=registry.digitalocean.com/cheeko/cheeko-livekit-agent:v1.2.0 \
  -n livekit

# Or rolling restart with latest tag
kubectl rollout restart deployment/cheeko-livekit-agent -n livekit
```

### Update Secrets

```bash
# Edit secrets
kubectl edit secret cheeko-livekit-secrets -n livekit

# Or delete and recreate
kubectl delete -f secrets.yaml
kubectl apply -f secrets.yaml

# Restart deployment to pick up new secrets
kubectl rollout restart deployment/cheeko-livekit-agent -n livekit
```

## Scaling

### Manual Scaling

```bash
# Scale to 5 replicas
kubectl scale deployment/cheeko-livekit-agent --replicas=5 -n livekit
```

### Auto-scaling (HPA)

The HorizontalPodAutoscaler is configured to:
- Minimum: 2 replicas
- Maximum: 10 replicas
- Scale up at 70% CPU utilization
- Scale up at 80% memory utilization

```bash
# Check HPA status
kubectl get hpa -n livekit

# Describe HPA for detailed metrics
kubectl describe hpa cheeko-livekit-agent-hpa -n livekit
```

## Troubleshooting

### Pod Not Starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n livekit

# Check if secrets exist
kubectl get secrets -n livekit

# Check image pull issues
kubectl get events -n livekit --sort-by='.lastTimestamp'
```

### Health Check Failures

```bash
# Port-forward to test health endpoint
kubectl port-forward deployment/cheeko-livekit-agent 8081:8081 -n livekit

# Test health endpoint
curl http://localhost:8081/health
```

### View Logs

```bash
# All pod logs
kubectl logs -l app=cheeko-livekit-agent -n livekit --tail=100

# Follow logs
kubectl logs -f deployment/cheeko-livekit-agent -n livekit

# Previous container logs (if restarted)
kubectl logs deployment/cheeko-livekit-agent -n livekit --previous
```

## Resource Monitoring

```bash
# Pod resource usage
kubectl top pods -n livekit

# Node resource usage
kubectl top nodes
```

## Clean Up

```bash
# Delete deployment, service, and HPA
kubectl delete -f agent-manifest.yaml

# Delete secrets and namespace
kubectl delete -f secrets.yaml

# Or delete entire namespace
kubectl delete namespace livekit
```

## CI/CD Integration (GitHub Actions Example)

Create `.github/workflows/deploy.yaml`:

```yaml
name: Deploy to DigitalOcean Kubernetes

on:
  push:
    branches: [main]
    paths:
      - 'main/livekit-server/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

      - name: Login to Container Registry
        run: doctl registry login

      - name: Build and Push Image
        run: |
          cd main/livekit-server
          docker build -t registry.digitalocean.com/cheeko/cheeko-livekit-agent:${{ github.sha }} .
          docker push registry.digitalocean.com/cheeko/cheeko-livekit-agent:${{ github.sha }}

      - name: Update Kubernetes Deployment
        run: |
          doctl kubernetes cluster kubeconfig save <your-cluster-name>
          kubectl set image deployment/cheeko-livekit-agent \
            agent=registry.digitalocean.com/cheeko/cheeko-livekit-agent:${{ github.sha }} \
            -n livekit
```

## Architecture Notes

- **LiveKit Agent Pattern**: The agent connects to LiveKit Cloud and waits for room dispatch. When a participant joins a room, LiveKit dispatches a job to an available agent.
- **Graceful Shutdown**: 600s termination grace period allows active conversations to complete before pod termination.
- **HPA Configuration**: Conservative scale-down (10% every 60s) prevents disrupting active conversations.
