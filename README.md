# Chat Backend — Node.js, TypeScript, PostgreSQL & Firebase Firestore

A strict-TypeScript REST API for one-to-one chat. Users, chats and membership live in PostgreSQL. Messages, read receipts and last-seen message pointers live in Firestore.

## Features

- Create or reuse a direct chat between two existing users
- Send messages with server-side Firestore timestamps
- Retrieve the latest N messages in chronological order
- Mark messages as read (idempotent `readBy` array)
- Track each member's last-seen message
- List a user's chats and member IDs from PostgreSQL
- Input validation, membership checks, centralized error handling and health endpoint

> **Security note:** The task's API accepts `userId`/`senderId` in request data because that is the specified interface. For a production system, add Firebase Authentication/JWT verification and derive the user ID from the verified token. Do not expose this API publicly without authentication and rate limiting.

## Requirements

- Node.js 20+
- PostgreSQL 14+
- A Firebase project with Firestore enabled
- Firebase service-account credentials for a server environment

## 1. Install

```bash
npm install
```

## 2. Create PostgreSQL database

Create a database named `chat_backend` (or choose your own):

```sql
CREATE DATABASE chat_backend;
```

Then apply the schema. On Windows PowerShell, from this project folder:

```powershell
psql -U postgres -d chat_backend -f .\sql\schema.sql
```

If `psql` is not in PATH, run the SQL file in pgAdmin's Query Tool instead. The schema uses PostgreSQL's `gen_random_uuid()` function; on older PostgreSQL installations, enable `pgcrypto` first with `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.

Add two test users in pgAdmin:

```sql
INSERT INTO users (id, display_name) VALUES
('user-1', 'Aarav'),
('user-2', 'Diya')
ON CONFLICT (id) DO NOTHING;
```

## 3. Configure environment

Copy `.env.example` to `.env` and set `DATABASE_URL` to your local PostgreSQL credentials.

For Firebase:
1. Open Firebase Console and create/select a project.
2. Enable Cloud Firestore and create the database.
3. In Project settings → Service accounts, generate a private key.
4. Save the downloaded JSON as `firebase-service-account.json` in the project root.
5. Keep `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json` in `.env`.

**Never upload `.env` or the service-account JSON to GitHub.** They are ignored by `.gitignore`. Alternatively set `FIREBASE_SERVICE_ACCOUNT_BASE64` in your deployment environment, or configure Application Default Credentials.

## 4. Run locally

```bash
npm run dev
```

Check `http://localhost:3000/health`; expected response:

```json
{ "status": "ok" }
```

Type-check/build:

```bash
npm run typecheck
npm run build
npm start
```

## API reference

All request and response bodies are JSON.

### 1. Create or get chat

`POST /chat/create`

```json
{ "userAId": "user-1", "userBId": "user-2" }
```

Response `200`:

```json
{ "chatId": "generated-uuid" }
```

Repeated calls for the same pair return the same chat. Both users must already exist in the relational `users` table.

### 2. Send message

`POST /chat/:chatId/message/send`

```json
{ "senderId": "user-1", "text": "Hello!" }
```

Response `201` includes the new message. The sender is initially in `readBy`.

### 3. Get messages

`GET /chat/:chatId/messages?userId=user-1&limit=50`

`userId` is required so the backend can verify chat membership. `limit` defaults to 50 and is restricted to 1–100. Results are ordered oldest-to-newest within the returned latest messages.

### 4. Mark message read

`POST /chat/:chatId/message/:messageId/read`

```json
{ "userId": "user-2" }
```

Response:

```json
{ "success": true }
```

The user's ID is added to `readBy` using Firestore `arrayUnion`, so repeated requests are safe.

### 5. Update last-seen message

`POST /chat/:chatId/lastseen`

```json
{ "userId": "user-2", "messageId": "message-id-from-send-response" }
```

Stores a document at `chats/{chatId}/lastSeen/{userId}` containing the message ID and update timestamp.

### 6. List user's chats

`GET /user/user-1/chats`

Response:

```json
{
  "chats": [
    {
      "chatId": "generated-uuid",
      "memberIds": ["user-1", "user-2"],
      "isGroup": false,
      "title": null,
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

## Firestore data structure

```text
chats/{chatId}/messages/{messageId}
  messageId, chatId, senderId, text, createdAt, readBy[]

chats/{chatId}/lastSeen/{userId}
  userId, messageId, updatedAt
```

## Example test flow with curl

Replace `CHAT_ID` and `MESSAGE_ID` with values returned by the API.

```bash
curl -X POST http://localhost:3000/chat/create \
  -H "Content-Type: application/json" \
  -d "{\"userAId\":\"user-1\",\"userBId\":\"user-2\"}"

curl -X POST http://localhost:3000/chat/CHAT_ID/message/send \
  -H "Content-Type: application/json" \
  -d "{\"senderId\":\"user-1\",\"text\":\"Hello from the chat API\"}"

curl "http://localhost:3000/chat/CHAT_ID/messages?userId=user-1&limit=50"

curl -X POST http://localhost:3000/chat/CHAT_ID/message/MESSAGE_ID/read \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"user-2\"}"

curl -X POST http://localhost:3000/chat/CHAT_ID/lastseen \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"user-2\",\"messageId\":\"MESSAGE_ID\"}"

curl "http://localhost:3000/user/user-1/chats"
```

## GitHub submission

1. Create a **public** empty repository on GitHub, for example `chat-backend-task`.
2. Do not add a README/license from GitHub if you already have these files locally.
3. From this folder run:

```bash
git init
git add .
git commit -m "Build chat backend with PostgreSQL and Firestore"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/chat-backend-task.git
git push -u origin main
```

4. Replace `YOUR_USERNAME` with your GitHub username and share the repository URL in your reply email.

## Design choices / limitations

- PostgreSQL stores user records, chat metadata, membership and unique direct-chat pairs.
- Firestore stores messages and read receipts. The latest-message query sorts by server timestamp descending, limits the result, then reverses it for chronological output.
- Message pagination beyond the latest `limit` is not included because it was not requested.
- Group-chat creation and edit/delete are optional bonus features and are not implemented in this baseline.
- No automatic user creation endpoint is included; seed users in SQL or integrate your existing user-management system.
