# Render deployment

This Blueprint deploys the web app and API as one Node service. It expects a persistent MongoDB service and an already-running Hyperledger Fabric network reachable from Render. It does not create either database or Fabric infrastructure.

## Before deploying

- Confirm the GitHub repository is private or contains only source you intend to publish publicly. Do not commit credentials, Fabric certificates/private keys, `.env` files, patient data, research results, or screenshots.
- Provision a persistent MongoDB database with TLS. Set its restricted connection URI in Render as `MONGO_URI`; do not allow unrestricted network access.
- Confirm both Fabric peers are reachable from the Render service over TLS, with the supplied host aliases matching the peers’ TLS certificates. The Fabric channel and chaincode must already be deployed.
- Configure GitHub and Render account access, then create a Render Blueprint from this repository and review the service plan before applying it. The Blueprint selects the paid `1c-2g` plan; Render, MongoDB, and Fabric provider charges are separate.

## Render environment and secret files

The Blueprint generates `JWT_SECRET`. Set these secret environment variables in Render:

- `MONGO_URI`: persistent MongoDB connection string.
- `DATA_KEY_HEX`: a new, unique, randomly generated 32-byte key represented by exactly 64 hexadecimal characters. Back it up in an approved secrets vault. Losing it makes stored clinical content unreadable.
- `FABRIC_ORG1_PEER_ENDPOINT`, `FABRIC_ORG1_PEER_HOST_ALIAS`
- `FABRIC_ORG2_PEER_ENDPOINT`, `FABRIC_ORG2_PEER_HOST_ALIAS`

In the service’s **Secret Files**, upload the matching organization materials using these exact filenames:

| Secret file | Content |
| --- | --- |
| `/etc/secrets/org1-tls-ca.pem` | Org 1 peer TLS root certificate |
| `/etc/secrets/org1-client-cert.pem` | Org 1 client signing certificate |
| `/etc/secrets/org1-client-key.pem` | Org 1 client private key |
| `/etc/secrets/org2-tls-ca.pem` | Org 2 peer TLS root certificate |
| `/etc/secrets/org2-client-cert.pem` | Org 2 client signing certificate |
| `/etc/secrets/org2-client-key.pem` | Org 2 client private key |

Never paste private keys or database credentials into chat or commit them to GitHub. Use least-privilege Fabric identities and rotate them through your organization’s approved process.

## First administrator

After the service is deployed and healthy, set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (at least 14 characters), `BOOTSTRAP_ADMIN_NAME`, and `BOOTSTRAP_ADMIN_ORG` (`Org1MSP` or `Org2MSP`) as temporary Render service secrets. Open a Render Shell and run:

```sh
npm run bootstrap-admin
```

The command refuses to create an administrator if one already exists. After it succeeds, remove all four temporary bootstrap variables and redeploy before signing in. The application never creates demo users or sample patient records on startup.

## Validation and limitations

Render checks `/api/health`. The backend serves the compiled frontend from the same origin, applies the production content security policy, and refuses to start with missing/invalid production JWT, encryption-key, or MongoDB settings.

This is a research prototype, not a certified clinical system. Before using real patient information, obtain the required privacy, regulatory, security, clinical-safety, backup/recovery, and operational approvals. Confirm that your hosting regions and providers meet your organization’s data residency and healthcare obligations.
