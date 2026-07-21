# Starter Codebase Structure

This scaffold is intended for the first working prototype of X AI.

## Recommended repository layout

```text
x-ai/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   ├── services/
│   │   ├── models/
│   │   ├── workers/
│   │   └── utils/
│   ├── tests/
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── styles/
│   ├── public/
│   └── README.md
├── db/
│   └── schema.sql
├── infra/
│   ├── docker/
│   ├── kubernetes/
│   └── env.example
├── docs/
│   ├── architecture.md
│   ├── beta-launch-checklist.md
│   └── starter-codebase-structure.md
├── scripts/
│   ├── seed.sh
│   └── deploy.sh
└── README.md
```

## Responsibilities

### Backend
- Authentication and user management
- Prompt processing and planning workflows
- Code generation orchestration
- Billing, credits, and subscription logic
- Integration with third-party services

### Frontend
- Prompt input UI
- Project dashboard
- Live preview and output explorer
- Billing and plan management screens

### Infrastructure
- Containerized deployment
- Environment configuration
- Monitoring and alerting
- Backup and rollback support

## Prototype implementation order
1. Set up backend API shell.
2. Create frontend shell and auth flow.
3. Add prompt submission and project creation.
4. Add generation pipeline and preview output.
5. Add billing and credit services.
6. Add integrations and beta deployment support.
