# FormPilot AI - Backend REST API Specification

Welcome to the **FormPilot AI Backend API Specification**. This document provides detailed information regarding all available REST API endpoints, request schemas, response formats, authentication requirements, and error codes.

---

## Base URL
```
http://localhost:5001/api/v1
```

---

## Authentication
All protected routes require a **JSON Web Token (JWT)** passed in the `Authorization` header as a Bearer token:
```http
Authorization: Bearer <YOUR_JWT_TOKEN>
```

---

## Endpoints Summary

### 1. Health Check
- **`GET /health`** (Root path: `http://localhost:5000/health`)
  - **Auth Required**: No
  - **Response (200 OK)**:
    ```json
    {
      "status": "success",
      "message": "FormPilot AI Backend API is healthy and operational",
      "timestamp": "2026-07-22T09:40:00.000Z",
      "environment": "development"
    }
    ```

---

### 2. Authentication API (`/api/v1/auth`)

#### A. User Registration
- **`POST /api/v1/auth/register`**
- **Auth Required**: No
- **Request Body**:
  ```json
  {
    "email": "student@university.edu",
    "password": "SecurePassword123!",
    "fullName": "Jane Doe"
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "statusCode": 201,
    "status": "success",
    "message": "User registered successfully",
    "data": {
      "user": {
        "id": "669db7a2e4b0123456789abc",
        "email": "student@university.edu",
        "fullName": "Jane Doe",
        "role": "user"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```

#### B. User Login
- **`POST /api/v1/auth/login`**
- **Auth Required**: No
- **Request Body**:
  ```json
  {
    "email": "student@university.edu",
    "password": "SecurePassword123!"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "status": "success",
    "message": "User logged in successfully",
    "data": {
      "user": {
        "id": "669db7a2e4b0123456789abc",
        "email": "student@university.edu",
        "fullName": "Jane Doe",
        "role": "user"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```

---

### 3. User Profile API (`/api/v1/users`)

#### A. Get Current User Profile
- **`GET /api/v1/users/me`**
- **Auth Required**: Yes
- **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "status": "success",
    "message": "User profile fetched successfully",
    "data": {
      "_id": "669db7a2e4b0123456789abc",
      "email": "student@university.edu",
      "fullName": "Jane Doe",
      "role": "user",
      "profileData": {
        "phone": "+1234567890",
        "address": "123 Campus Way",
        "city": "Boston",
        "country": "USA",
        "postalCode": "02115",
        "organization": "University Tech Club"
      }
    }
  }
  ```

#### B. Update User Auto-Fill Profile Data
- **`PUT /api/v1/users/me/profile`**
- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "profileData": {
      "phone": "+1987654321",
      "address": "456 College Ave",
      "city": "Cambridge",
      "country": "USA",
      "postalCode": "02138",
      "organization": "AI Research Group"
    }
  }
  ```
- **Response (200 OK)**: Standard `ApiResponse` with updated profile data.

---

### 4. Form Management & AI Bridge API (`/api/v1/forms`)

#### A. Upload / Cache Web Form Context Schema
- **`POST /api/v1/forms/context`**
- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "domain": "portal.university.edu",
    "formUrl": "https://portal.university.edu/apply",
    "formIdentifier": "student-application-form-v1",
    "fields": [
      {
        "fieldId": "first_name",
        "fieldType": "text",
        "label": "First Name",
        "placeholder": "Enter your first name",
        "isRequired": true
      },
      {
        "fieldId": "email_addr",
        "fieldType": "email",
        "label": "Email Address",
        "isRequired": true
      }
    ]
  }
  ```
- **Response (201 Created)**: Saved `FormContext` document.

#### B. Query Form Context by Domain
- **`GET /api/v1/forms/context?domain=portal.university.edu`**
- **Auth Required**: Yes
- **Response (200 OK)**: Array of cached form contexts for the website.

#### C. Request AI Auto-Fill Predictions (AI Service Bridge)
- **`POST /api/v1/forms/fill-request`**
- **Auth Required**: Yes
- **Description**: Forwards Chrome Extension DOM context and user profile facts to the AI Microservice, receives predictions, and logs a form session in MongoDB.
- **Request Body**:
  ```json
  {
    "domain": "portal.university.edu",
    "formIdentifier": "student-application-form-v1",
    "userIntent": "Fill application form with my contact details",
    "fields": [
      { "fieldId": "first_name", "fieldType": "text", "label": "First Name" },
      { "fieldId": "email_addr", "fieldType": "email", "label": "Email Address" }
    ]
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "status": "success",
    "message": "AI form field suggestions generated successfully",
    "data": {
      "formContextId": "669db8f1e4b0987654321def",
      "predictions": {
        "first_name": {
          "suggestedValue": "Jane",
          "confidence": 0.98
        },
        "email_addr": {
          "suggestedValue": "student@university.edu",
          "confidence": 0.99
        }
      }
    }
  }
  ```

#### D. Create Form Filling Session Audit Log
- **`POST /api/v1/forms/sessions`**
- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "formContextId": "669db8f1e4b0987654321def"
  }
  ```

#### E. Update Form Filling Session Status
- **`PATCH /api/v1/forms/sessions/:id`**
- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "status": "completed",
    "filledValues": {
      "first_name": "Jane",
      "email_addr": "student@university.edu"
    }
  }
  ```

---

## Centralized Error Response Format
All error responses follow this standard schema:
```json
{
  "status": "fail",
  "message": "Validation Error: Please enter a valid email address",
  "errors": [
    {
      "message": "Please enter a valid email address",
      "path": ["email"]
    }
  ]
}
```
