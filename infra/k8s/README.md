# Kubernetes deployment

```bash
kubectl apply -f app.yaml                      # replace OWNER/SHA with the CI-built image
kubectl -n amrutam wait --for=condition=complete job/amrutam-migrate --timeout=120s   # migrations gate the rollout
kubectl -n amrutam rollout status deploy/amrutam-api --timeout=180s || kubectl -n amrutam rollout undo deploy/amrutam-api
```
Migrations are forward-only and **expand/contract** (additive first, destructive later) so the previous image keeps
working during a rolling update and `rollout undo` is always safe.
