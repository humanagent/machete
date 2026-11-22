# Secrets

- Every secret lives in Infisical, project **Machete** (`0c579e58-0512-477e-8fd7-b735d5050cc3`), env `prod`. Never in the repo, `.env` files, shell history, or chat.
- Read them by running commands under `infisical run --projectId=0c579e58-0512-477e-8fd7-b735d5050cc3 --env=prod -- <cmd>` (add `</dev/null` for non-interactive use). Never print secret values.
- A new secret goes straight into that project (`infisical secrets set …`); files that must exist on disk (e.g. the notarization `.p8`) are also stored there and kept locally only under `~/.machete-signing/` (chmod 700).
- What is there: landing deploy config (`S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `LAMBDA_FUNCTION`, `DYNAMODB_TABLE`, `AWS_REGION`, `ORIGIN_SECRET`), Mac signing (`MAC_CERTIFICATE_P12`, `MAC_CERTIFICATE_PASSWORD`) and notarization (`APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`).
