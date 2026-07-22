# FormPilot AI - Backend Microservice

This repository contains the production-level Node.js + Express.js + MongoDB backend API microservice for **FormPilot AI**.

## Core Responsibilities
The backend acts strictly as an API bridge and orchestrator between:
1. **Chrome Extension (Frontend)**
2. **AI Microservice** (`http://localhost:8000`)
3. **MongoDB Database**

---

## Directory Structure

```
backend/
├── src/
│   ├── config/          # MongoDB connection & app configurations
│   ├── constants/       # System constants and status definitions
│   ├── controllers/     # Thin HTTP controllers
│   ├── middleware/      # Auth (JWT), Rate limiting, Validation, Error Handling
│   ├── models/          # Mongoose Schemas (User, FormContext, FormSession)
│   ├── repositories/    # Database query abstraction layer
│   ├── routes/          # RESTful v1 Endpoint definitions
│   ├── services/        # Business logic & AI Microservice integration client
│   ├── types/           # Type definitions and custom interfaces
│   ├── utils/           # ApiError, ApiResponse, AsyncHandler wrappers
│   ├── validators/      # Joi schema validators
│   └── app.js           # Express app setup & security middleware configuration
│
├── .env                 # Active environment variables
├── .env.example         # Environment template
├── API_DOCUMENTATION.md # Complete REST API specification
├── package.json         # Dependencies & scripts
└── server.js            # Entry point & process lifecycle bootstrapper
```

---

## Getting Started

### 1. Installation
```bash
cd backend
npm install
```

### 2. Environment Setup
Create a `.env` file based on `.env.example`:
```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/formpilot_db
JWT_SECRET=formpilot_super_secret_jwt_key_2026
JWT_EXPIRES_IN=7d
AI_SERVICE_URL=http://localhost:8000
CORS_ORIGIN=*
```

### 3. Run Development Server
```bash
npm run dev
```

### 4. Run Production Server
```bash
npm start
```

---

## API Documentation
Refer to [API_DOCUMENTATION.md](file:///Users/anushka/mongomerge/backend/API_DOCUMENTATION.md) for full endpoint specifications, request bodies, and cURL examples.
